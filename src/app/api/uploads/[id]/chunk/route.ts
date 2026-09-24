import { ok, route } from "@/lib/api";
import { canEditSubmission, requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { UploadState } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Drive requires every chunk except the last to be a multiple of 256 KiB. */
const DRIVE_ALIGNMENT = 256 * 1024;
/** Must stay under Vercel's 4.5 MB function body limit. Kept in sync with upload-client. */
const MAX_CHUNK_BYTES = 16 * DRIVE_ALIGNMENT; // 4 MiB

/**
 * Relays one chunk of a resumable upload from the browser to Google Drive.
 *
 * Google's upload endpoint does not send CORS headers for arbitrary origins,
 * so the browser cannot PUT to the session URI itself. Each chunk is small
 * enough to fit in a single serverless request; all upload state lives in the
 * Drive session and the MediaFile row, so any function instance can take any
 * chunk. The body is the raw bytes (no base64), at `?offset=<byte offset>`.
 */
export const PUT = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();

  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % DRIVE_ALIGNMENT !== 0) {
    throw Errors.validation("Invalid chunk offset.");
  }

  const media = await db.mediaFile.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      sizeBytes: true,
      uploadState: true,
      resumableSessionUri: true,
      resumableExpiresAt: true,
      submission: { select: { id: true, organizationId: true, createdById: true, status: true } },
    },
  });
  if (!media || media.organizationId !== principal.organizationId) throw Errors.notFound("upload");
  if (!canEditSubmission(principal, media.submission)) {
    throw Errors.forbidden("cannot modify media on this submission");
  }
  if (media.uploadState !== UploadState.IN_PROGRESS || !media.resumableSessionUri) {
    throw Errors.conflict("This upload is no longer active. Please choose the file again.");
  }
  if (media.resumableExpiresAt && media.resumableExpiresAt < new Date()) {
    throw Errors.conflict("This upload session expired. Please choose the file again.");
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const total = Number(media.sizeBytes);
  const end = offset + bytes.length;
  const isLast = end === total;
  if (
    bytes.length === 0 ||
    bytes.length > MAX_CHUNK_BYTES ||
    end > total ||
    (!isLast && bytes.length % DRIVE_ALIGNMENT !== 0)
  ) {
    throw Errors.validation("Invalid chunk size.");
  }

  const res = await fetch(media.resumableSessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes ${offset}-${end - 1}/${total}` },
    body: bytes,
  });

  if (res.status === 308) {
    const range = res.headers.get("range"); // e.g. "bytes=0-4194303"
    const received = range ? Number(range.split("-")[1]) + 1 : 0;
    return ok({ complete: false, receivedBytes: Number.isFinite(received) ? received : 0 });
  }

  if (res.status === 200 || res.status === 201) {
    const file = (await res.json().catch(() => null)) as {
      id?: string;
      md5Checksum?: string;
      webViewLink?: string;
    } | null;
    if (!file?.id) throw Errors.internal("Drive did not return a file id");
    return ok({
      complete: true,
      driveFileId: file.id,
      driveMd5: file.md5Checksum ?? null,
      webViewLink: file.webViewLink ?? null,
    });
  }

  const detail = await res.text().catch(() => "");
  logger.warn("drive chunk rejected", { mediaFileId: media.id, status: res.status, detail: detail.slice(0, 300) });
  if (res.status === 404 || res.status === 410) {
    throw Errors.conflict("This upload session expired. Please choose the file again.");
  }
  // 5xx/429 are transient; the client re-probes the committed offset and retries.
  return Response.json(
    { error: { code: "UPSTREAM", message: `Google Drive returned ${res.status}.`, retryable: res.status >= 500 || res.status === 429 } },
    { status: res.status >= 500 || res.status === 429 ? 503 : 502 },
  );
});
