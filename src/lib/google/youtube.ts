import { google, type youtube_v3 } from "googleapis";
import { db } from "../db";
import { env } from "../env";
import { Errors, mapGoogleError } from "../errors";
import { logger } from "../logger";
import { getAuthorizedClient } from "./client";
import { downloadRange } from "./drive";
import { PrivacyStatus } from "@/generated/prisma";

/**
 * YouTube Data API v3 integration.
 *
 * The important design decision lives in `relayChunk`. YouTube has no
 * "import from Drive" endpoint, so the bytes must physically move. Rather than
 * streaming a whole 5 GB file through one long-lived process — which cannot
 * survive a serverless time limit, a deploy, or a crash — the transfer is
 * broken into bounded chunks whose committed offset is persisted after every
 * step. Each call moves a window of bytes and returns; the job can be picked
 * up by a different worker on a different machine and continue exactly where
 * it stopped.
 *
 * Quota discipline (Section 48): videos.insert costs ~1600 units of a default
 * 10,000/day allowance, so roughly 6 uploads/day on an unreviewed project.
 * Playlist reads are therefore cached in our database and never fetched on
 * page render.
 */

const YT_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos";
const YT_THUMBNAIL_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

/** Google requires every non-final resumable chunk to be a multiple of this. */
export const CHUNK_ALIGNMENT = 262144; // 256 KiB

async function api(organizationId: string): Promise<{
  youtube: youtube_v3.Youtube;
  accessToken: string;
}> {
  const { client, accessToken } = await getAuthorizedClient(organizationId, "youtube");
  return { youtube: google.youtube({ version: "v3", auth: client }), accessToken };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

async function httpError(res: Response, service: "youtube"): Promise<never> {
  const body = await res.text().catch(() => "");
  throw mapGoogleError(
    { response: { status: res.status, data: safeJson(body), headers: headerBag(res) }, message: body.slice(0, 500) },
    service,
  );
}

function headerBag(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Channel (Section 9)
// ---------------------------------------------------------------------------

export interface ChannelInfo {
  channelId: string;
  title: string;
  description: string | null;
  customUrl: string | null;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string | null;
}

/**
 * The channel belonging to the connected account.
 *
 * `mine: true` resolves whichever channel the OAuth grant actually controls —
 * we never accept a channel id from the client, because publishing to the
 * wrong channel is the most damaging mistake this app could make.
 */
export async function fetchMyChannel(organizationId: string): Promise<ChannelInfo> {
  const { youtube } = await api(organizationId);

  let res;
  try {
    res = await youtube.channels.list({
      part: ["id", "snippet", "contentDetails"],
      mine: true,
      maxResults: 1,
    });
  } catch (err) {
    throw mapGoogleError(err, "youtube");
  }

  const ch = res.data.items?.[0];
  if (!ch?.id) {
    // An empty list means the Google account exists but has never created a
    // channel. This is a setup problem with a specific fix, so it must not be
    // reported as a generic API failure.
    throw Errors.conflict(
      "The connected Google account has no YouTube channel. Create a channel on that account first, then reconnect.",
      "channels.list returned no items for mine=true",
    );
  }

  return {
      channelId: ch.id,
      title: ch.snippet?.title ?? "(untitled channel)",
      description: ch.snippet?.description ?? null,
      customUrl: ch.snippet?.customUrl ?? null,
      thumbnailUrl:
        ch.snippet?.thumbnails?.medium?.url ?? ch.snippet?.thumbnails?.default?.url ?? null,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

// ---------------------------------------------------------------------------
// Playlists (Section 20)
// ---------------------------------------------------------------------------

export interface PlaylistInfo {
  youtubePlaylistId: string;
  title: string;
  description: string | null;
  privacyStatus: string | null;
  thumbnailUrl: string | null;
}

/** All playlists owned by the connected channel, following pagination. */
export async function fetchMyPlaylists(organizationId: string): Promise<PlaylistInfo[]> {
  const { youtube } = await api(organizationId);
  const out: PlaylistInfo[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const res = await youtube.playlists.list({
        part: ["id", "snippet", "status"],
        mine: true,
        maxResults: 50,
        pageToken,
      });
      for (const p of res.data.items ?? []) {
        if (!p.id) continue;
        out.push({
          youtubePlaylistId: p.id,
          title: p.snippet?.title ?? "(untitled playlist)",
          description: p.snippet?.description ?? null,
          privacyStatus: p.status?.privacyStatus ?? null,
          thumbnailUrl:
            p.snippet?.thumbnails?.medium?.url ?? p.snippet?.thumbnails?.default?.url ?? null,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
      // Defensive cap: a pathological account will not spin us forever.
    } while (pageToken && out.length < 500);

    return out;
  } catch (err) {
    throw mapGoogleError(err, "youtube");
  }
}

/**
 * Refreshes the cached playlist rows.
 *
 * Playlists removed on YouTube are marked `isAllowed = false` rather than
 * deleted, so historical submissions retain the relationship without retaining
 * stale API metadata.
 */
export async function syncPlaylists(
  organizationId: string,
  channelDbId: string,
): Promise<{ added: number; updated: number; disappeared: number }> {
  const remote = await fetchMyPlaylists(organizationId);
  const existing = await db.playlist.findMany({ where: { organizationId } });
  const existingByYtId = new Map(existing.map((p) => [p.youtubePlaylistId, p]));

  let added = 0;
  let updated = 0;

  for (const p of remote) {
    const current = existingByYtId.get(p.youtubePlaylistId);
    if (current) {
      await db.playlist.update({
        where: { id: current.id },
        data: {
          title: p.title,
          description: p.description,
          itemCount: null,
          privacyStatus: p.privacyStatus,
          thumbnailUrl: p.thumbnailUrl,
          syncedAt: new Date(),
        },
      });
      updated++;
    } else {
      await db.playlist.create({
        data: {
          organizationId,
          channelId: channelDbId,
          youtubePlaylistId: p.youtubePlaylistId,
          title: p.title,
          description: p.description,
          itemCount: null,
          privacyStatus: p.privacyStatus,
          thumbnailUrl: p.thumbnailUrl,
        },
      });
      added++;
    }
  }

  const remoteIds = new Set(remote.map((p) => p.youtubePlaylistId));
  const gone = existing.filter((p) => !remoteIds.has(p.youtubePlaylistId) && p.isAllowed);
  for (const p of gone) {
    await db.playlist.update({
      where: { id: p.id },
      data: {
        title: "(playlist unavailable)",
        description: null,
        itemCount: null,
        privacyStatus: null,
        thumbnailUrl: null,
        isAllowed: false,
        isDefault: false,
        syncedAt: new Date(),
      },
    });
  }

  logger.info("playlists synced", {
    organizationId,
    added,
    updated,
    disappeared: gone.length,
  });
  return { added, updated, disappeared: gone.length };
}

export async function refreshStoredYouTubeData(
  organizationId: string,
  channelDbId: string,
): Promise<{ added: number; updated: number; disappeared: number }> {
  const remote = await fetchMyChannel(organizationId);
  const channel = await db.youTubeChannel.findUnique({ where: { id: channelDbId } });
  if (!channel || channel.organizationId !== organizationId) throw Errors.notFound("YouTube channel");
  if (channel.youtubeChannelId !== remote.channelId) {
    throw Errors.conflict("The connected Google account now points to a different YouTube channel. Reconnect and confirm it before publishing.");
  }

  await db.youTubeChannel.update({
    where: { id: channel.id },
    data: {
      title: remote.title,
      description: remote.description,
      customUrl: remote.customUrl,
      thumbnailUrl: remote.thumbnailUrl,
      uploadsPlaylistId: remote.uploadsPlaylistId,
      subscriberCount: null,
      videoCount: null,
      syncedAt: new Date(),
    },
  });
  return syncPlaylists(organizationId, channel.id);
}

export async function maintainStoredYouTubeData(): Promise<{
  refreshed: number;
  deleted: number;
  failed: number;
}> {
  const now = Date.now();
  const refreshBefore = new Date(now - 28 * 24 * 60 * 60 * 1000);
  const deleteBefore = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const stale = await db.youTubeChannel.findMany({ where: { syncedAt: { lt: refreshBefore } } });
  let refreshed = 0;
  let deleted = 0;
  let failed = 0;

  for (const channel of stale) {
    try {
      await refreshStoredYouTubeData(channel.organizationId, channel.id);
      refreshed++;
    } catch (error) {
      failed++;
      logger.warn("stored YouTube data refresh failed", {
        organizationId: channel.organizationId,
        channelId: channel.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (channel.syncedAt < deleteBefore) {
        await db.youTubeChannel.delete({ where: { id: channel.id } });
        deleted++;
      }
    }
  }

  return { refreshed, deleted, failed };
}

// ---------------------------------------------------------------------------
// Video upload — resumable session
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  defaultLanguage: string;
  privacyStatus: PrivacyStatus;
  /** RFC3339. Requires privacyStatus PRIVATE; YouTube flips it public then. */
  publishAt?: Date | null;
  madeForKids: boolean;
}

function toYouTubeBody(meta: VideoMetadata): Record<string, unknown> {
  return {
    snippet: {
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      categoryId: meta.categoryId,
      defaultLanguage: meta.defaultLanguage,
      defaultAudioLanguage: meta.defaultLanguage,
    },
    status: {
      // A scheduled video must be uploaded private; YouTube publishes it at
      // publishAt. Sending 'public' with publishAt makes it live immediately.
      privacyStatus: meta.publishAt ? "private" : meta.privacyStatus.toLowerCase(),
      ...(meta.publishAt ? { publishAt: meta.publishAt.toISOString() } : {}),
      selfDeclaredMadeForKids: meta.madeForKids,
      embeddable: true,
    },
  };
}

/**
 * Opens a resumable upload session and returns its URI.
 *
 * The URI is the recovery anchor for the whole relay: stored on the job, it
 * lets any worker resume the transfer, and it means a retry after a network
 * failure continues rather than creating a second video.
 */
export async function createVideoUploadSession(params: {
  organizationId: string;
  metadata: VideoMetadata;
  sizeBytes: number;
  mimeType: string;
}): Promise<string> {
  const { accessToken } = await api(params.organizationId);

  const res = await fetch(
    `${YT_UPLOAD_ENDPOINT}?uploadType=resumable&part=snippet,status&notifySubscribers=false`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(params.sizeBytes),
        "X-Upload-Content-Type": params.mimeType,
      },
      body: JSON.stringify(toYouTubeBody(params.metadata)),
    },
  );

  if (!res.ok) await httpError(res, "youtube");

  const sessionUri = res.headers.get("location");
  if (!sessionUri) throw Errors.internal("YouTube did not return a resumable session URI");
  return sessionUri;
}

export type RelayOutcome =
  | { done: false; bytesSent: number }
  | { done: true; bytesSent: number; videoId: string; uploadStatus: string | null };

/**
 * Moves one chunk of bytes from Drive into the YouTube session.
 *
 * Returns the authoritative committed offset so the caller can persist it.
 * Crucially, the offset comes from YouTube's own `Range` response header, not
 * from what we believe we sent — a partially-accepted chunk would otherwise
 * desynchronise the stream and corrupt the video.
 */
export async function relayChunk(params: {
  organizationId: string;
  sessionUri: string;
  driveFileId: string;
  offset: number;
  totalBytes: number;
  chunkBytes?: number;
}): Promise<RelayOutcome> {
  const { organizationId, sessionUri, driveFileId, offset, totalBytes } = params;

  if (offset >= totalBytes) {
    throw Errors.internal(`relay called with offset ${offset} beyond size ${totalBytes}`);
  }

  const requested = params.chunkBytes ?? env.RELAY_CHUNK_BYTES;
  const remaining = totalBytes - offset;
  // Non-final chunks must be 256 KiB-aligned; the final chunk may be any size.
  const isFinal = requested >= remaining;
  const chunkSize = isFinal
    ? remaining
    : Math.max(CHUNK_ALIGNMENT, Math.floor(requested / CHUNK_ALIGNMENT) * CHUNK_ALIGNMENT);

  const endInclusive = offset + chunkSize - 1;
  const buf = await downloadRange(organizationId, driveFileId, offset, endInclusive);

  if (buf.length === 0) {
    throw Errors.internal(`Drive returned 0 bytes at offset ${offset}`);
  }

  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: {
      "Content-Length": String(buf.length),
      "Content-Range": `bytes ${offset}-${offset + buf.length - 1}/${totalBytes}`,
    },
    body: new Uint8Array(buf),
  });

  // 308 Resume Incomplete — more to send.
  if (res.status === 308) {
    const range = res.headers.get("range"); // "bytes=0-32767"
    const committed = range ? Number(range.split("-")[1]) + 1 : offset + buf.length;
    return { done: false, bytesSent: Number.isFinite(committed) ? committed : offset + buf.length };
  }

  // 200/201 — upload finished; body is the video resource.
  if (res.status === 200 || res.status === 201) {
    const video = (await res.json().catch(() => ({}))) as youtube_v3.Schema$Video;
    if (!video.id) throw Errors.internal("YouTube completed the upload but returned no video id");
    return {
      done: true,
      bytesSent: totalBytes,
      videoId: video.id,
      uploadStatus: video.status?.uploadStatus ?? null,
    };
  }

  if (res.status === 404 || res.status === 410) {
    // The session is gone. Recoverable, but only by starting a NEW session —
    // the caller must clear the stored URI so a fresh one is created.
    throw Errors.uploadSessionExpired();
  }

  await httpError(res, "youtube");
  // unreachable
  throw Errors.internal("unreachable");
}

/**
 * Asks YouTube how many bytes it has for an existing session.
 * Used on retry to re-anchor the offset instead of trusting our own record.
 */
export async function probeVideoSession(
  sessionUri: string,
  totalBytes: number,
): Promise<{ state: "incomplete" | "complete" | "expired"; bytesReceived: number; videoId?: string }> {
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${totalBytes}` },
  });

  if (res.status === 308) {
    const range = res.headers.get("range");
    const received = range ? Number(range.split("-")[1]) + 1 : 0;
    return { state: "incomplete", bytesReceived: Number.isFinite(received) ? received : 0 };
  }
  if (res.status === 200 || res.status === 201) {
    const video = (await res.json().catch(() => ({}))) as youtube_v3.Schema$Video;
    return { state: "complete", bytesReceived: totalBytes, videoId: video.id ?? undefined };
  }
  if (res.status === 404 || res.status === 410) {
    return { state: "expired", bytesReceived: 0 };
  }
  await httpError(res, "youtube");
  throw Errors.internal("unreachable");
}

// ---------------------------------------------------------------------------
// Thumbnail & playlist — the two steps that classically fail *after* upload
// ---------------------------------------------------------------------------

/**
 * Sets a custom thumbnail.
 *
 * Note: this silently requires the channel to be *verified* by YouTube.
 * Unverified channels get a 403 with reason `forbidden`, which we surface as a
 * clear message rather than a generic failure — it is a channel setting, not a
 * bug in the image.
 */
export async function setThumbnail(params: {
  organizationId: string;
  videoId: string;
  image: Buffer;
  mimeType: string;
}): Promise<void> {
  const { accessToken } = await api(params.organizationId);

  const res = await fetch(
    `${YT_THUMBNAIL_ENDPOINT}?videoId=${encodeURIComponent(params.videoId)}&uploadType=media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": params.mimeType,
        "Content-Length": String(params.image.length),
      },
      body: new Uint8Array(params.image),
    },
  );

  if (!res.ok) {
    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      throw Errors.conflict(
        "YouTube refused the custom thumbnail. Custom thumbnails require a verified YouTube channel — verify the channel at youtube.com/verify, then retry just this step. The video itself is already uploaded.",
        `thumbnail 403: ${body.slice(0, 300)}`,
      );
    }
    await httpError(res, "youtube");
  }
}

/** Adds the video to a playlist. Returns the playlist *item* id. */
export async function addToPlaylist(params: {
  organizationId: string;
  playlistId: string;
  videoId: string;
}): Promise<string> {
  const { youtube } = await api(params.organizationId);
  try {
    const res = await youtube.playlistItems.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          playlistId: params.playlistId,
          resourceId: { kind: "youtube#video", videoId: params.videoId },
        },
      },
    });
    const id = res.data.id;
    if (!id) throw Errors.internal("YouTube returned no playlist item id");
    return id;
  } catch (err) {
    throw mapGoogleError(err, "youtube");
  }
}

/** True if the video is already in the playlist — makes retry idempotent. */
export async function isVideoInPlaylist(params: {
  organizationId: string;
  playlistId: string;
  videoId: string;
}): Promise<string | null> {
  const { youtube } = await api(params.organizationId);
  try {
    const res = await youtube.playlistItems.list({
      part: ["id", "snippet"],
      playlistId: params.playlistId,
      videoId: params.videoId,
      maxResults: 1,
    });
    return res.data.items?.[0]?.id ?? null;
  } catch (err) {
    const mapped = mapGoogleError(err, "youtube");
    // Treat an unreadable playlist as "unknown" rather than failing the check.
    if (mapped.status === 404) return null;
    throw mapped;
  }
}

export interface VideoStatus {
  videoId: string;
  uploadStatus: string | null;
  processingStatus: string | null;
  privacyStatus: string | null;
  rejectionReason: string | null;
  title: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

/** Verification step: confirms YouTube really has what we think it has. */
export async function getVideoStatus(
  organizationId: string,
  videoId: string,
): Promise<VideoStatus | null> {
  const { youtube } = await api(organizationId);
  try {
    const res = await youtube.videos.list({
      part: ["status", "processingDetails", "snippet"],
      id: [videoId],
    });
    const v = res.data.items?.[0];
    if (!v) return null;
    return {
      videoId,
      uploadStatus: v.status?.uploadStatus ?? null,
      processingStatus: v.processingDetails?.processingStatus ?? null,
      privacyStatus: v.status?.privacyStatus ?? null,
      rejectionReason: v.status?.rejectionReason ?? null,
      title: v.snippet?.title ?? null,
      publishedAt: v.snippet?.publishedAt ?? null,
      thumbnailUrl: v.snippet?.thumbnails?.medium?.url ?? null,
    };
  } catch (err) {
    throw mapGoogleError(err, "youtube");
  }
}

/** Video categories for the chosen region, for the create-content form. */
export async function fetchVideoCategories(
  organizationId: string,
  regionCode = "IN",
): Promise<{ id: string; title: string }[]> {
  const { youtube } = await api(organizationId);
  try {
    const res = await youtube.videoCategories.list({ part: ["snippet"], regionCode });
    return (res.data.items ?? [])
      .filter((c) => c.snippet?.assignable)
      .map((c) => ({ id: c.id ?? "", title: c.snippet?.title ?? "" }))
      .filter((c) => c.id);
  } catch (err) {
    throw mapGoogleError(err, "youtube");
  }
}
