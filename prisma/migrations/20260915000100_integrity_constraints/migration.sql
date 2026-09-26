-- =============================================================================
-- Integrity constraints that Prisma's schema language cannot express.
--
-- These are deliberately enforced by PostgreSQL rather than by application
-- code. Application-level checks lose races; a unique index does not. The
-- duplicate-publish guarantee (Section 26) depends on this file.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. AT MOST ONE ACTIVE PUBLISHING JOB PER SUBMISSION
-- -----------------------------------------------------------------------------
-- The core anti-duplicate-publish guard. If a contributor double-clicks
-- "Publish", or two admins click it simultaneously, or a retry races the
-- worker, the second INSERT fails with a unique violation which the
-- application translates into "this submission is already being published".
--
-- Terminal states (SUCCEEDED / FAILED / CANCELLED) are excluded so the job
-- history is preserved and a genuinely failed submission can be re-queued.
CREATE UNIQUE INDEX "publishingjob_one_active_per_submission"
  ON "PublishingJob" ("submissionId")
  WHERE "state" IN ('QUEUED', 'RUNNING', 'WAITING_RETRY');


-- -----------------------------------------------------------------------------
-- 2. AT MOST ONE VIDEO AND ONE THUMBNAIL PER SUBMISSION
-- -----------------------------------------------------------------------------
-- SUPPORTING_IMAGE is intentionally unconstrained (many are allowed).
-- Replacing a video means deleting the old MediaFile row first, which keeps
-- "which file will actually be published?" unambiguous.
CREATE UNIQUE INDEX "mediafile_one_per_primary_kind"
  ON "MediaFile" ("submissionId", "kind")
  WHERE "kind" IN ('VIDEO', 'THUMBNAIL');


-- -----------------------------------------------------------------------------
-- 3. SINGLE DEFAULTS PER ORGANIZATION
-- -----------------------------------------------------------------------------
-- Without these, "the default playlist" could silently become ambiguous and
-- content would be filed inconsistently.
CREATE UNIQUE INDEX "playlist_one_default_per_org"
  ON "Playlist" ("organizationId")
  WHERE "isDefault" = true;

CREATE UNIQUE INDEX "titletemplate_one_default_per_org"
  ON "TitleTemplate" ("organizationId")
  WHERE "isDefault" = true;

CREATE UNIQUE INDEX "descriptiontemplate_one_default_per_org"
  ON "DescriptionTemplate" ("organizationId")
  WHERE "isDefault" = true;

CREATE UNIQUE INDEX "youtubechannel_one_default_per_org"
  ON "YouTubeChannel" ("organizationId")
  WHERE "isDefault" = true;


-- -----------------------------------------------------------------------------
-- 4. HUMAN-READABLE SUBMISSION REFERENCES
-- -----------------------------------------------------------------------------
-- A gapless per-org counter would require locking the organization row on
-- every insert. A shared sequence is race-free and cheap; gaps are harmless
-- because the reference is an identifier, not a count.
CREATE SEQUENCE IF NOT EXISTS "submission_reference_seq" START WITH 1 INCREMENT BY 1;


-- -----------------------------------------------------------------------------
-- 5. SCHEDULING CONSISTENCY
-- -----------------------------------------------------------------------------
-- A scheduled publish with no timestamp is meaningless and would silently
-- publish immediately.
ALTER TABLE "Submission"
  ADD CONSTRAINT "submission_scheduled_requires_timestamp"
  CHECK ("publishMode" <> 'SCHEDULED' OR "scheduledAt" IS NOT NULL);

-- YouTube only honours `publishAt` on a video whose privacy status is
-- `private`. Storing PUBLIC + SCHEDULED would make the video go live
-- instantly, which is the opposite of what the user asked for.
ALTER TABLE "Submission"
  ADD CONSTRAINT "submission_scheduled_must_start_private"
  CHECK ("publishMode" <> 'SCHEDULED' OR "privacyStatus" = 'PRIVATE');


-- -----------------------------------------------------------------------------
-- 6. NON-NEGATIVE BYTE COUNTERS
-- -----------------------------------------------------------------------------
-- Guards against a bad offset calculation corrupting resume arithmetic.
ALTER TABLE "MediaFile"
  ADD CONSTRAINT "mediafile_bytes_nonnegative"
  CHECK ("bytesReceived" >= 0 AND "sizeBytes" >= 0);

ALTER TABLE "PublishingJob"
  ADD CONSTRAINT "publishingjob_bytes_nonnegative"
  CHECK ("bytesSent" >= 0 AND ("totalBytes" IS NULL OR "totalBytes" >= 0));

ALTER TABLE "PublishingJob"
  ADD CONSTRAINT "publishingjob_attempt_bounds"
  CHECK ("attempt" >= 0 AND "maxAttempts" > 0);


-- -----------------------------------------------------------------------------
-- 7. WORKER QUEUE PERFORMANCE
-- -----------------------------------------------------------------------------
-- The worker's claim query is
--   SELECT ... WHERE state IN ('QUEUED','WAITING_RETRY') AND "runAfter" <= now()
--   ORDER BY "runAfter" FOR UPDATE SKIP LOCKED
-- A partial index keeps that scan proportional to the *runnable* backlog
-- rather than to the full job history.
CREATE INDEX "publishingjob_runnable"
  ON "PublishingJob" ("runAfter")
  WHERE "state" IN ('QUEUED', 'WAITING_RETRY');

-- Reclaiming jobs whose lease expired because a worker was killed mid-flight.
CREATE INDEX "publishingjob_expired_lease"
  ON "PublishingJob" ("leaseExpiresAt")
  WHERE "state" = 'RUNNING';


-- -----------------------------------------------------------------------------
-- 8. SEARCH SUPPORT (Section 32)
-- -----------------------------------------------------------------------------
-- Trigram indexes give case-insensitive substring search on the fields the
-- library filters by, without a full-text search dependency.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "submission_title_trgm"
  ON "Submission" USING gin ("computedTitle" gin_trgm_ops);

CREATE INDEX "submission_topic_trgm"
  ON "Submission" USING gin ("topic" gin_trgm_ops);

CREATE INDEX "submission_speaker_trgm"
  ON "Submission" USING gin ("speaker" gin_trgm_ops);
