-- Add Program enum for program-based templates
CREATE TYPE "Program" AS ENUM ('FFL', 'PITRU_PAKSHA', 'OTHERS');

-- Drop the trigram index on program (doesn't work with enums)
DROP INDEX IF EXISTS "submission_program_trgm";

-- Convert existing program column from String to Program enum
-- First, set any existing non-null values to OTHERS if they don't match the enum
UPDATE "Submission" SET "program" = 'OTHERS' WHERE "program" IS NOT NULL AND "program" NOT IN ('FFL', 'PITRU_PAKSHA', 'OTHERS');

-- Then alter the column type
ALTER TABLE "Submission" ALTER COLUMN "program" TYPE "Program" USING "program"::"Program";

-- Set any remaining null values to OTHERS as default
ALTER TABLE "Submission" ALTER COLUMN "program" SET DEFAULT 'OTHERS';
ALTER TABLE "Submission" ALTER COLUMN "program" SET NOT NULL;
