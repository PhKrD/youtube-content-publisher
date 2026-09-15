import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 configuration.
 *
 * Connection URLs live here rather than in schema.prisma (Prisma 7 removed
 * `url`/`directUrl` from the datasource block).
 *
 * Note the deliberate split:
 *
 *  - `datasource.url` below uses DIRECT_URL (port 5432) because it is consumed
 *    by migrate/introspect. Those commands need session-level features —
 *    advisory locks, prepared statements, `CREATE INDEX` — that Supabase's
 *    pgBouncer pooler does not proxy. Pointing migrations at the pooler
 *    produces confusing "prepared statement already exists" failures.
 *  - The application runtime uses the POOLED DATABASE_URL via the `pg` driver
 *    adapter in src/lib/db.ts.
 *
 * The fallback to DATABASE_URL keeps a plain single-URL Postgres (local
 * Docker, Neon direct) working without defining DIRECT_URL at all.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),

  datasource: {
    url: env("DIRECT_URL") || env("DATABASE_URL"),
  },

  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
