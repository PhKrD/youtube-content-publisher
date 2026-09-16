import { z } from "zod";
import { ok, route } from "@/lib/api";
import { loadSubmissionFor, requirePrincipal, requireOrganization } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { getFolderId, uploadToDriveDirect } from "@/lib/google/drive";
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
 * Direct upload: browser sends file to our server, server uploads to Drive.
 *
 * This avoids CORS issues with Google's resumable upload endpoint, which doesn't
 * support CORS for arbitrary origins like *.vercel.app.
 *
 * Trade-off: bytes go through our server, so we pay egress and hit the 4.5 MB
 * serverless body limit. For larger files, we'd need a streaming approach.
 */
export const POST = route(async (request) => {
  const principal = await requirePrincipal();
  const formData = await request.formData();

  const submissionId = formData.get("submissionId") as string;
  const kind = formData.get("kind") as string;
  const filename = formData.get("filename") as string;
  const mimeType = formData.get("mimeType") as string;
  const sizeBytes = Number(formData.get("sizeBytes"));
  const checksumSha256 = formData.get("checksumSha256") as string | null;
  const width = formData.get("width") ? Number(formData.get("width")) : undefined;
  const height = formData.get("height") ? Number(formData.get("height")) : undefined;
  const durationSeconds = formData.get("durationSeconds") ? Number(formData.get("durationSeconds")) : undefined;
  const file = formData.get("file") as File | null;

  console.log(`[Direct upload] Received: submission ${submissionId}, kind ${kind}, file ${filename}, size ${sizeBytes}, has file: ${file !== null}, file size: ${file?.size}`);

  if (!file) {
    console.error(`[Direct upload] No file provided`);
    throw Errors.validation("No file provided");
  }

  console.log(`[Direct upload] File details: name=${file.name}, type=${file.type}, size=${file.size}`);

  if (sizeBytes > MAX_UPLOAD_BYTES) {
    console.error(`[Direct upload] File too large: ${sizeBytes} > ${MAX_UPLOAD_BYTES}`);
    throw Errors.payloadTooLarge(
      `That file is ${formatBytes(sizeBytes)}, over the ${formatBytes(MAX_UPLOAD_BYTES)} serverless limit. For larger files, contact support.`,
    );
  }

  const body = {
    submissionId,
    kind,
    filename,
    mimeType,
    sizeBytes,
    checksumSha256: checksumSha256 || undefined,
    width,
    height,
    durationSeconds,
  };

  console.log(`[Direct upload] Parsed body:`, body);

  const parsed = schema.parse(body);

  console.log(`[Direct upload] Schema validation passed`);

  const submission = await loadSubmissionFor(principal, parsed.submissionId, { forEdit: true });
  const org = await requireOrganization(principal);
  const kindTyped = parsed.kind as MediaKind;

  // ---- type & size, per kind ----
  if (kindTyped === MediaKind.VIDEO) {
    if (!(ACCEPTED_VIDEO_MIME as readonly string[]).includes(parsed.mimeType)) {
      throw Errors.unsupportedMedia(
        `"${parsed.mimeType}" is not a video format YouTube accepts. Please use MP4 (H.264).`,
        "video",
      );
    }
    if (parsed.sizeBytes > Number(org.maxVideoBytes)) {
      throw Errors.payloadTooLarge(
        `That video is ${formatBytes(parsed.sizeBytes)}, over the ${formatBytes(
          Number(org.maxVideoBytes),
        )} limit for this organisation.`,
      );
    }
  } else {
    if (!(ACCEPTED_THUMBNAIL_MIME as readonly string[]).includes(parsed.mimeType)) {
      throw Errors.unsupportedMedia("Images must be JPEG or PNG.", "thumbnail");
    }
    if (parsed.sizeBytes > Number(org.maxThumbnailBytes)) {
      throw Errors.payloadTooLarge(
        `That image is ${formatBytes(parsed.sizeBytes)}. The limit is ${formatBytes(
          Number(org.maxThumbnailBytes),
        )}.`,
      );
    }
  }

  // ---- duplicate detection (Section 26) ----
  let duplicateOf: string | null = null;
  if (parsed.checksumSha256 && kindTyped === MediaKind.VIDEO) {
    const existing = await db.mediaFile.findFirst({
      where: {
        organizationId: principal.organizationId,
        checksumSha256: parsed.checksumSha256,
        uploadState: UploadState.COMPLETED,
        submissionId: { not: submission.id },
      },
      include: { submission: { select: { reference: true } } },
    });
    duplicateOf = existing?.submission.reference ?? null;
  }

  // ---- replace any previous file of this kind ----
  if (kindTyped !== MediaKind.SUPPORTING_IMAGE) {
    await db.mediaFile.deleteMany({ where: { submissionId: submission.id, kind: kindTyped } });
  }

  const folderId = await getFolderId(
    principal.organizationId,
    kindTyped === MediaKind.VIDEO ? DriveFolderKind.DRAFTS : DriveFolderKind.THUMBNAILS,
  );

  console.log(`[Direct upload] Folder ID: ${folderId}`);

  let media: any;
  let driveFile: any;

  try {
    console.log(`[Direct upload] About to call uploadToDriveDirect`);

    // Upload to Drive directly from the server
    driveFile = await uploadToDriveDirect({
      organizationId: principal.organizationId,
      folderId,
      filename: `${submission.reference}-${kindTyped.toLowerCase()}-${parsed.filename}`,
      mimeType: parsed.mimeType,
      file: file,
      appProperties: {
        submissionId: submission.id,
        submissionRef: submission.reference,
        kind: kindTyped,
        uploadedBy: principal.id,
      },
    });

    console.log(`[Direct upload] Drive upload complete: file ID ${driveFile.id}`);

    media = await db.mediaFile.create({
      data: {
        organizationId: principal.organizationId,
        submissionId: submission.id,
        kind: kindTyped,
        originalFilename: parsed.filename,
        mimeType: parsed.mimeType,
        sizeBytes: BigInt(parsed.sizeBytes),
        checksumSha256: parsed.checksumSha256 ?? null,
        width: parsed.width ?? null,
        height: parsed.height ?? null,
        durationSeconds: parsed.durationSeconds ?? null,
        driveFolderId: folderId,
        driveFileId: driveFile.id,
        driveMd5: driveFile.md5Checksum ?? null,
        driveWebViewLink: driveFile.webViewLink ?? null,
        uploadState: UploadState.COMPLETED,
        bytesReceived: BigInt(parsed.sizeBytes),
        completedAt: new Date(),
        uploadedById: principal.id,
      },
    });

    console.log(`[Direct upload] Database record created: ${media.id}`);

    if (submission.status === SubmissionStatus.DRAFT) {
      await db.submission.update({
        where: { id: submission.id },
        data: { status: SubmissionStatus.UPLOADED_TO_DRIVE },
      });
    }
  } catch (err) {
    console.error(`[Direct upload] Error during Drive upload:`, err);
    throw err;
  }

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.MEDIA_UPLOAD_COMPLETED,
    entityType: "MediaFile",
    entityId: media.id,
    submissionId: submission.id,
    driveFileId: driveFile.id,
    request,
  });

  return ok({
    mediaFileId: media.id,
    driveFileId: driveFile.id,
    webViewLink: driveFile.webViewLink ?? null,
    duplicateOfSubmissionRef: duplicateOf,
  });
});
