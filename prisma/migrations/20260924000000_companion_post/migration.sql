-- Companion YouTube post prepared alongside each video. Additive only.
ALTER TABLE "Submission" ADD COLUMN "postText" TEXT;
ALTER TABLE "Submission" ADD COLUMN "postPostedAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "postPostedById" TEXT;
