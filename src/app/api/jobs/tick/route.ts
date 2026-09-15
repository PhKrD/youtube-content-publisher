import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { claimNextJob, reclaimExpiredLeases } from "@/lib/publishing/queue";
import { runJob } from "@/lib/publishing/engine";

/**
 * Serverless worker tick.
 *
 * Invoked by a scheduler (Vercel Cron, GitHub Actions, cron-job.org) for
 * deployments with no long-running process. Each call drains as much of the
 * queue as fits in its time budget; because every step persists its progress,
 * a large upload simply continues on the next tick.
 *
 * Authentication is a shared secret in a header, compared in constant time.
 * Without it, anyone could drive the publishing queue.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel Pro allows 300s; Hobby caps at 60s. Either way, progress is durable. */
export const maxDuration = 300;

/** Leave headroom so we return cleanly instead of being killed mid-step. */
const BUDGET_MS = 240_000;

function authorize(request: Request): boolean {
  const configured = env.WORKER_SECRET;
  if (!configured) {
    logger.error("WORKER_SECRET is not set; refusing to run the queue");
    return false;
  }

  const header =
    request.headers.get("x-worker-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!header) return false;
  return safeEqual(header, configured);
}

async function handle(request: Request) {
  if (!authorize(request)) {
    // 404 rather than 401: do not advertise that this endpoint exists.
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const runId = randomUUID().slice(0, 8);
  const workerId = `serverless:${runId}`;
  const deadline = Date.now() + BUDGET_MS;

  const outcomes: Record<string, number> = { completed: 0, failed: 0, yielded: 0 };
  let claimed = 0;

  try {
    await reclaimExpiredLeases();

    while (Date.now() < deadline) {
      const job = await claimNextJob(workerId);
      if (!job) break;
      claimed++;
      const outcome = await runJob(job);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      runId,
      claimed,
      outcomes,
      // Tells the scheduler whether to come back sooner than its next slot.
      moreWorkLikely: claimed > 0 && outcomes.yielded > 0,
    });
  } catch (e) {
    logger.error("job tick failed", {
      runId,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: { message: "Queue tick failed. See server logs." } },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
