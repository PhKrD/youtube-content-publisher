import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { canEditSubmission, requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { deleteFile, getFileInfo, probeResumableSession } from "@/lib/google/drive";
import { MediaKind, SubmissionStatus, UploadState } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Loads a media file and authorises the caller against its submission. */
async function loadMedia(id: string) {
  const principal = await requirePrincipal();
  const media = await db.mediaFile.findUnique({
    where: { id },
    include: { submission: true },
  });
  if (!media || media.organizationId !== principal.organizationId) {
    throw Errors.notFound("upload");
  }
  if (!canEditSubmission(principal, media.submission)) {
    throw Errors.forbidden("cannot modify media on this submission");
  }
  return { principal, media };
}

/**
 * Upload status, including the byte offset to resume from.
 *
 * This is what makes "close the browser and come back" work (Section 12): the
 * offset is read from Drive, not from anything the client remembered.
 */
export const GET = route(async (_request, { params }: Params) => {
  const { id } = await params;
  const { media } = await loadMedia(id);

  if (media.uploadState === UploadState.COMPLETED) {
    return ok({
      state: "COMPLETED",
      bytesReceived: Number(media.sizeBytes),
      sizeBytes: Number(media.sizeBytes),
      driveFileId: media.driveFileId,
    });
  }

  if (!media.resumableSessionUri) {
    return ok({ state: media.uploadState, bytesReceived: 0, sizeBytes: Number(media.sizeBytes) });
  }

  // Expired by our own clock — do not even ask Google.
  if (media.resumableExpiresAt && media.resumableExpiresAt < new Date()) {
    await db.mediaFile.update({
      where: { id: media.id },
      data: { uploadState: UploadState.FAILED, lastError: "Upload session expired." },
    });
    return ok({ state: "EXPIRED", bytesReceived: 0, sizeBytes: Number(media.sizeBytes) });
  }

  const probe = await probeResumableSession(media.resumableSessionUri, Number(media.sizeBytes));

  if (probe.state === "expired") {
    await db.mediaFile.update({
      where: { id: media.id },
      data: {
        uploadState: UploadState.FAILED,
        resumableSessionUri: null,
        lastError: "Upload session expired.",
      },
    });
    return ok({ state: "EXPIRED", bytesReceived: 0, sizeBytes: Number(media.sizeBytes) });
  }

  await db.mediaFile.update({
    where: { id: media.id },
    data: { bytesReceived: BigInt(probe.receivedBytes) },
  });

  return ok({
    state: probe.state === "complete" ? "READY_TO_FINALISE" : "IN_PROGRESS",
    bytesReceived: probe.receivedBytes,
    sizeBytes: Number(media.sizeBytes),
    // Deliberately NOT returning the session URI here; the client already has
    // it from the create call and it should not be re-exposed in a GET.
  });
});

const completeSchema = z.object({
  driveFileId: z.string().min(1),
  driveMd5: z.string().optional(),
  webViewLink: z.string().optional(),
});

/**
 * Finalises an upload once the browser reports the last chunk accepted.
 *
 * The client's claim is verified against Drive rather than trusted: we
 * re-read the file and compare the size. A truncated upload that the client
 * believed had finished would otherwise be published as a corrupt video.
 */
export const POST = route(async (request, { params }: Params) => {
  const { id } = await params;
  const { principal, media } = await loadMedia(id);
  const body = await parseJson(request, completeSchema);

  const info = await getFileInfo(principal.organizationId, body.driveFileId);

  if (info.sizeBytes !== Number(media.sizeBytes)) {
    await db.mediaFile.update({
      where: { id: media.id },
      data: {
        uploadState: UploadState.FAILED,
        lastError: `Size mismatch: Drive has ${info.sizeBytes}, expected ${media.sizeBytes}.`,
      },
    });
    throw Errors.conflict(
      "The uploaded file is incomplete. Please upload it again.",
      `size mismatch drive=${info.sizeBytes} expected=${media.sizeBytes}`,
    );
  }

  const updated = await db.mediaFile.update({
    where: { id: media.id },
    data: {
      uploadState: UploadState.COMPLETED,
      driveFileId: info.id,
      driveMd5: info.md5Checksum ?? body.driveMd5 ?? null,
      driveWebViewLink: info.webViewLink ?? body.webViewLink ?? null,
      bytesReceived: BigInt(info.sizeBytes),
      completedAt: new Date(),
      // The session is spent — drop the capability URL.
      resumableSessionUri: null,
      lastError: null,
    },
  });

  // Advance the submission once its video is safely in Drive.
  if (media.kind === MediaKind.VIDEO && media.submission.status === SubmissionStatus.UPLOADING) {
    await db.submission.update({
      where: { id: media.submissionId },
      data: { status: SubmissionStatus.UPLOADED_TO_DRIVE },
    });
  }

  await db.submissionEvent.create({
    data: {
      submissionId: media.submissionId,
      actorId: principal.id,
      type: "MEDIA_UPLOADED",
      message:
        media.kind === MediaKind.VIDEO
          ? "Video uploaded to Google Drive."
          : "Thumbnail uploaded to Google Drive.",
      metadata: { filename: media.originalFilename },
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.MEDIA_UPLOAD_COMPLETED,
    entityType: "MediaFile",
    entityId: media.id,
    submissionId: media.submissionId,
    driveFileId: info.id,
    request,
  });

  logger.info("upload completed", {
    mediaFileId: media.id,
    submissionId: media.submissionId,
    kind: media.kind,
  });

  return ok({
    state: "COMPLETED",
    mediaFileId: updated.id,
    driveFileId: updated.driveFileId,
    webViewLink: updated.driveWebViewLink,
  });
});

/** Removes a file from the submission, and from Drive where possible. */
export const DELETE = route(async (request, { params }: Params) => {
  const { id } = await params;
  const { principal, media } = await loadMedia(id);

  if (media.driveFileId) {
    // A failed remote delete must not block removing it from the submission;
    // an orphaned Drive file is harmless, a stuck UI is not.
    await deleteFile(principal.organizationId, media.driveFileId).catch((e) =>
      logger.warn("drive delete failed; removing record anyway", {
        mediaFileId: media.id,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  await db.mediaFile.delete({ where: { id: media.id } });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.MEDIA_DELETED,
    entityType: "MediaFile",
    entityId: media.id,
    submissionId: media.submissionId,
    driveFileId: media.driveFileId,
    request,
  });

  return ok({ deleted: true });
});
