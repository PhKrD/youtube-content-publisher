import { ok, route } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { canDeletePublishedMedia, loadSubmissionFor, requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { deleteFile } from "@/lib/google/drive";
import { MediaKind } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const DELETE = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();
  const submission = await loadSubmissionFor(principal, id);

  if (!canDeletePublishedMedia(principal, submission)) {
    throw Errors.forbidden("only the creator or an admin can delete media after publication");
  }
  if (!submission.publication?.youtubeVideoId) {
    throw Errors.conflict("The YouTube video must be published before its Drive files can be deleted.");
  }

  const media = submission.mediaFiles.filter((file) =>
    [MediaKind.VIDEO, MediaKind.THUMBNAIL, MediaKind.SUPPORTING_IMAGE].includes(file.kind),
  );
  const results = await Promise.allSettled(
    media.map(async (file) => {
      if (file.driveFileId) await deleteFile(principal.organizationId, file.driveFileId);
      return file;
    }),
  );
  const deleted = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failed = results.flatMap((result, index) =>
    result.status === "rejected" ? [{ id: media[index]!.id, name: media[index]!.originalFilename }] : [],
  );

  if (deleted.length > 0) {
    await db.$transaction([
      db.mediaFile.deleteMany({ where: { id: { in: deleted.map((file) => file.id) } } }),
      db.submissionEvent.create({
        data: {
          submissionId: id,
          actorId: principal.id,
          type: "DRIVE_MEDIA_DELETED",
          message: `Deleted ${deleted.length} media file${deleted.length === 1 ? "" : "s"} from Google Drive after publication.`,
        },
      }),
    ]);
  }

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.MEDIA_DELETED,
    entityType: "SubmissionMedia",
    entityId: id,
    submissionId: id,
    youtubeVideoId: submission.publication.youtubeVideoId,
    oldValue: { files: media.map((file) => ({ id: file.id, kind: file.kind, driveFileId: file.driveFileId })) },
    newValue: { deletedIds: deleted.map((file) => file.id), failedIds: failed.map((file) => file.id) },
    result: failed.length > 0 ? "FAILURE" : "SUCCESS",
    errorMessage: failed.length > 0 ? "One or more Drive files could not be deleted." : null,
    request,
  });

  return ok({ deleted: deleted.length, failed });
});
