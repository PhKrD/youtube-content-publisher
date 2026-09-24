"use client";

/**
 * Browser-side chunked uploader for all file sizes.
 *
 * Bytes go from browser → server (in chunks) → Google Drive.
 * This bypasses Vercel's 4.5 MB request body limit and CORS issues.
 */

export type UploadPhase =
  | "idle"
  | "hashing"
  | "creating"
  | "uploading"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadProgress {
  phase: UploadPhase;
  bytesSent: number;
  totalBytes: number;
  percent: number;
  bytesPerSecond: number | null;
  secondsRemaining: number | null;
  error?: string;
  retrying?: boolean;
  attempt?: number;
}

export interface UploadResult {
  mediaFileId: string;
  driveFileId: string;
  webViewLink?: string | null;
  duplicateOfSubmissionRef?: string | null;
}

export interface UploadOptions {
  submissionId: string;
  kind: "VIDEO" | "THUMBNAIL" | "SUPPORTING_IMAGE";
  file: File;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

const MAX_HASH_BYTES = 256 * 1024 * 1024;

async function computeChecksum(file: File): Promise<string | undefined> {
  if (file.size > MAX_HASH_BYTES) return undefined;
  if (!globalThis.crypto?.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

async function probeImage(file: File): Promise<{ width: number; height: number } | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(undefined);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

async function probeVideoDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("video/")) return undefined;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.onloadedmetadata = () => {
      resolve(video.duration);
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => resolve(undefined);
    video.src = URL.createObjectURL(file);
  });
}

class RateMeter {
  private samples: { at: number; bytes: number }[] = [];

  record(bytes: number) {
    const now = Date.now();
    this.samples.push({ at: now, bytes });
    const cutoff = now - 10_000;
    while (this.samples.length > 2 && this.samples[0].at < cutoff) this.samples.shift();
  }

  bytesPerSecond(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const seconds = (last.at - first.at) / 1000;
    if (seconds <= 0.5) return null;
    return (last.bytes - first.bytes) / seconds;
  }
}

async function apiJson<T>(url: string, options: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    // A dropped connection surfaces as a TypeError; worth retrying.
    if ((err as Error)?.name === "AbortError") throw err;
    throw Object.assign(new Error("Network connection lost. Retrying…"), { retryable: true });
  }
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string; retryable?: boolean } })
    | null;
  if (!res.ok || !body) {
    throw Object.assign(
      new Error(body?.error?.message ?? `Something went wrong (${res.status}). Please try again.`),
      { retryable: body?.error?.retryable ?? res.status >= 500 },
    );
  }
  return body;
}

/**
 * 4 MiB: a multiple of Drive's 256 KiB alignment and under Vercel's 4.5 MB
 * function body limit. Must match MAX_CHUNK_BYTES in /api/uploads/[id]/chunk.
 */
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_ATTEMPTS = 4;

type ChunkResult =
  | { complete: false; receivedBytes: number }
  | { complete: true; driveFileId: string; driveMd5: string | null; webViewLink: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads a file of any size to Google Drive via a resumable session.
 *
 * Google's upload endpoint has no CORS for this origin, so raw chunks are
 * relayed through /api/uploads/[id]/chunk, each small enough for one
 * serverless request. Chunks go sequentially; after a transient failure the
 * committed offset is re-read from Drive so a partially landed chunk cannot
 * corrupt the file.
 */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const { file, submissionId, kind, onProgress, signal } = options;
  const meter = new RateMeter();

  const report = (p: Partial<UploadProgress> & { phase: UploadPhase; bytesSent: number }) => {
    const bps = meter.bytesPerSecond();
    onProgress?.({
      totalBytes: file.size,
      percent: file.size > 0 ? Math.min(100, Math.round((p.bytesSent / file.size) * 100)) : 0,
      bytesPerSecond: bps,
      secondsRemaining:
        bps && bps > 0 ? Math.max(0, Math.round((file.size - p.bytesSent) / bps)) : null,
      ...p,
    });
  };

  report({ phase: "hashing", bytesSent: 0 });

  const [checksum, dimensions, duration] = await Promise.all([
    computeChecksum(file),
    probeImage(file),
    probeVideoDuration(file),
  ]);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  report({ phase: "creating", bytesSent: 0 });

  const session = await apiJson<{ mediaFileId: string; duplicateOfSubmissionRef: string | null }>(
    "/api/uploads",
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      submissionId,
      kind,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      checksumSha256: checksum,
      width: dimensions?.width,
      height: dimensions?.height,
        durationSeconds: duration ?? undefined,
      }),
    },
  );

  const base = `/api/uploads/${session.mediaFileId}`;
  let offset = 0;
  let done: Extract<ChunkResult, { complete: true }> | null = null;
  report({ phase: "uploading", bytesSent: 0 });

  // Consecutive failures; reset whenever Drive commits more bytes.
  let failures = 0;
  while (!done) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const end = Math.min(offset + CHUNK_BYTES, file.size);

    try {
      const result = await apiJson<ChunkResult>(`${base}/chunk?offset=${offset}`, {
        method: "PUT",
        signal,
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(offset, end),
      });
      if (result.complete) {
        done = result;
      } else if (result.receivedBytes > offset) {
        offset = result.receivedBytes;
        failures = 0;
      } else {
        throw Object.assign(new Error("Google Drive did not accept the chunk."), { retryable: true });
      }
    } catch (err) {
      failures++;
      if (signal?.aborted || failures >= MAX_CHUNK_ATTEMPTS || !(err as { retryable?: boolean }).retryable) {
        throw err;
      }
      report({ phase: "uploading", bytesSent: offset, retrying: true, attempt: failures });
      await sleep(1000 * 2 ** (failures - 1));
      // Resume from what Drive actually committed, not from our own arithmetic.
      const status = await apiJson<{ bytesReceived?: number }>(base, { signal }).catch(() => null);
      if (typeof status?.bytesReceived === "number") offset = status.bytesReceived;
      continue;
    }

    const sent = done ? file.size : offset;
    meter.record(sent);
    report({ phase: "uploading", bytesSent: sent });
  }

  const completed = await apiJson<{ mediaFileId: string; driveFileId: string; webViewLink: string | null }>(
    base,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driveFileId: done.driveFileId,
        driveMd5: done.driveMd5 ?? undefined,
        webViewLink: done.webViewLink ?? undefined,
      }),
    },
  );

  report({ phase: "completed", bytesSent: file.size });
  return {
    mediaFileId: completed.mediaFileId,
    driveFileId: completed.driveFileId,
    webViewLink: completed.webViewLink,
    duplicateOfSubmissionRef: session.duplicateOfSubmissionRef,
  };
}

export function formatSpeed(bytesPerSecond: number | null): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  const mb = bytesPerSecond / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s remaining`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min remaining`;
  return `${Math.floor(m / 60)}h ${m % 60}m remaining`;
}
