import { drive_v3, google } from "googleapis";
import { PassThrough } from "stream";
import { db } from "../db";
import { Errors, mapGoogleError } from "../errors";
import { logger } from "../logger";
import { getAuthorizedClient } from "./client";
import { DriveFolderKind } from "@/generated/prisma";

/**
 * Google Drive media store (Section 10).
 *
 * Upload architecture (Section 11, decision A):
 * the browser uploads bytes DIRECTLY to Google. This module creates a
 * *resumable session URI* server-side using the organisation's OAuth token and
 * hands only that URI to the client. Consequences:
 *
 *  - bytes never traverse our server, so there is no 4.5 MB serverless body
 *    limit and no egress bill;
 *  - an interrupted upload resumes by asking Google for the committed offset
 *    rather than starting again;
 *  - the OAuth access token is never exposed to the browser.
 *
 * The session URI is itself a capability — anyone holding it can write to that
 * one file — so it is treated as a secret: never logged (see logger.ts), and
 * cleared from the database once the upload completes.
 */

const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Google resumable sessions live about a week; we expire ours sooner. */
const SESSION_TTL_MS = 6 * 24 * 60 * 60 * 1000;

async function client(organizationId: string): Promise<{
  drive: drive_v3.Drive;
  accessToken: string;
}> {
  const { client: auth, accessToken } = await getAuthorizedClient(organizationId, "drive");
  console.log(`[Drive client] Using access token (first 20 chars): ${accessToken.slice(0, 20)}...`);
  return { drive: google.drive({ version: "v3", auth }), accessToken };
}

// ---------------------------------------------------------------------------
// Folder structure
// ---------------------------------------------------------------------------

/** Display names for the workflow folders. */
const FOLDER_NAMES: Record<DriveFolderKind, string> = {
  [DriveFolderKind.ROOT]: "YouTube Content",
  [DriveFolderKind.DRAFTS]: "Drafts",
  [DriveFolderKind.READY_FOR_REVIEW]: "Ready for Review",
  [DriveFolderKind.APPROVED]: "Approved",
  [DriveFolderKind.PUBLISHED]: "Published",
  [DriveFolderKind.FAILED]: "Failed",
  [DriveFolderKind.ARCHIVE]: "Archive",
  [DriveFolderKind.THUMBNAILS]: "Thumbnails",
};

const CHILD_KINDS: DriveFolderKind[] = [
  DriveFolderKind.DRAFTS,
  DriveFolderKind.READY_FOR_REVIEW,
  DriveFolderKind.APPROVED,
  DriveFolderKind.PUBLISHED,
  DriveFolderKind.FAILED,
  DriveFolderKind.ARCHIVE,
  DriveFolderKind.THUMBNAILS,
];

async function createFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<drive_v3.Schema$File> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id,name,webViewLink",
  });
  if (!res.data.id) throw Errors.internal("Drive did not return a folder id");
  return res.data;
}

/** True if the folder still exists and is not trashed. */
async function folderIsUsable(drive: drive_v3.Drive, folderId: string): Promise<boolean> {
  try {
    const res = await drive.files.get({ fileId: folderId, fields: "id,trashed" });
    return res.data.trashed !== true;
  } catch {
    return false;
  }
}

/**
 * Creates (or repairs) the folder tree and records the ids.
 *
 * Idempotent and self-healing: if an admin deletes a folder in Drive, the next
 * call notices it is gone or trashed and recreates it rather than failing
 * every subsequent upload with a 404.
 *
 * Note we always CREATE the root rather than adopting an existing folder —
 * the `drive.file` scope only grants access to files this app created, which
 * is a deliberate least-privilege trade-off (see scopes.ts).
 */
export async function ensureFolderTree(organizationId: string): Promise<
  Record<DriveFolderKind, string>
> {
  const { drive } = await client(organizationId);

  try {
    const existing = await db.driveFolder.findMany({ where: { organizationId } });
    const byKind = new Map(existing.map((f) => [f.kind, f]));

    // --- root ---
    let root = byKind.get(DriveFolderKind.ROOT);
    if (!root || !(await folderIsUsable(drive, root.driveFolderId))) {
      const created = await createFolder(drive, FOLDER_NAMES[DriveFolderKind.ROOT]);
      root = await db.driveFolder.upsert({
        where: { organizationId_kind: { organizationId, kind: DriveFolderKind.ROOT } },
        create: {
          organizationId,
          kind: DriveFolderKind.ROOT,
          driveFolderId: created.id!,
          name: created.name ?? FOLDER_NAMES[DriveFolderKind.ROOT],
          webViewLink: created.webViewLink ?? null,
        },
        update: {
          driveFolderId: created.id!,
          webViewLink: created.webViewLink ?? null,
        },
      });
      logger.info("drive root folder created", { organizationId, folderId: created.id });
    }

    const out: Record<string, string> = { [DriveFolderKind.ROOT]: root.driveFolderId };

    // --- children ---
    for (const kind of CHILD_KINDS) {
      const current = byKind.get(kind);
      if (current && (await folderIsUsable(drive, current.driveFolderId))) {
        out[kind] = current.driveFolderId;
        continue;
      }
      const created = await createFolder(drive, FOLDER_NAMES[kind], root.driveFolderId);
      const saved = await db.driveFolder.upsert({
        where: { organizationId_kind: { organizationId, kind } },
        create: {
          organizationId,
          kind,
          driveFolderId: created.id!,
          name: created.name ?? FOLDER_NAMES[kind],
          webViewLink: created.webViewLink ?? null,
        },
        update: {
          driveFolderId: created.id!,
          webViewLink: created.webViewLink ?? null,
        },
      });
      out[kind] = saved.driveFolderId;
    }

    return out as Record<DriveFolderKind, string>;
  } catch (err) {
    throw mapGoogleError(err, "drive");
  }
}

/** Folder id for a workflow stage, creating the tree if needed. */
export async function getFolderId(
  organizationId: string,
  kind: DriveFolderKind,
): Promise<string> {
  const row = await db.driveFolder.findUnique({
    where: { organizationId_kind: { organizationId, kind } },
  });
  if (row) return row.driveFolderId;
  const tree = await ensureFolderTree(organizationId);
  return tree[kind];
}

// ---------------------------------------------------------------------------
// Resumable upload sessions
// ---------------------------------------------------------------------------

export interface ResumableSession {
  sessionUri: string;
  expiresAt: Date;
}

/**
 * Asks Drive to open a resumable upload session.
 *
 * Uses raw fetch rather than the googleapis client because we need the
 * `Location` response header (the session URI), which the client library does
 * not surface.
 */
export async function createResumableUploadSession(params: {
  organizationId: string;
  folderId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Arbitrary key/value metadata stored on the Drive file itself. */
  appProperties?: Record<string, string>;
}): Promise<ResumableSession> {
  const { accessToken } = await client(params.organizationId);

  const metadata: Record<string, unknown> = {
    name: params.filename,
    parents: [params.folderId],
    ...(params.appProperties ? { appProperties: params.appProperties } : {}),
  };

  const res = await fetch(`${DRIVE_UPLOAD_ENDPOINT}?uploadType=resumable&fields=id,name,size,md5Checksum,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      // Declaring type and length up front lets Drive reject an oversized or
      // unsupported upload before a single byte is transferred.
      "X-Upload-Content-Type": params.mimeType,
      "X-Upload-Content-Length": String(params.sizeBytes),
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[Drive session creation] Google ${res.status}:`, body.slice(0, 500));
    throw mapGoogleError(
      { response: { status: res.status, data: safeJson(body) }, message: body.slice(0, 500) },
      "drive",
    );
  }

  const sessionUri = res.headers.get("location");
  if (!sessionUri) {
    throw Errors.internal("Drive did not return a resumable session URI");
  }

  return { sessionUri, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
}

export interface SessionStatus {
  /** 'complete' once Drive has the whole file. */
  state: "incomplete" | "complete" | "expired";
  /** Bytes Drive has committed. Next chunk must start exactly here. */
  receivedBytes: number;
  file?: DriveFileInfo;
}

/**
 * Asks Drive how much of the file it already has.
 *
 * This is the mechanism behind "resume after the browser was closed"
 * (Section 12/25): a zero-length PUT with `Content-Range: bytes * /total`
 * returns 308 plus a Range header describing the committed prefix.
 */
export async function probeResumableSession(
  sessionUri: string,
  totalBytes: number,
): Promise<SessionStatus> {
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${totalBytes}` },
  });

  if (res.status === 308) {
    const range = res.headers.get("range"); // e.g. "bytes=0-262143"
    const received = range ? Number(range.split("-")[1]) + 1 : 0;
    return { state: "incomplete", receivedBytes: Number.isFinite(received) ? received : 0 };
  }

  if (res.status === 200 || res.status === 201) {
    const file = (await res.json().catch(() => ({}))) as drive_v3.Schema$File;
    return { state: "complete", receivedBytes: totalBytes, file: toFileInfo(file) };
  }

  // 404/410 — Google has forgotten this session; the client must start over.
  if (res.status === 404 || res.status === 410) {
    return { state: "expired", receivedBytes: 0 };
  }

  const body = await res.text().catch(() => "");
  throw mapGoogleError(
    { response: { status: res.status, data: safeJson(body) }, message: body.slice(0, 500) },
    "drive",
  );
}

// ---------------------------------------------------------------------------
// File metadata & bytes
// ---------------------------------------------------------------------------

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum: string | null;
  webViewLink: string | null;
  trashed: boolean;
}

function toFileInfo(f: drive_v3.Schema$File): DriveFileInfo {
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "application/octet-stream",
    sizeBytes: f.size ? Number(f.size) : 0,
    md5Checksum: f.md5Checksum ?? null,
    webViewLink: f.webViewLink ?? null,
    trashed: f.trashed ?? false,
  };
}

export async function getFileInfo(
  organizationId: string,
  fileId: string,
): Promise<DriveFileInfo> {
  const { drive } = await client(organizationId);
  try {
    const res = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size,md5Checksum,webViewLink,trashed",
    });
    return toFileInfo(res.data);
  } catch (err) {
    throw mapGoogleError(err, "drive");
  }
}

/**
 * Reads a byte range from a Drive file.
 *
 * This is what feeds the Drive→YouTube relay. Ranged reads keep memory bounded
 * to one chunk regardless of how large the video is — downloading a 5 GB file
 * into a serverless function would exhaust its memory and its time limit.
 *
 * `start`/`endInclusive` follow HTTP Range semantics.
 */
export async function downloadRange(
  organizationId: string,
  fileId: string,
  start: number,
  endInclusive: number,
): Promise<Buffer> {
  const { accessToken } = await client(organizationId);

  const res = await fetch(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: `bytes=${start}-${endInclusive}`,
    },
  });

  // 206 = partial content (expected). 200 = server ignored Range and sent all
  // of it, which we must tolerate by slicing.
  if (res.status !== 206 && res.status !== 200) {
    const body = await res.text().catch(() => "");
    throw mapGoogleError(
      { response: { status: res.status, data: safeJson(body) }, message: body.slice(0, 500) },
      "drive",
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status === 200 && buf.length > endInclusive - start + 1) {
    return buf.subarray(start, endInclusive + 1);
  }
  return buf;
}

/** Moves a file between workflow folders, mirroring submission state. */
export async function moveFile(
  organizationId: string,
  fileId: string,
  toFolderId: string,
): Promise<void> {
  const { drive } = await client(organizationId);
  try {
    const current = await drive.files.get({ fileId, fields: "parents" });
    const previousParents = (current.data.parents ?? []).join(",");
    await drive.files.update({
      fileId,
      addParents: toFolderId,
      ...(previousParents ? { removeParents: previousParents } : {}),
      fields: "id,parents",
    });
  } catch (err) {
    // A failed tidy-up must never fail a publish: the bytes are safe either
    // way and the folder is only an organisational convenience.
    logger.warn("drive move failed; file left in place", {
      organizationId,
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteFile(organizationId: string, fileId: string): Promise<void> {
  const { drive } = await client(organizationId);
  try {
    await drive.files.delete({ fileId });
  } catch (err) {
    const mapped = mapGoogleError(err, "drive");
    // Already gone is a success for our purposes.
    if (mapped.status === 404) return;
    throw mapped;
  }
}

/** Storage quota, for the admin health page. */
export async function getStorageQuota(organizationId: string): Promise<{
  limitBytes: number | null;
  usageBytes: number;
}> {
  const { drive } = await client(organizationId);
  try {
    const res = await drive.about.get({ fields: "storageQuota" });
    const q = res.data.storageQuota;
    return {
      limitBytes: q?.limit ? Number(q.limit) : null,
      usageBytes: q?.usage ? Number(q.usage) : 0,
    };
  } catch (err) {
    throw mapGoogleError(err, "drive");
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

/**
 * Direct upload from server to Drive (bypasses CORS).
 *
 * Used when the browser cannot upload directly to Google due to CORS restrictions.
 * The file is uploaded to our server first, then streamed to Drive.
 */
export async function uploadToDriveDirect(params: {
  organizationId: string;
  folderId: string;
  filename: string;
  mimeType: string;
  file: File;
  appProperties?: Record<string, string>;
}): Promise<drive_v3.Schema$File> {
  const { drive } = await client(params.organizationId);

  const metadata: Record<string, unknown> = {
    name: params.filename,
    parents: [params.folderId],
    ...(params.appProperties ? { appProperties: params.appProperties } : {}),
  };

  console.log(`[Drive direct upload] Starting upload: ${params.filename}, size ${params.file.size}`);

  try {
    const arrayBuffer = await params.file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[Drive direct upload] File converted to buffer, size ${buffer.length}`);

    // Create a PassThrough stream and push the buffer through it
    const stream = new PassThrough();
    stream.end(buffer);

    const res = await drive.files.create({
      requestBody: metadata,
      media: {
        mimeType: params.mimeType,
        body: stream,
      },
      fields: "id,name,size,md5Checksum,webViewLink",
    });

    if (!res.data.id) {
      throw Errors.internal("Drive did not return a file id");
    }

    console.log(`[Drive direct upload] Upload complete: ${res.data.id}`);
    return res.data;
  } catch (err) {
    console.error(`[Drive direct upload] Failed:`, err);
    throw mapGoogleError(err, "drive");
  }
}
