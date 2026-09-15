import { randomUUID } from "node:crypto";
import { db } from "../db";
import { AppError, Errors } from "../errors";
import { logger } from "../logger";
import { JobState, JobStep, SubmissionStatus, type PublishingJob } from "@/generated/prisma";

/**
 * Durable job queue, in PostgreSQL (Section 23).
 *
 * No Redis, no external broker. That is a considered choice, not a shortcut:
 *
 *  - Claiming uses `FOR UPDATE SKIP LOCKED`, the standard Postgres queue
 *    pattern, which is safe with any number of concurrent workers.
 *  - Enqueue and the submission's status change happen in ONE transaction, so
 *    the two can never disagree — the classic failure of a separate broker.
 *  - Duplicate enqueue is rejected by a partial unique index rather than by
 *    application logic, so it holds even under a genuine race.
 *
 * Jobs are *leased* rather than simply marked running. A worker that is killed
 * mid-upload leaves an expired lease, and `reclaimExpiredLeases` returns the
 * job to the queue — the alternative is a job stuck in RUNNING forever.
 */

/** How long a worker may hold a job before the lease is considered dead. */
const LEASE_MS = 10 * 60 * 1000;

/** Backoff schedule per attempt (seconds), with jitter applied. */
const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600, 7200];

export function computeBackoffMs(attempt: number, minimumSeconds?: number): number {
  const base = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
  const seconds = Math.max(base, minimumSeconds ?? 0);
  // Jitter spreads retries so a transient Google outage does not produce a
  // synchronised thundering herd when it recovers.
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(seconds * 1000 * jitter);
}

/** Postgres unique-violation code. */
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2002" || code === "23505" || code === "23P01";
}

export interface EnqueueResult {
  job: PublishingJob;
  /** False when an active job already existed and was returned instead. */
  created: boolean;
}

/**
 * Queues a submission for publishing.
 *
 * Idempotent by design (Section 26): if an active job already exists — because
 * the user double-clicked, or two admins clicked at once — the existing job is
 * returned and nothing new is created. A second YouTube video is impossible.
 */
export async function enqueuePublish(params: {
  organizationId: string;
  submissionId: string;
  actorId: string;
}): Promise<EnqueueResult> {
  const { organizationId, submissionId, actorId } = params;

  const active = await db.publishingJob.findFirst({
    where: {
      submissionId,
      state: { in: [JobState.QUEUED, JobState.RUNNING, JobState.WAITING_RETRY] },
    },
  });
  if (active) return { job: active, created: false };

  // If the video already exists on YouTube there is nothing left to upload;
  // resuming the *existing* publication is correct, re-uploading is not.
  const publication = await db.youTubePublication.findUnique({ where: { submissionId } });

  try {
    const job = await db.$transaction(async (tx) => {
      const created = await tx.publishingJob.create({
        data: {
          organizationId,
          submissionId,
          state: JobState.QUEUED,
          // Skip straight past the upload when the video is already up.
          currentStep: publication?.youtubeVideoId
            ? JobStep.APPLY_THUMBNAIL
            : JobStep.CREATE_YOUTUBE_UPLOAD,
          idempotencyKey: `publish:${submissionId}:${randomUUID()}`,
        },
      });

      await tx.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.PUBLISHING },
      });

      await tx.submissionEvent.create({
        data: {
          submissionId,
          actorId,
          type: "PUBLISH_QUEUED",
          message: "Publishing started.",
        },
      });

      return created;
    });

    logger.info("publish job enqueued", { jobId: job.id, submissionId });
    return { job, created: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      // The partial unique index caught a genuine race. Return the winner.
      const winner = await db.publishingJob.findFirst({
        where: {
          submissionId,
          state: { in: [JobState.QUEUED, JobState.RUNNING, JobState.WAITING_RETRY] },
        },
      });
      if (winner) {
        logger.info("duplicate publish rejected by database", { submissionId });
        return { job: winner, created: false };
      }
    }
    throw e;
  }
}

/**
 * Claims one runnable job.
 *
 * `FOR UPDATE SKIP LOCKED` inside a sub-select means two workers polling at
 * the same instant take *different* rows rather than blocking or colliding.
 */
export async function claimNextJob(workerId: string): Promise<PublishingJob | null> {
  const leaseExpiry = new Date(Date.now() + LEASE_MS);

  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "PublishingJob"
       SET state = 'RUNNING',
           "lockedBy" = ${workerId},
           "lockedAt" = now(),
           "leaseExpiresAt" = ${leaseExpiry},
           attempt = attempt + 1,
           "startedAt" = COALESCE("startedAt", now()),
           "updatedAt" = now()
     WHERE id = (
       SELECT id FROM "PublishingJob"
        WHERE state IN ('QUEUED', 'WAITING_RETRY')
          AND "runAfter" <= now()
        ORDER BY "runAfter" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id
  `;

  if (rows.length === 0) return null;
  return db.publishingJob.findUnique({ where: { id: rows[0].id } });
}

/** Extends the lease during a long step so it is not reclaimed mid-upload. */
export async function heartbeat(jobId: string, workerId: string): Promise<void> {
  await db.publishingJob.updateMany({
    where: { id: jobId, lockedBy: workerId, state: JobState.RUNNING },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
}

/**
 * Returns jobs whose worker died to the queue.
 *
 * Safe because every step is idempotent: the reclaimed job re-checks what has
 * actually happened remotely before doing anything.
 */
export async function reclaimExpiredLeases(): Promise<number> {
  const res = await db.publishingJob.updateMany({
    where: {
      state: JobState.RUNNING,
      leaseExpiresAt: { lt: new Date() },
    },
    data: {
      state: JobState.QUEUED,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      lastError: "Worker stopped responding; job returned to the queue.",
    },
  });
  if (res.count > 0) logger.warn("reclaimed expired job leases", { count: res.count });
  return res.count;
}

/** Records progress mid-step (byte offsets, session URIs, step transitions). */
export async function saveProgress(
  jobId: string,
  data: Partial<{
    currentStep: JobStep;
    youtubeResumableUri: string | null;
    bytesSent: bigint;
    totalBytes: bigint | null;
  }>,
): Promise<void> {
  await db.publishingJob.update({ where: { id: jobId }, data });
}

export async function markSucceeded(jobId: string): Promise<void> {
  await db.publishingJob.update({
    where: { id: jobId },
    data: {
      state: JobState.SUCCEEDED,
      currentStep: JobStep.DONE,
      completedAt: new Date(),
      lockedBy: null,
      leaseExpiresAt: null,
      lastError: null,
      // The session URI is a write capability; drop it once it is spent.
      youtubeResumableUri: null,
    },
  });
}

/**
 * Records a failure and decides whether to retry.
 *
 * A terminal error (revoked auth, rejected metadata, unconfirmed channel) goes
 * straight to FAILED — retrying would waste quota and delay the human
 * intervention that is actually required.
 */
export async function markFailed(
  jobId: string,
  error: AppError,
): Promise<{ willRetry: boolean; runAfter?: Date }> {
  const job = await db.publishingJob.findUnique({ where: { id: jobId } });
  if (!job) return { willRetry: false };

  const attemptsLeft = job.attempt < job.maxAttempts;
  const willRetry = error.retryable && !error.terminal && attemptsLeft;

  if (willRetry) {
    const runAfter = new Date(Date.now() + computeBackoffMs(job.attempt, error.retryAfterSeconds));
    await db.publishingJob.update({
      where: { id: jobId },
      data: {
        state: JobState.WAITING_RETRY,
        runAfter,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        lastError: error.userMessage,
        lastErrorCode: error.code,
      },
    });
    logger.warn("publish step failed; will retry", {
      jobId,
      attempt: job.attempt,
      code: error.code,
      runAfter,
    });
    return { willRetry: true, runAfter };
  }

  await db.$transaction([
    db.publishingJob.update({
      where: { id: jobId },
      data: {
        state: JobState.FAILED,
        failedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        isTerminal: error.terminal,
        lastError: error.userMessage,
        lastErrorCode: error.code,
      },
    }),
    db.submission.update({
      where: { id: job.submissionId },
      data: { status: SubmissionStatus.FAILED, lastFailureAt: new Date() },
    }),
    db.submissionEvent.create({
      data: {
        submissionId: job.submissionId,
        type: "PUBLISH_FAILED",
        message: error.userMessage,
        metadata: { code: error.code, step: job.currentStep },
      },
    }),
  ]);

  logger.error("publish job failed", {
    jobId,
    code: error.code,
    step: job.currentStep,
    terminal: error.terminal,
  });
  return { willRetry: false };
}

/** Cancels an active job. Does NOT undo anything already done on YouTube. */
export async function cancelJob(jobId: string, reason: string): Promise<void> {
  await db.publishingJob.update({
    where: { id: jobId },
    data: {
      state: JobState.CANCELLED,
      lockedBy: null,
      leaseExpiresAt: null,
      youtubeResumableUri: null,
      lastError: reason,
    },
  });
}

/** Queue depth and health, for the admin dashboard. */
export async function getQueueStats(organizationId?: string) {
  const where = organizationId ? { organizationId } : {};
  const [queued, running, waiting, failed, succeeded, oldest] = await Promise.all([
    db.publishingJob.count({ where: { ...where, state: JobState.QUEUED } }),
    db.publishingJob.count({ where: { ...where, state: JobState.RUNNING } }),
    db.publishingJob.count({ where: { ...where, state: JobState.WAITING_RETRY } }),
    db.publishingJob.count({ where: { ...where, state: JobState.FAILED } }),
    db.publishingJob.count({ where: { ...where, state: JobState.SUCCEEDED } }),
    db.publishingJob.findFirst({
      where: { ...where, state: { in: [JobState.QUEUED, JobState.WAITING_RETRY] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    queued,
    running,
    waitingRetry: waiting,
    failed,
    succeeded,
    pending: queued + running + waiting,
    oldestPendingAt: oldest?.createdAt ?? null,
  };
}

/** Loads a job for the retry endpoints, enforcing tenant isolation. */
export async function getJobForSubmission(
  organizationId: string,
  submissionId: string,
): Promise<PublishingJob | null> {
  const job = await db.publishingJob.findFirst({
    where: { submissionId, organizationId },
    orderBy: { createdAt: "desc" },
  });
  return job;
}

const ACTIVE_STATES: ReadonlySet<JobState> = new Set([
  JobState.QUEUED,
  JobState.RUNNING,
  JobState.WAITING_RETRY,
]);

export function isActiveJob(job: PublishingJob | null): boolean {
  return Boolean(job && ACTIVE_STATES.has(job.state));
}

export function assertActiveJobAbsent(job: PublishingJob | null): void {
  if (isActiveJob(job)) {
    throw Errors.conflict(
      "This submission is already being published. Watch the progress on its page rather than starting again.",
    );
  }
}
