import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { loadSubmissionFor, requirePrincipal, requireOrganization } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { createResumableUploadSession, getFolderId, uploadToDriveDirect } from "@/lib/google/drive";
import { ACCEPTED_THUMBNAIL_MIME, ACCEPTED_VIDEO_MIME, formatBytes } from "@/lib/validation";
import { DriveFolderKind, MediaKind, SubmissionStatus, UploadState } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel serverless body limit is 4.5 MB. For larger files, we'd need a different
// approach (streaming through a dedicated upload service). For now, fail fast.
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

const schema = z.object({
  submissionId: z.string().min(1),
  kind: z.enum(["VIDEO", "THUMBNAIL", "SUPPORTING_IMAGE"]),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive(),
  /** Browser-computed SHA-256, used for duplicate detection. */
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
});

/**
 * Opens a resumable upload session.
 *
 * The response contains a Google session URI which the browser then writes
 * bytes to directly. That URI is a write capability for one file, so it is
 * only ever handed to a user who is authorised to edit this submission, and
 * it is never logged.
 *
 * Validation happens HERE, before the session exists — rejecting a 4 GB
 * unsupported file after it has been uploaded would be indefensible.
 */
export const POST = route(async (request) => {
  const principal = await requirePrincipal();
  const body = await parseJson(request, schema);

  console.log(`[Upload session] Creating session for submission ${body.submissionId}, kind ${body.kind}, file ${body.filename}, size ${body.sizeBytes}`);

  const submission = await loadSubmissionFor(principal, body.submissionId, { forEdit: true });
  const org = await requireOrganization(principal);
  const kind = body.kind as MediaKind;

  // ---- type & size, per kind ----
  if (kind === MediaKind.VIDEO) {
    if (!(ACCEPTED_VIDEO_MIME as readonly string[]).includes(body.mimeType)) {
      throw Errors.unsupportedMedia(
        `"${body.mimeType}" is not a video format YouTube accepts. Please use MP4 (H.264).`,
        "video",
      );
    }
    if (body.sizeBytes > Number(org.maxVideoBytes)) {
      throw Errors.payloadTooLarge(
        `That video is ${formatBytes(body.sizeBytes)}, over the ${formatBytes(
          Number(org.maxVideoBytes),
        )} limit for this organisation.`,
      );
    }
  } else {
    if (!(ACCEPTED_THUMBNAIL_MIME as readonly string[]).includes(body.mimeType)) {
      throw Errors.unsupportedMedia("Images must be JPEG or PNG.", "thumbnail");
    }
    if (body.sizeBytes > Number(org.maxThumbnailBytes)) {
      throw Errors.payloadTooLarge(
        `That image is ${formatBytes(body.sizeBytes)}. The limit is ${formatBytes(
          Number(org.maxThumbnailBytes),
        )}.`,
      );
    }
  }

  // ---- duplicate detection (Section 26) ----
  let duplicateOf: string | null = null;
  if (body.checksumSha256 && kind === MediaKind.VIDEO) {
    const existing = await db.mediaFile.findFirst({
      where: {
        organizationId: principal.organizationId,
        checksumSha256: body.checksumSha256,
        uploadState: UploadState.COMPLETED,
        submissionId: { not: submission.id },
      },
      include: { submission: { select: { reference: true } } },
    });
    // Reported as a warning, not a block: re-using a file is unusual but
    // occasionally legitimate (a re-cut, a corrected description).
    duplicateOf = existing?.submission.reference ?? null;
  }

  // ---- replace any previous file of this kind ----
  // The partial unique index permits only one VIDEO/THUMBNAIL per submission,
  // so an earlier incomplete attempt must be cleared first.
  if (kind !== MediaKind.SUPPORTING_IMAGE) {
    await db.mediaFile.deleteMany({ where: { submissionId: submission.id, kind } });
  }

  const folderId = await getFolderId(
    principal.organizationId,
    kind === MediaKind.VIDEO ? DriveFolderKind.DRAFTS : DriveFolderKind.THUMBNAILS,
  );

  console.log(`[Upload session] Folder ID: ${folderId}`);

  const session = await createResumableUploadSession({
    organizationId: principal.organizationId,
    folderId,
    // Namespace the stored filename so Drive stays browsable.
    filename: `${submission.reference}-${kind.toLowerCase()}-${body.filename}`,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    appProperties: {
      submissionId: submission.id,
      submissionRef: submission.reference,
      kind,
      uploadedBy: principal.id,
    },
  });

  console.log(`[Upload session] Session created: sessionUri prefix ${session.sessionUri.slice(0, 50)}..., expires ${session.expiresAt.toISOString()}`);

  const media = await db.mediaFile.create({
    data: {
      organizationId: principal.organizationId,
      submissionId: submission.id,
      kind,
      originalFilename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: BigInt(body.sizeBytes),
      checksumSha256: body.checksumSha256 ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      durationSeconds: body.durationSeconds ?? null,
      driveFolderId: folderId,
      uploadState: UploadState.IN_PROGRESS,
      resumableSessionUri: session.sessionUri,
      resumableExpiresAt: session.expiresAt,
      bytesReceived: 0n,
      uploadedById: principal.id,
    },
  });

  if (submission.status === SubmissionStatus.DRAFT) {
    await db.submission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.UPLOADING },
    });
  }

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.MEDIA_UPLOAD_STARTED,
    entityType: "MediaFile",
    entityId: media.id,
    submissionId: submission.id,
    newValue: { kind, filename: body.filename, sizeBytes: body.sizeBytes },
    request,
  });

  return ok({
    mediaFileId: media.id,
    // The browser PUTs chunks straight to this. Bytes never touch our server.
    sessionUri: session.sessionUri,
    expiresAt: session.expiresAt,
    // Chunk size the client should use — 256 KiB-aligned, as Google requires.
    chunkSize: 8 * 1024 * 1024,
    duplicateOfSubmissionRef: duplicateOf,
  });
});
