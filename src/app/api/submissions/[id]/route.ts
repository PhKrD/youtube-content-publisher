import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { canRemoveSubmission, loadSubmissionFor, requireOrganization, requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { deleteFile } from "@/lib/google/drive";
import {
  buildValidationReport,
  findTemplatesForProgram,
  submissionInclude,
} from "@/lib/submissions";
import { POST_TEMPLATE_MAX } from "@/lib/content-fields";
import { SubmissionStatus } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Full submission, with live preview and validation. */
export const GET = route(async (_request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();
  await loadSubmissionFor(principal, id);

  const submission = await db.submission.findUniqueOrThrow({
    where: { id },
    include: submissionInclude,
  });
  const organization = await requireOrganization(principal);
  const { report, rendered } = await buildValidationReport(submission, organization, principal);

  return ok({
    submission: {
      id: submission.id,
      reference: submission.reference,
      status: submission.status,
      program: submission.program,
      topic: submission.topic,
      speaker: submission.speaker,
      location: submission.location,
      recordedOn: submission.recordedOn,
      templateValues: submission.templateValues,
      playlistId: submission.playlistId,
      categoryId: submission.categoryId,
      defaultLanguage: submission.defaultLanguage,
      privacyStatus: submission.privacyStatus,
      publishMode: submission.publishMode,
      scheduledAt: submission.scheduledAt,
      tags: submission.tags,
      madeForKids: submission.madeForKids,
    },
    preview: {
      title: rendered.title.text,
      titleLength: rendered.title.length,
      description: rendered.description.text,
      descriptionLength: rendered.description.length,
      tags: rendered.tags.tags,
      droppedTags: rendered.tags.dropped,
      reAddedTags: rendered.tags.reAdded,
      withPlaceholders: rendered.withPlaceholders,
    },
    validation: report,
  });
});

const updateSchema = z.object({
  program: z.enum(["FFL", "PITRU_PAKSHA", "OTHERS"]).nullish(),
  topic: z.string().max(300).nullish(),
  speaker: z.string().max(200).nullish(),
  location: z.string().max(200).nullish(),
  recordedOn: z.string().datetime().nullish(),
  templateValues: z.record(z.string(), z.unknown()).optional(),
  titleOverride: z.string().max(200).nullish(),
  playlistId: z.string().nullish(),
  categoryId: z.string().max(10).optional(),
  defaultLanguage: z.string().max(10).optional(),
  privacyStatus: z.enum(["PRIVATE", "UNLISTED", "PUBLIC"]).optional(),
  publishMode: z.enum(["NOW", "SCHEDULED"]).optional(),
  scheduledAt: z.string().datetime().nullish(),
  tags: z.array(z.string().max(100)).max(80).optional(),
  madeForKids: z.boolean().optional(),
  /** Companion post text; null returns to the organisation's default. */
  postText: z.string().max(POST_TEMPLATE_MAX).nullish(),
});

/**
 * Updates a draft.
 *
 * Note what is NOT accepted: `status`, `computedTitle`, `computedDescription`,
 * `reference`, `organizationId`. Those are derived or privileged, and allowing
 * a client to set them would let a contributor mark their own work APPROVED.
 */
export const PATCH = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();
  const existing = await loadSubmissionFor(principal, id, { forEdit: true });
  const body = await parseJson(request, updateSchema);

  // A playlist must belong to this organisation and still be usable.
  if (body.playlistId) {
    const playlist = await db.playlist.findUnique({ where: { id: body.playlistId } });
    if (!playlist || playlist.organizationId !== principal.organizationId) {
      throw Errors.validation("That playlist does not exist.", "playlistId");
    }
    if (!playlist.isAllowed) {
      throw Errors.validation(
        "That playlist is no longer available for new content.",
        "playlistId",
      );
    }
  }

  const publishMode = body.publishMode ?? existing.publishMode;
  const scheduledAt =
    body.scheduledAt === undefined
      ? existing.scheduledAt
      : body.scheduledAt
        ? new Date(body.scheduledAt)
        : null;

  // Mirrors the database CHECK constraints so the user gets a helpful message
  // instead of a raw constraint violation.
  if (publishMode === "SCHEDULED") {
    if (!scheduledAt) {
      throw Errors.validation("Choose when this should be published.", "scheduledAt");
    }
    if (scheduledAt.getTime() <= Date.now()) {
      throw Errors.validation("The scheduled time must be in the future.", "scheduledAt");
    }
  }

  // A different programme means a different pair of templates.
  const programChanged = body.program && body.program !== existing.program;
  const templates = programChanged
    ? await findTemplatesForProgram(principal.organizationId, body.program!)
    : null;

  const updated = await db.submission.update({
    where: { id },
    data: {
      ...(body.program ? { program: body.program } : {}),
      ...(templates?.titleTemplate ? { titleTemplateId: templates.titleTemplate.id } : {}),
      ...(templates?.descriptionTemplate
        ? { descriptionTemplateId: templates.descriptionTemplate.id }
        : {}),
      ...(body.topic !== undefined ? { topic: body.topic } : {}),
      ...(body.speaker !== undefined ? { speaker: body.speaker } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.recordedOn !== undefined
        ? { recordedOn: body.recordedOn ? new Date(body.recordedOn) : null }
        : {}),
      ...(body.templateValues !== undefined
        ? { templateValues: body.templateValues as never }
        : {}),
      ...(body.titleOverride !== undefined ? { titleOverride: body.titleOverride } : {}),
      ...(body.playlistId !== undefined ? { playlistId: body.playlistId } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.defaultLanguage !== undefined ? { defaultLanguage: body.defaultLanguage } : {}),
      // YouTube only honours publishAt on a private video, so scheduling
      // forces PRIVATE. The database enforces this too.
      ...(publishMode === "SCHEDULED"
        ? { publishMode, scheduledAt, privacyStatus: "PRIVATE" as const }
        : {
            ...(body.publishMode !== undefined ? { publishMode } : {}),
            ...(body.scheduledAt !== undefined ? { scheduledAt } : {}),
            ...(body.privacyStatus !== undefined ? { privacyStatus: body.privacyStatus } : {}),
          }),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.madeForKids !== undefined ? { madeForKids: body.madeForKids } : {}),
      ...(body.postText !== undefined ? { postText: body.postText?.trim() ? body.postText : null } : {}),
      // Editing after "changes requested" returns it to the contributor's
      // own queue rather than leaving it flagged.
      ...(existing.status === SubmissionStatus.CHANGES_REQUESTED
        ? { status: SubmissionStatus.READY }
        : {}),
    },
    include: submissionInclude,
  });

  const organization = await requireOrganization(principal);
  const { report, rendered } = await buildValidationReport(updated, organization, principal);

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SUBMISSION_UPDATED,
    entityType: "Submission",
    entityId: id,
    submissionId: id,
    newValue: Object.keys(body),
    request,
  });

  return ok({
    preview: {
      title: rendered.title.text,
      titleLength: rendered.title.length,
      description: rendered.description.text,
      descriptionLength: rendered.description.length,
      tags: rendered.tags.tags,
      droppedTags: rendered.tags.dropped,
      reAddedTags: rendered.tags.reAdded,
      postDefault: rendered.post.defaultText,
      withPlaceholders: rendered.withPlaceholders,
    },
    validation: report,
    status: updated.status,
    /** The editor must reload its fields: the templates were swapped. */
    templatesChanged: Boolean(programChanged),
  });
});

/** Deletes a draft. Published content is archived instead, never deleted. */
export const DELETE = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();
  const submission = await loadSubmissionFor(principal, id);

  if (!canRemoveSubmission(principal, submission)) {
    throw Errors.forbidden("cannot remove this submission");
  }

  if (submission.publication?.youtubeVideoId) {
    await db.$transaction([
      db.submission.update({
        where: { id },
        data: { status: SubmissionStatus.ARCHIVED, archivedAt: new Date() },
      }),
      db.submissionEvent.create({
        data: {
          submissionId: id,
          actorId: principal.id,
          type: "ARCHIVED",
          message: "Removed from recent content and archived.",
        },
      }),
    ]);

    await audit({
      organizationId: principal.organizationId,
      actorId: principal.id,
      action: AuditAction.SUBMISSION_ARCHIVED,
      entityType: "Submission",
      entityId: id,
      submissionId: id,
      youtubeVideoId: submission.publication.youtubeVideoId,
      oldValue: { status: submission.status },
      newValue: { status: SubmissionStatus.ARCHIVED },
      request,
    });

    return ok({ deleted: false, archived: true });
  }

  await Promise.all(
    submission.mediaFiles.flatMap((file) =>
      file.driveFileId ? [deleteFile(principal.organizationId, file.driveFileId)] : [],
    ),
  );
  await db.submission.delete({ where: { id } });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SUBMISSION_DELETED,
    entityType: "Submission",
    entityId: id,
    oldValue: { reference: submission.reference, status: submission.status },
    request,
  });

  return ok({ deleted: true, archived: false });
});
