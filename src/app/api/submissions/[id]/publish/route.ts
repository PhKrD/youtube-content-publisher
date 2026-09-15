import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import {
  canPublishSubmission,
  canRetryPublish,
  loadSubmissionFor,
  requireOrganization,
  requirePrincipal,
} from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { assertPublishingAllowed } from "@/lib/publishing/engine";
import { enqueuePublish, getJobForSubmission, isActiveJob } from "@/lib/publishing/queue";
import { buildValidationReport, persistRenderedMetadata, submissionInclude } from "@/lib/submissions";
import { ApprovalMode, JobState, SubmissionStatus } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /**
   * The channel title, typed by the user, echoed back from the confirmation
   * dialog. Section 22 requires the exact channel to be unmistakable at the
   * moment of publishing — a plain "OK" button is too easy to click through.
   */
  confirmChannelTitle: z.string().min(1),
});

/**
 * Queues a publish.
 *
 * Idempotent (Section 26): repeated calls return the existing job rather than
 * creating a second one, and the database's partial unique index makes that
 * true even for two simultaneous requests.
 */
export const POST = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();
  const loaded = await loadSubmissionFor(principal, id);
  const body = await parseJson(request, schema);
  const organization = await requireOrganization(principal);

  // --- already done? ---
  if (loaded.publication?.youtubeVideoId && loaded.status === SubmissionStatus.PUBLISHED) {
    throw Errors.conflict(
      `This was already published as https://www.youtube.com/watch?v=${loaded.publication.youtubeVideoId}. Publishing again would create a duplicate.`,
    );
  }

  // --- already in flight? Return the same job. ---
  const existingJob = await getJobForSubmission(principal.organizationId, id);
  if (isActiveJob(existingJob)) {
    return ok({
      jobId: existingJob!.id,
      state: existingJob!.state,
      alreadyRunning: true,
      message: "This submission is already being published.",
    });
  }

  // --- permission, in this organisation's approval mode ---
  const approvalRequired = organization.approvalMode === ApprovalMode.APPROVAL_REQUIRED;
  const isRetry = loaded.status === SubmissionStatus.FAILED;

  if (!(isRetry ? canRetryPublish(principal, loaded) : canPublishSubmission(principal, loaded, approvalRequired))) {
    if (approvalRequired && loaded.status !== SubmissionStatus.APPROVED) {
      throw Errors.conflict(
        "This organisation requires approval before publishing. Submit it for review first.",
      );
    }
    throw Errors.forbidden("not permitted to publish this submission");
  }

  // --- both safety switches ---
  await assertPublishingAllowed(principal.organizationId);

  // --- the channel must be the one the admin confirmed ---
  const submission = await db.submission.findUniqueOrThrow({
    where: { id },
    include: submissionInclude,
  });

  if (!submission.channel) throw Errors.notConfigured("A YouTube channel");
  if (!submission.channel.confirmedAt) throw Errors.channelNotConfirmed();

  const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalise(body.confirmChannelTitle) !== normalise(submission.channel.title)) {
    throw Errors.validation(
      `That does not match the connected channel. This content will be published to "${submission.channel.title}".`,
      "confirmChannelTitle",
    );
  }

  // --- full validation, server-side ---
  const { report } = await buildValidationReport(submission, organization, principal);
  if (!report.readyToPublish) {
    throw Errors.validation(
      report.errors[0]?.message ?? "This submission is not ready to publish.",
      report.errors[0]?.field,
    );
  }

  // Re-freeze metadata immediately before publishing so YouTube receives
  // exactly what the final review screen displayed.
  await persistRenderedMetadata(submission);

  const { job, created } = await enqueuePublish({
    organizationId: principal.organizationId,
    submissionId: id,
    actorId: principal.id,
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: isRetry ? AuditAction.PUBLISH_RETRIED : AuditAction.PUBLISH_REQUESTED,
    entityType: "Submission",
    entityId: id,
    submissionId: id,
    publishingJobId: job.id,
    newValue: {
      channel: submission.channel.youtubeChannelId,
      playlist: submission.playlist?.youtubePlaylistId ?? null,
    },
    request,
  });

  return ok({
    jobId: job.id,
    state: job.state,
    alreadyRunning: !created,
    warnings: report.warnings,
  });
});

/** Live publishing progress for the detail page (Section 24). */
export const GET = route(async (_request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();
  await loadSubmissionFor(principal, id);

  const [job, publication] = await Promise.all([
    db.publishingJob.findFirst({
      where: { submissionId: id, organizationId: principal.organizationId },
      orderBy: { createdAt: "desc" },
    }),
    db.youTubePublication.findUnique({ where: { submissionId: id } }),
  ]);

  if (!job) return ok({ job: null, publication: null });

  return ok({
    job: {
      id: job.id,
      state: job.state,
      currentStep: job.currentStep,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      bytesSent: Number(job.bytesSent),
      totalBytes: job.totalBytes ? Number(job.totalBytes) : null,
      // The user-safe message; never the internal detail.
      lastError: job.lastError,
      isTerminal: job.isTerminal,
      runAfter: job.runAfter,
      willRetry: job.state === JobState.WAITING_RETRY,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
    publication: publication
      ? {
          youtubeVideoId: publication.youtubeVideoId,
          youtubeUrl: publication.youtubeUrl,
          videoUploadedAt: publication.videoUploadedAt,
          thumbnailAppliedAt: publication.thumbnailAppliedAt,
          playlistAddedAt: publication.playlistAddedAt,
          verifiedAt: publication.verifiedAt,
          uploadStatus: publication.uploadStatus,
          processingStatus: publication.processingStatus,
          rejectionReason: publication.rejectionReason,
        }
      : null,
  });
});
