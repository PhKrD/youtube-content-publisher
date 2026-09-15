/**
 * Background publishing worker.
 *
 * Long-running mode (a container on Railway/Render/Fly, or `npm run worker`
 * locally). For Vercel-only deployments the same logic is driven by a cron
 * hitting /api/jobs/tick — see DEPLOYMENT.md for the trade-offs.
 *
 * The loop is intentionally dull: claim one job, run it, repeat. All the
 * interesting behaviour (idempotency, resumption, backoff) lives in the
 * engine and the queue, so running one worker or ten changes nothing about
 * correctness.
 */
import "dotenv/config";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { assertEnv } from "../src/lib/env";
import { logger } from "../src/lib/logger";
import { db } from "../src/lib/db";
import { claimNextJob, reclaimExpiredLeases } from "../src/lib/publishing/queue";
import { runJob } from "../src/lib/publishing/engine";

const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/** Poll interval when the queue is empty. */
const IDLE_MS = 5_000;
/** How often to look for jobs abandoned by a dead worker. */
const RECLAIM_EVERY_MS = 60_000;

let running = true;
let lastReclaim = 0;

async function tick(): Promise<boolean> {
  if (Date.now() - lastReclaim > RECLAIM_EVERY_MS) {
    lastReclaim = Date.now();
    await reclaimExpiredLeases().catch((e) =>
      logger.error("reclaim failed", { error: e instanceof Error ? e.message : String(e) }),
    );
  }

  const job = await claimNextJob(WORKER_ID);
  if (!job) return false;

  logger.info("job claimed", {
    jobId: job.id,
    submissionId: job.submissionId,
    step: job.currentStep,
    attempt: job.attempt,
  });

  const outcome = await runJob(job);
  logger.info("job slice finished", { jobId: job.id, outcome });
  return true;
}

async function main() {
  const envCheck = assertEnv();
  if (!envCheck.ok) {
    console.error(`Worker cannot start.\n\n${envCheck.error}`);
    process.exit(1);
  }

  logger.info("worker started", { workerId: WORKER_ID });

  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    // Finish the job in flight rather than abandoning a partial upload. The
    // lease would recover it anyway, but a clean exit avoids the wait.
    logger.info(`received ${signal}; finishing current job then exiting`);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  while (running) {
    try {
      const didWork = await tick();
      if (!didWork && running) {
        await new Promise((r) => setTimeout(r, IDLE_MS));
      }
    } catch (e) {
      // A failure here is the loop itself breaking (usually the database).
      // Individual job failures are handled inside runJob.
      logger.error("worker loop error", {
        error: e instanceof Error ? e.message : String(e),
      });
      await new Promise((r) => setTimeout(r, IDLE_MS));
    }
  }

  await db.$disconnect();
  logger.info("worker stopped", { workerId: WORKER_ID });
  process.exit(0);
}

main().catch((e) => {
  logger.error("worker crashed", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
