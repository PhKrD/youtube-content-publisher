import { db } from "../db";
import { isPublishingEnabledGlobally } from "../env";
import { AppError, Errors, toAppError } from "../errors";
import { logger } from "../logger";
import { downloadRange, getFileInfo, getFolderId, moveFile } from "../google/drive";
import {
  addToPlaylist,
  createVideoUploadSession,
  getVideoStatus,
  isVideoInPlaylist,
  probeVideoSession,
  relayChunk,
  setThumbnail,
  type VideoMetadata,
} from "../google/youtube";
import { notify } from "../notifications";
import { heartbeat, markFailed, markSucceeded, saveProgress } from "./queue";
import {
  DriveFolderKind,
  JobStep,
  MediaKind,
  NotificationType,
  SubmissionStatus,
  type PublishingJob,
} from "@/generated/prisma";

/**
 * The publishing state machine (Sections 23, 25, 62).
 *
 * The governing principle: **a step that has already produced an irreversible
 * remote effect is never run twice.** Every completed step writes a timestamp
 * (or an id) to YouTubePublication, and every step begins by checking whether
 * that evidence already exists. That is what makes "the video uploaded but the
 * playlist failed" recoverable by retrying *only* the playlist.
 *
 * Steps, in order:
 *   CREATE_YOUTUBE_UPLOAD  open a resumable session      (no side effect yet)
 *   RELAY_BYTES            move Drive bytes -> YouTube   (creates the video)
 *   APPLY_THUMBNAIL        set the custom thumbnail
 *   ADD_TO_PLAYLIST        insert into the playlist
 *   VERIFY                 confirm YouTube's own view of the video
 *
 * `runJob` executes as many steps as it can inside one invocation and returns.
 * It is safe to call again at any point, from any worker.
 */

/** Stop and yield after this much wall-clock so a serverless invocation can return. */
const MAX_SLICE_MS = 240_000;

export type StepResult =
  | { status: "advanced"; step: JobStep }
  | { status: "completed" }
  | { status: "yield"; reason: string };

/**
 * Both publishing gates (Section 40). Deployment-level AND organisation-level
 * must be on. Two independent switches mean a production .env copied onto a
 * laptop cannot by itself publish to the real channel.
 */
export async function assertPublishingAllowed(organizationId: string): Promise<void> {
  if (!isPublishingEnabledGlobally()) {
    throw Errors.publishingDisabled();
  }
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { productionPublishingEnabled: true },
  });
  if (!org?.productionPublishingEnabled) {
    throw Errors.publishingDisabled();
  }
}

interface JobContext {
  job: PublishingJob;
  submission: NonNullable<Awaited<ReturnType<typeof loadSubmission>>>;
}

async function loadSubmission(submissionId: string) {
  return db.submission.findUnique({
    where: { id: submissionId },
    include: {
      mediaFiles: true,
      playlist: true,
      channel: true,
      publication: true,
      organization: true,
    },
  });
}

/** Publication row, created lazily the moment a video id first exists. */
async function upsertPublication(
  ctx: JobContext,
  data: Partial<{
    youtubeVideoId: string;
    youtubeUrl: string;
    videoUploadedAt: Date;
    thumbnailAppliedAt: Date;
    playlistItemId: string;
    playlistAddedAt: Date;
    verifiedAt: Date;
    uploadStatus: string | null;
    processingStatus: string | null;
    privacyStatus: string | null;
    rejectionReason: string | null;
  }>,
) {
  const { submission } = ctx;
  const existing = await db.youTubePublication.findUnique({
    where: { submissionId: submission.id },
  });

  if (existing) {
    return db.youTubePublication.update({ where: { id: existing.id }, data });
  }
  if (!data.youtubeVideoId) {
    throw Errors.internal("cannot create publication without a youtube video id");
  }
  return db.youTubePublication.create({
    data: {
      organizationId: submission.organizationId,
      submissionId: submission.id,
      channelId: submission.channelId,
      youtubeVideoId: data.youtubeVideoId,
      ...data,
    },
  });
}

function buildMetadata(ctx: JobContext): VideoMetadata {
  const s = ctx.submission;
  if (!s.computedTitle) {
    throw Errors.validation("This submission has no title, so it cannot be published.");
  }
  return {
    title: s.computedTitle,
    description: s.computedDescription ?? "",
    tags: s.tags,
    categoryId: s.categoryId,
    defaultLanguage: s.defaultLanguage,
    privacyStatus: s.privacyStatus,
    publishAt: s.publishMode === "SCHEDULED" ? s.scheduledAt : null,
    madeForKids: s.madeForKids,
  };
}

function requireVideo(ctx: JobContext) {
  const video = ctx.submission.mediaFiles.find((m) => m.kind === MediaKind.VIDEO);
  if (!video?.driveFileId) {
    throw Errors.validation("No uploaded video was found for this submission.");
  }
  return video;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepCreateUpload(ctx: JobContext): Promise<StepResult> {
  // Already have a video? Nothing to create. This is the guard that makes a
  // retry after a mid-publish crash safe.
  if (ctx.submission.publication?.youtubeVideoId) {
    logger.info("video already exists; skipping upload creation", {
      jobId: ctx.job.id,
      videoId: ctx.submission.publication.youtubeVideoId,
    });
    return { status: "advanced", step: JobStep.APPLY_THUMBNAIL };
  }

  const video = requireVideo(ctx);

  // Confirm the bytes are really in Drive and get the authoritative size.
  const info = await getFileInfo(ctx.submission.organizationId, video.driveFileId!);
  if (info.trashed) {
    throw Errors.conflict(
      "The uploaded video has been deleted from Google Drive, so it cannot be published. Please upload the file again.",
    );
  }
  if (info.sizeBytes <= 0) {
    throw Errors.conflict("The uploaded video appears to be empty. Please upload it again.");
  }

  const sessionUri = await createVideoUploadSession({
    organizationId: ctx.submission.organizationId,
    metadata: buildMetadata(ctx),
    sizeBytes: info.sizeBytes,
    mimeType: info.mimeType || video.mimeType,
  });

  await saveProgress(ctx.job.id, {
    youtubeResumableUri: sessionUri,
    totalBytes: BigInt(info.sizeBytes),
    bytesSent: 0n,
    currentStep: JobStep.RELAY_BYTES,
  });

  await db.submissionEvent.create({
    data: {
      submissionId: ctx.submission.id,
      type: "YOUTUBE_UPLOAD_STARTED",
      message: "Started uploading to YouTube.",
    },
  });

  return { status: "advanced", step: JobStep.RELAY_BYTES };
}

/**
 * Moves bytes from Drive to YouTube in aligned chunks.
 *
 * Yields after MAX_SLICE_MS so this works under a serverless time limit;
 * progress is durable, so the next invocation resumes at the committed offset.
 */
async function stepRelayBytes(ctx: JobContext, deadline: number): Promise<StepResult> {
  const { job } = ctx;
  const video = requireVideo(ctx);

  const sessionUri = job.youtubeResumableUri;
  const totalBytes = job.totalBytes ? Number(job.totalBytes) : 0;

  if (!sessionUri || !totalBytes) {
    // Lost the session; go back and make a new one.
    await saveProgress(job.id, { currentStep: JobStep.CREATE_YOUTUBE_UPLOAD, bytesSent: 0n });
    return { status: "advanced", step: JobStep.CREATE_YOUTUBE_UPLOAD };
  }

  // Re-anchor from YouTube rather than trusting our own counter: a previous
  // attempt may have been killed after YouTube committed but before we saved.
  let offset: number;
  const probe = await probeVideoSession(sessionUri, totalBytes);
  if (probe.state === "expired") {
    logger.warn("youtube session expired; restarting upload", { jobId: job.id });
    await saveProgress(job.id, {
      youtubeResumableUri: null,
      bytesSent: 0n,
      currentStep: JobStep.CREATE_YOUTUBE_UPLOAD,
    });
    return { status: "advanced", step: JobStep.CREATE_YOUTUBE_UPLOAD };
  }
  if (probe.state === "complete") {
    if (!probe.videoId) throw Errors.internal("session complete but no video id returned");
    await onVideoCreated(ctx, probe.videoId, null);
    return { status: "advanced", step: JobStep.APPLY_THUMBNAIL };
  }
  offset = probe.bytesReceived;

  while (offset < totalBytes) {
    if (Date.now() > deadline) {
      await saveProgress(job.id, { bytesSent: BigInt(offset) });
      return { status: "yield", reason: "time slice exhausted" };
    }

    const outcome = await relayChunk({
      organizationId: ctx.submission.organizationId,
      sessionUri,
      driveFileId: video.driveFileId!,
      offset,
      totalBytes,
    });

    offset = outcome.bytesSent;
    await saveProgress(job.id, { bytesSent: BigInt(offset) });
    await heartbeat(job.id, job.lockedBy ?? "");

    if (outcome.done) {
      await onVideoCreated(ctx, outcome.videoId, outcome.uploadStatus);
      return { status: "advanced", step: JobStep.APPLY_THUMBNAIL };
    }
  }

  // Sent everything but YouTube never returned a video resource — ask it.
  const final = await probeVideoSession(sessionUri, totalBytes);
  if (final.state === "complete" && final.videoId) {
    await onVideoCreated(ctx, final.videoId, null);
    return { status: "advanced", step: JobStep.APPLY_THUMBNAIL };
  }
  throw Errors.internal("upload finished but YouTube did not confirm a video id");
}

/** Records the video id — the first irreversible effect — then advances. */
async function onVideoCreated(
  ctx: JobContext,
  videoId: string,
  uploadStatus: string | null,
): Promise<void> {
  await upsertPublication(ctx, {
    youtubeVideoId: videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoUploadedAt: new Date(),
    uploadStatus,
  });
  await saveProgress(ctx.job.id, {
    currentStep: JobStep.APPLY_THUMBNAIL,
    // The session is spent; clearing it prevents an accidental second use.
    youtubeResumableUri: null,
  });
  await db.submissionEvent.create({
    data: {
      submissionId: ctx.submission.id,
      type: "YOUTUBE_UPLOADED",
      message: "Video uploaded to YouTube.",
      metadata: { videoId },
    },
  });
  // Refresh so later steps see the publication row.
  ctx.submission = (await loadSubmission(ctx.submission.id))!;
  logger.info("youtube video created", { jobId: ctx.job.id, videoId });
}

async function stepApplyThumbnail(ctx: JobContext): Promise<StepResult> {
  const pub = ctx.submission.publication;
  if (!pub?.youtubeVideoId) throw Errors.internal("thumbnail step without a video id");

  if (pub.thumbnailAppliedAt) {
    return { status: "advanced", step: JobStep.ADD_TO_PLAYLIST };
  }

  const thumb = ctx.submission.mediaFiles.find((m) => m.kind === MediaKind.THUMBNAIL);
  if (!thumb?.driveFileId) {
    // A thumbnail is optional: YouTube auto-generates one. Do not fail a
    // publish over it.
    logger.info("no thumbnail supplied; skipping", { jobId: ctx.job.id });
    return { status: "advanced", step: JobStep.ADD_TO_PLAYLIST };
  }

  const info = await getFileInfo(ctx.submission.organizationId, thumb.driveFileId);
  const image = await downloadRange(
    ctx.submission.organizationId,
    thumb.driveFileId,
    0,
    Math.max(info.sizeBytes - 1, 0),
  );

  await setThumbnail({
    organizationId: ctx.submission.organizationId,
    videoId: pub.youtubeVideoId,
    image,
    mimeType: info.mimeType || thumb.mimeType,
  });

  await upsertPublication(ctx, { thumbnailAppliedAt: new Date() });
  await saveProgress(ctx.job.id, { currentStep: JobStep.ADD_TO_PLAYLIST });
  await db.submissionEvent.create({
    data: {
      submissionId: ctx.submission.id,
      type: "THUMBNAIL_APPLIED",
      message: "Thumbnail applied.",
    },
  });
  return { status: "advanced", step: JobStep.ADD_TO_PLAYLIST };
}

async function stepAddToPlaylist(ctx: JobContext): Promise<StepResult> {
  const pub = ctx.submission.publication;
  if (!pub?.youtubeVideoId) throw Errors.internal("playlist step without a video id");

  if (pub.playlistAddedAt) {
    return { status: "advanced", step: JobStep.VERIFY };
  }

  const playlist = ctx.submission.playlist;
  if (!playlist) {
    return { status: "advanced", step: JobStep.VERIFY };
  }

  // Ask YouTube first. If a previous attempt succeeded but crashed before
  // recording it, inserting again would create a duplicate playlist entry.
  const already = await isVideoInPlaylist({
    organizationId: ctx.submission.organizationId,
    playlistId: playlist.youtubePlaylistId,
    videoId: pub.youtubeVideoId,
  });

  const itemId =
    already ??
    (await addToPlaylist({
      organizationId: ctx.submission.organizationId,
      playlistId: playlist.youtubePlaylistId,
      videoId: pub.youtubeVideoId,
    }));

  await upsertPublication(ctx, { playlistItemId: itemId, playlistAddedAt: new Date() });
  await saveProgress(ctx.job.id, { currentStep: JobStep.VERIFY });
  await db.submissionEvent.create({
    data: {
      submissionId: ctx.submission.id,
      type: "PLAYLIST_ADDED",
      message: `Added to playlist "${playlist.title}".`,
      metadata: { playlistId: playlist.youtubePlaylistId, itemId, alreadyPresent: Boolean(already) },
    },
  });
  return { status: "advanced", step: JobStep.VERIFY };
}

/**
 * Confirms YouTube's own view of the video before declaring success, and
 * catches the case where YouTube accepted the bytes then rejected the content
 * (copyright, ToS) during processing.
 */
async function stepVerify(ctx: JobContext): Promise<StepResult> {
  const pub = ctx.submission.publication;
  if (!pub?.youtubeVideoId) throw Errors.internal("verify step without a video id");

  const status = await getVideoStatus(ctx.submission.organizationId, pub.youtubeVideoId);

  if (!status) {
    throw new AppError({
      code: "YOUTUBE_UNAVAILABLE",
      userMessage:
        "The video was uploaded but YouTube has not made it readable yet. This will be checked again shortly.",
      retryable: true,
      retryAfterSeconds: 60,
    });
  }

  if (
    status.uploadStatus === "rejected" ||
    status.uploadStatus === "failed" ||
    status.processingStatus === "failed" ||
    status.processingStatus === "terminated"
  ) {
    await upsertPublication(ctx, {
      uploadStatus: status.uploadStatus,
      processingStatus: status.processingStatus,
      rejectionReason: status.rejectionReason,
      privacyStatus: status.privacyStatus,
    });
    throw new AppError({
      code: "YOUTUBE_REJECTED",
      userMessage: `YouTube could not process this video${
        status.rejectionReason ? ` (${status.rejectionReason})` : ""
      }. It was not published. The original file is still safe in Google Drive.`,
      terminal: true,
    });
  }

  await upsertPublication(ctx, {
    uploadStatus: status.uploadStatus,
    processingStatus: status.processingStatus,
    privacyStatus: status.privacyStatus,
  });

  if (status.processingStatus !== "succeeded") {
    throw new AppError({
      code: "YOUTUBE_UNAVAILABLE",
      userMessage: "The upload is complete and YouTube is still processing the video. It will be checked again automatically.",
      retryable: true,
      retryAfterSeconds: 60,
    });
  }

  await upsertPublication(ctx, { verifiedAt: new Date() });
  await finalise(ctx);
  return { status: "completed" };
}

/** Marks the submission published, notifies, and files the Drive copy. */
async function finalise(ctx: JobContext): Promise<void> {
  const s = ctx.submission;

  await db.$transaction([
    db.submission.update({
      where: { id: s.id },
      data: { status: SubmissionStatus.PUBLISHED, publishedAt: new Date() },
    }),
    db.submissionEvent.create({
      data: {
        submissionId: s.id,
        type: "PUBLISHED",
        message: "Published to YouTube.",
        metadata: { videoId: s.publication?.youtubeVideoId },
      },
    }),
  ]);

  await markSucceeded(ctx.job.id);

  await notify({
    organizationId: s.organizationId,
    userId: s.createdById,
    type: NotificationType.PUBLISH_SUCCEEDED,
    title: "Your video has been published",
    body: s.computedTitle ?? undefined,
    submissionId: s.id,
    linkPath: `/content/${s.id}`,
  });

  // Housekeeping only — never allowed to fail the publish.
  try {
    const published = await getFolderId(s.organizationId, DriveFolderKind.PUBLISHED);
    for (const m of s.mediaFiles) {
      if (m.driveFileId && m.kind === MediaKind.VIDEO) {
        await moveFile(s.organizationId, m.driveFileId, published);
      }
    }
  } catch (e) {
    logger.warn("post-publish drive filing failed", {
      submissionId: s.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  logger.info("submission published", {
    submissionId: s.id,
    videoId: s.publication?.youtubeVideoId,
  });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Executes a claimed job until it completes, fails, or runs out of time.
 * Never throws: every outcome is recorded on the job.
 */
export async function runJob(job: PublishingJob): Promise<"completed" | "failed" | "yielded"> {
  const deadline = Date.now() + MAX_SLICE_MS;
  const log = logger.child({ jobId: job.id, submissionId: job.submissionId });

  try {
    const submission = await loadSubmission(job.submissionId);
    if (!submission) throw Errors.notFound("submission");

    // --- safety gates, re-checked on every attempt ---
    await assertPublishingAllowed(submission.organizationId);
    if (!submission.channel) {
      throw Errors.notConfigured("A YouTube channel");
    }
    if (!submission.channel.confirmedAt) {
      throw Errors.channelNotConfirmed();
    }

    const ctx: JobContext = { job, submission };
    let step = job.currentStep;

    for (let guard = 0; guard < 12; guard++) {
      if (Date.now() > deadline) {
        log.info("yielding: time slice exhausted", { step });
        return "yielded";
      }

      let result: StepResult;
      switch (step) {
        case JobStep.CREATE_YOUTUBE_UPLOAD:
          result = await stepCreateUpload(ctx);
          break;
        case JobStep.RELAY_BYTES:
          result = await stepRelayBytes(ctx, deadline);
          break;
        case JobStep.APPLY_THUMBNAIL:
          result = await stepApplyThumbnail(ctx);
          break;
        case JobStep.ADD_TO_PLAYLIST:
          result = await stepAddToPlaylist(ctx);
          break;
        case JobStep.VERIFY:
          result = await stepVerify(ctx);
          break;
        case JobStep.DONE:
          return "completed";
      }

      if (result.status === "completed") return "completed";
      if (result.status === "yield") {
        log.info("yielding", { step, reason: result.reason });
        return "yielded";
      }
      step = result.step;
      // Keep the in-memory job in step with what was persisted.
      ctx.job = (await db.publishingJob.findUnique({ where: { id: job.id } })) ?? ctx.job;
    }

    log.warn("step guard tripped; yielding to avoid a loop", { step });
    return "yielded";
  } catch (err) {
    const appError = toAppError(err);
    await markFailed(job.id, appError);

    const submission = await db.submission.findUnique({
      where: { id: job.submissionId },
      select: { createdById: true, organizationId: true, computedTitle: true },
    });
    if (submission) {
      await notify({
        organizationId: submission.organizationId,
        userId: submission.createdById,
        type: NotificationType.PUBLISH_FAILED,
        title: "Publishing failed",
        body: appError.userMessage,
        submissionId: job.submissionId,
        linkPath: `/content/${job.submissionId}`,
      }).catch(() => {
        /* a failed notification must not mask the real failure */
      });
    }
    return "failed";
  }
}
