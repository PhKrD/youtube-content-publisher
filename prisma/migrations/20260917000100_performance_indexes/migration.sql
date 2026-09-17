-- Performance optimization: Add index for organizationId + status queries
-- This speeds up dashboard status counts and content library filtering
CREATE INDEX IF NOT EXISTS "submission_org_status_updated"
ON "Submission" ("organizationId", "status", "updatedAt" DESC);

-- Performance optimization: Add index for organizationId + createdBy queries
-- This speeds up contributor-specific content filtering
CREATE INDEX IF NOT EXISTS "submission_org_creator_updated"
ON "Submission" ("organizationId", "createdById", "updatedAt" DESC);

-- Performance optimization: Add index for submissionId + kind queries
-- This speeds up media file lookups during validation
CREATE INDEX IF NOT EXISTS "mediafile_submission_kind"
ON "MediaFile" ("submissionId", "kind");
