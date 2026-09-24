import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma";
import { env } from "./env";

/**
 * Prisma client, wired through the `pg` driver adapter (Prisma 7).
 *
 * Why the adapter rather than the old Rust query engine: no native binary to
 * ship, materially faster cold starts on Vercel, and one obvious place to
 * control pool sizing — which matters because serverless functions each open
 * their own pool and will happily exhaust Postgres's connection limit.
 *
 * In dev the client is cached on `globalThis` so Next.js's hot reload does not
 * leak a new pool on every file save.
 */

function createClient(): PrismaClient {
  const connectionString = env.DATABASE_URL;

  // Supabase's pooler (pgBouncer in transaction mode) does the real
  // multiplexing, so keep each function's pool small — but not 1: with a
  // single connection every `Promise.all` of queries silently runs serially.
  const isPooled = /pgbouncer=true|:6543/.test(connectionString);

  const adapter = new PrismaPg({
    connectionString,
    max: isPooled ? 5 : 10,
    // Do not let a wedged connection attempt hang a request indefinitely.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter,
    log:
      env.LOG_LEVEL === "debug"
        ? [{ emit: "stdout", level: "warn" }, { emit: "stdout", level: "error" }]
        : [{ emit: "stdout", level: "error" }],
  });
}

const globalForPrisma = globalThis as unknown as { __ycpPrisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.__ycpPrisma ?? createClient();

if (env.APP_ENV !== "production") {
  globalForPrisma.__ycpPrisma = db;
}

/** Lightweight liveness probe for the health page. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
