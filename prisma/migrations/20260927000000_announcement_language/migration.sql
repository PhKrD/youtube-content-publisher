-- Hindi / English announcement templates, and a per-video description override.
CREATE TYPE "AnnouncementLanguage" AS ENUM ('HI', 'EN');

ALTER TABLE "TitleTemplate" ADD COLUMN "language" "AnnouncementLanguage";
ALTER TABLE "DescriptionTemplate" ADD COLUMN "language" "AnnouncementLanguage";

ALTER TABLE "Submission" ADD COLUMN "language" "AnnouncementLanguage" NOT NULL DEFAULT 'HI';
ALTER TABLE "Submission" ADD COLUMN "descriptionOverride" TEXT;

-- The existing Pitru Paksha templates are the Hindi ones.
UPDATE "TitleTemplate" SET "language" = 'HI' WHERE "program" = 'PITRU_PAKSHA';
UPDATE "DescriptionTemplate" SET "language" = 'HI' WHERE "program" = 'PITRU_PAKSHA';
