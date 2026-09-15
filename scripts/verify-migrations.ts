/**
 * Applies every migration in prisma/migrations against a throwaway in-process
 * PostgreSQL (PGlite / WASM) and asserts the resulting schema behaves.
 *
 * Why this exists: the integrity migration contains hand-written DDL —
 * partial unique indexes, CHECK constraints, trigram indexes — that Prisma
 * does not validate. Without this script, a typo there would only be
 * discovered when `migrate deploy` failed against the real database. It also
 * proves the constraints actually *do* what they claim, which matters far more
 * than the DDL merely parsing.
 *
 * Run:  npx tsx scripts/verify-migrations.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
// pg_trgm powers the library's substring search. In PGlite it must be loaded
// explicitly; on a real Postgres (incl. Supabase) it ships with the server and
// the migration's `CREATE EXTENSION` is enough.
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

let failures = 0;
const results: string[] = [];

function check(name: string, ok: boolean, note = "") {
  if (ok) {
    results.push(`  PASS  ${name}${note ? ` — ${note}` : ""}`);
  } else {
    failures++;
    results.push(`  FAIL  ${name}${note ? ` — ${note}` : ""}`);
  }
}

/** Asserts a statement violates a constraint. */
async function expectViolation(db: PGlite, name: string, sql: string, expectFragment: string) {
  try {
    await db.exec(sql);
    check(name, false, "statement unexpectedly succeeded");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, msg.toLowerCase().includes(expectFragment.toLowerCase()), msg.split("\n")[0]);
  }
}

async function main() {
  console.log("Starting in-process PostgreSQL (PGlite)…");
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.waitReady;

  const version = await db.query<{ v: string }>("SELECT version() AS v");
  console.log(`  ${version.rows[0].v.split(",")[0]}\n`);

  // ---- apply migrations in lexical (= chronological) order ----
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (dirs.length === 0) throw new Error("no migrations found");

  for (const dir of dirs) {
    const file = path.join(MIGRATIONS_DIR, dir, "migration.sql");
    const sql = readFileSync(file, "utf8");
    process.stdout.write(`Applying ${dir} … `);
    try {
      await db.exec(sql);
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    }
  }

  console.log("\nAll migrations applied. Verifying behaviour…\n");

  // ---- structural sanity ----
  const tables = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'`,
  );
  check("tables created", tables.rows[0].count >= 23, `${tables.rows[0].count} tables`);

  const idx = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN (
       'publishingjob_one_active_per_submission',
       'mediafile_one_per_primary_kind',
       'playlist_one_default_per_org',
       'publishingjob_runnable',
       'submission_title_trgm'
     ) ORDER BY indexname`,
  );
  check("custom indexes created", idx.rows.length === 5, idx.rows.map((r) => r.indexname).join(", "));

  // ---- seed a minimal graph so constraints have something to bite on ----
  await db.exec(`
    INSERT INTO "Organization" (id, name, slug, "updatedAt")
      VALUES ('org1', 'Test Org', 'test', now());
    INSERT INTO "User" (id, email, "organizationId", role, "updatedAt")
      VALUES ('user1', 'a@example.com', 'org1', 'ADMIN', now());
    INSERT INTO "Submission"
      (id, "organizationId", "createdById", reference, "idempotencyKey", "updatedAt", tags)
      VALUES ('sub1', 'org1', 'user1', 'SUB-000001', 'idem-sub1', now(), ARRAY[]::text[]);
  `);
  check("seed graph inserted", true);

  // ---- THE critical guarantee: no duplicate publishing ----
  await db.exec(`
    INSERT INTO "PublishingJob" (id, "organizationId", "submissionId", state, "idempotencyKey", "updatedAt")
      VALUES ('job1', 'org1', 'sub1', 'QUEUED', 'idem-job1', now());
  `);
  check("first publishing job accepted", true);

  await expectViolation(
    db,
    "SECOND ACTIVE JOB REJECTED (duplicate-publish guard)",
    `INSERT INTO "PublishingJob" (id, "organizationId", "submissionId", state, "idempotencyKey", "updatedAt")
       VALUES ('job2', 'org1', 'sub1', 'QUEUED', 'idem-job2', now());`,
    "publishingjob_one_active_per_submission",
  );

  // …but history must not block a legitimate re-queue after terminal failure.
  await db.exec(`UPDATE "PublishingJob" SET state='FAILED' WHERE id='job1';`);
  await db.exec(`
    INSERT INTO "PublishingJob" (id, "organizationId", "submissionId", state, "idempotencyKey", "updatedAt")
      VALUES ('job3', 'org1', 'sub1', 'QUEUED', 'idem-job3', now());
  `);
  check("re-queue allowed after terminal failure", true);

  // ---- one video / one thumbnail, many supporting images ----
  await db.exec(`
    INSERT INTO "MediaFile" (id, "organizationId", "submissionId", kind, "originalFilename", "mimeType", "sizeBytes", "updatedAt")
      VALUES ('m1', 'org1', 'sub1', 'VIDEO', 'a.mp4', 'video/mp4', 100, now());
  `);
  await expectViolation(
    db,
    "second VIDEO rejected",
    `INSERT INTO "MediaFile" (id, "organizationId", "submissionId", kind, "originalFilename", "mimeType", "sizeBytes", "updatedAt")
       VALUES ('m2', 'org1', 'sub1', 'VIDEO', 'b.mp4', 'video/mp4', 100, now());`,
    "mediafile_one_per_primary_kind",
  );
  await db.exec(`
    INSERT INTO "MediaFile" (id, "organizationId", "submissionId", kind, "originalFilename", "mimeType", "sizeBytes", "updatedAt")
      VALUES ('m3', 'org1', 'sub1', 'SUPPORTING_IMAGE', 'c.jpg', 'image/jpeg', 10, now());
    INSERT INTO "MediaFile" (id, "organizationId", "submissionId", kind, "originalFilename", "mimeType", "sizeBytes", "updatedAt")
      VALUES ('m4', 'org1', 'sub1', 'SUPPORTING_IMAGE', 'd.jpg', 'image/jpeg', 10, now());
  `);
  check("multiple SUPPORTING_IMAGE allowed", true);

  // ---- scheduling CHECK constraints ----
  await expectViolation(
    db,
    "SCHEDULED without timestamp rejected",
    `UPDATE "Submission" SET "publishMode"='SCHEDULED', "scheduledAt"=NULL WHERE id='sub1';`,
    "submission_scheduled_requires_timestamp",
  );
  await expectViolation(
    db,
    "SCHEDULED + PUBLIC rejected (YouTube needs private)",
    `UPDATE "Submission" SET "publishMode"='SCHEDULED', "scheduledAt"=now(), "privacyStatus"='PUBLIC' WHERE id='sub1';`,
    "submission_scheduled_must_start_private",
  );
  await db.exec(
    `UPDATE "Submission" SET "publishMode"='SCHEDULED', "scheduledAt"=now(), "privacyStatus"='PRIVATE' WHERE id='sub1';`,
  );
  check("SCHEDULED + PRIVATE + timestamp accepted", true);

  // ---- one video per submission on the publication side ----
  await db.exec(`
    INSERT INTO "YouTubePublication" (id, "organizationId", "submissionId", "youtubeVideoId", "updatedAt")
      VALUES ('p1', 'org1', 'sub1', 'vid_abc', now());
  `);
  await expectViolation(
    db,
    "second publication for same submission rejected",
    `INSERT INTO "YouTubePublication" (id, "organizationId", "submissionId", "youtubeVideoId", "updatedAt")
       VALUES ('p2', 'org1', 'sub1', 'vid_xyz', now());`,
    "submissionId",
  );
  // Use a DIFFERENT submission here, otherwise the submissionId unique
  // constraint fires first and we never actually exercise the video-id one.
  await db.exec(`
    INSERT INTO "Submission"
      (id, "organizationId", "createdById", reference, "idempotencyKey", "updatedAt", tags)
      VALUES ('sub2', 'org1', 'user1', 'SUB-000002', 'idem-sub2', now(), ARRAY[]::text[]);
  `);
  await expectViolation(
    db,
    "reusing a YouTube video id across submissions rejected",
    `INSERT INTO "YouTubePublication" (id, "organizationId", "submissionId", "youtubeVideoId", "updatedAt")
       VALUES ('p3', 'org1', 'sub2', 'vid_abc', now());`,
    "youtubeVideoId",
  );

  // ---- single-default indexes ----
  await db.exec(`
    INSERT INTO "IntegrationAccount" (id, "organizationId", "googleUserId", email, "accessTokenEnc", scopes, "updatedAt")
      VALUES ('ia1', 'org1', 'g1', 'pub@example.com', 'enc', 'scope', now());
    INSERT INTO "YouTubeChannel" (id, "organizationId", "integrationAccountId", "youtubeChannelId", title, "isDefault", "updatedAt")
      VALUES ('ch1', 'org1', 'ia1', 'UC123', 'Chan', true, now());
    INSERT INTO "Playlist" (id, "organizationId", "channelId", "youtubePlaylistId", title, "isDefault", "updatedAt")
      VALUES ('pl1', 'org1', 'ch1', 'PL1', 'List 1', true, now());
  `);
  await expectViolation(
    db,
    "second default playlist rejected",
    `INSERT INTO "Playlist" (id, "organizationId", "channelId", "youtubePlaylistId", title, "isDefault", "updatedAt")
       VALUES ('pl2', 'org1', 'ch1', 'PL2', 'List 2', true, now());`,
    "playlist_one_default_per_org",
  );
  await db.exec(`
    INSERT INTO "Playlist" (id, "organizationId", "channelId", "youtubePlaylistId", title, "isDefault", "updatedAt")
      VALUES ('pl3', 'org1', 'ch1', 'PL3', 'List 3', false, now());
  `);
  check("additional non-default playlists allowed", true);

  // ---- negative byte guard ----
  await expectViolation(
    db,
    "negative bytesSent rejected",
    `UPDATE "PublishingJob" SET "bytesSent" = -1 WHERE id='job3';`,
    "publishingjob_bytes_nonnegative",
  );

  // ---- reference sequence ----
  const seq = await db.query<{ v: string }>(`SELECT nextval('submission_reference_seq')::text AS v`);
  check("reference sequence usable", Number(seq.rows[0].v) >= 1, `nextval=${seq.rows[0].v}`);

  // ---- trigram search actually works ----
  await db.exec(`UPDATE "Submission" SET "computedTitle" = 'Bhagavad Gita Session 01' WHERE id='sub1';`);
  const found = await db.query<{ id: string }>(
    `SELECT id FROM "Submission" WHERE "computedTitle" ILIKE '%gita%'`,
  );
  check("trigram/ILIKE search finds row", found.rows.length === 1);

  // ---- the worker's claim query must parse and use SKIP LOCKED ----
  const claim = await db.query<{ id: string }>(
    `SELECT id FROM "PublishingJob"
      WHERE state IN ('QUEUED','WAITING_RETRY') AND "runAfter" <= now()
      ORDER BY "runAfter" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
  );
  check("worker claim query valid", claim.rows.length === 1, `claimed ${claim.rows[0]?.id}`);

  await db.close();

  console.log(results.join("\n"));
  console.log(
    `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ` +
      `(${results.length - failures}/${results.length})\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
