ALTER TABLE "Playlist" ALTER COLUMN "itemCount" DROP NOT NULL;
ALTER TABLE "Playlist" ALTER COLUMN "itemCount" DROP DEFAULT;

UPDATE "Playlist" SET "itemCount" = NULL;
UPDATE "YouTubeChannel" SET "subscriberCount" = NULL, "videoCount" = NULL;
