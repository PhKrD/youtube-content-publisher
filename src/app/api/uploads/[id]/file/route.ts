import { route } from "@/lib/api";
import { canViewSubmission, requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { openFileStream } from "@/lib/google/drive";
import { MediaKind, UploadState } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Serves an uploaded image (thumbnail or post image) from Drive.
 *
 * Files live in the organisation's Drive, which the person posting to YouTube
 * usually cannot open, so the app relays them. Videos are excluded: they can
 * be gigabytes and nobody needs to download them from here.
 * `?download=1` makes the browser save the file instead of showing it.
 */
export const GET = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();

  const media = await db.mediaFile.findUnique({
    where: { id },
    select: {
      organizationId: true,
      kind: true,
      mimeType: true,
      originalFilename: true,
      driveFileId: true,
      uploadState: true,
      submission: { select: { id: true, organizationId: true, createdById: true, status: true } },
    },
  });
  if (
    !media ||
    media.organizationId !== principal.organizationId ||
    !canViewSubmission(principal, media.submission)
  ) {
    throw Errors.notFound("file");
  }
  if (
    media.kind === MediaKind.VIDEO ||
    !media.mimeType.startsWith("image/") ||
    media.uploadState !== UploadState.COMPLETED ||
    !media.driveFileId
  ) {
    throw Errors.notFound("file");
  }

  const stream = await openFileStream(principal.organizationId, media.driveFileId);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const filename = encodeURIComponent(media.originalFilename);

  return new Response(stream, {
    headers: {
      "Content-Type": media.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      // Per-user content: never cache in a shared cache.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
