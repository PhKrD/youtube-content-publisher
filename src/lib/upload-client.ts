"use client";

/**
 * Browser-side resumable uploader (Sections 12, 25, 41).
 *
 * Bytes go straight from the user's device to Google. Our server is only
 * involved twice: once to open the session, once to confirm completion.
 *
 * Reliability properties:
 *  - chunked, so a dropped connection costs one chunk, not the whole file;
 *  - the resume offset is asked of Google rather than remembered locally,
 *    which is what allows recovery after a refresh or a crash;
 *  - transient failures retry with exponential backoff, permanent ones stop;
 *  - `AbortController` makes cancellation immediate rather than cosmetic.
 */

export type UploadPhase =
  | "idle"
  | "hashing"
  | "creating"
  | "uploading"
  | "finalising"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadProgress {
  phase: UploadPhase;
  bytesSent: number;
  totalBytes: number;
  percent: number;
  /** Bytes/second over a recent window, or null before a useful estimate. */
  bytesPerSecond: number | null;
  secondsRemaining: number | null;
  error?: string;
  /** True when retrying after a transient failure. */
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

/** Google requires resumable chunks to be multiples of 256 KiB. */
const ALIGNMENT = 262144;
const DEFAULT_CHUNK = 8 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 5;

/**
 * Above this size we skip the integrity hash.
 *
 * Web Crypto has no incremental digest API, so hashing requires the whole
 * file in memory at once. Doing that to a 4 GB video would crash the tab —
 * far worse than losing an optional duplicate-detection hint. Drive's own
 * md5Checksum still verifies what arrived.
 */
const MAX_HASH_BYTES = 256 * 1024 * 1024;

function alignChunk(size: number): number {
  return Math.max(ALIGNMENT, Math.floor(size / ALIGNMENT) * ALIGNMENT);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

/** SHA-256 of the file, or undefined when it is too large to hash safely. */
export async function computeChecksum(file: File): Promise<string | undefined> {
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

/** Natural dimensions of an image file, for thumbnail validation. */
export async function probeImage(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Duration of a video file, best-effort. */
export async function probeVideoDuration(file: File): Promise<number | null> {
  if (!file.type.startsWith("video/")) return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        resolve(Number.isFinite(video.duration) ? video.duration : null);
      video.onerror = () => resolve(null);
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface CreateSessionResponse {
  mediaFileId: string;
  sessionUri: string;
  chunkSize: number;
  duplicateOfSubmissionRef: string | null;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  } & T;
  if (!res.ok) {
    throw new Error(body?.error?.message ?? "Something went wrong. Please try again.");
  }
  return body;
}

/** Tracks throughput over a sliding window for a stable ETA. */
class RateMeter {
  private samples: { at: number; bytes: number }[] = [];

  record(bytes: number) {
    const now = Date.now();
    this.samples.push({ at: now, bytes });
    // Keep ~10s of history: long enough to be stable, short enough to react.
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

/**
 * Uploads a file, resuming automatically if Google already holds part of it.
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

  const session = await apiJson<CreateSessionResponse>("/api/uploads", {
    method: "POST",
    signal,
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
  });

  const chunkSize = alignChunk(session.chunkSize || DEFAULT_CHUNK);
  let offset = 0;
  let finalBody: { id?: string; webViewLink?: string; md5Checksum?: string } | null = null;

  report({ phase: "uploading", bytesSent: 0 });

  console.log(`[Upload client] Starting upload to ${session.sessionUri.slice(0, 50)}..., total size ${file.size}, chunk size ${chunkSize}`);

  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const end = Math.min(offset + chunkSize, file.size);
    const blob = file.slice(offset, end);

    console.log(`[Upload client] Uploading chunk: offset ${offset}, end ${end}, blob size ${blob.size}`);

    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(session.sessionUri, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
          body: blob,
          signal,
        });

        // 308: chunk accepted, more expected.
        if (res.status === 308) {
          const range = res.headers.get("range");
          // Trust Google's committed offset over our own arithmetic.
          offset = range ? Number(range.split("-")[1]) + 1 : end;
          meter.record(offset);
          report({ phase: "uploading", bytesSent: offset });
          break;
        }

        // 200/201: whole file accepted.
        if (res.status === 200 || res.status === 201) {
          finalBody = await res.json().catch(() => null);
          offset = file.size;
          meter.record(offset);
          report({ phase: "finalising", bytesSent: offset });
          break;
        }

        // The session is gone; nothing to resume onto.
        if (res.status === 404 || res.status === 410) {
          throw new Error(
            "This upload session expired. Please choose the file again — nothing else about your submission was lost.",
          );
        }

        // 5xx / 429: transient. Retry the same chunk.
        if (res.status >= 500 || res.status === 429) {
          const body = await res.text().catch(() => "");
          console.error(`[Drive upload] Google ${res.status} at offset ${offset}:`, body.slice(0, 500));
          throw Object.assign(new Error(`Google returned ${res.status}`), { transient: true });
        }

        // 4xx other than 404/410: permanent. Show the actual error.
        const body = await res.text().catch(() => "");
        console.error(`[Drive upload] Permanent error ${res.status} at offset ${offset}:`, body.slice(0, 500));
        throw new Error(
          `The upload was rejected (${res.status}): ${body.slice(0, 200)}. Please check the file and try again.`,
        );
      } catch (err) {
        console.error(`[Drive upload] Attempt ${attempt + 1} failed at offset ${offset}:`, err instanceof Error ? err.message : String(err));
        if (signal?.aborted || (err as Error)?.name === "AbortError") throw err;

        const transient =
          (err as { transient?: boolean }).transient === true ||
          // A network drop surfaces as a TypeError from fetch.
          err instanceof TypeError;

        if (!transient || attempt >= MAX_CHUNK_RETRIES) {
          report({
            phase: "failed",
            bytesSent: offset,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        attempt++;
        report({ phase: "uploading", bytesSent: offset, retrying: true, attempt });

        // Before retrying, ask Google what it actually has: the failed chunk
        // may have partially landed, and resending from a stale offset would
        // corrupt the file.
        await sleep(Math.min(1000 * 2 ** attempt, 15_000), signal);
        try {
          const probe = await fetch(session.sessionUri, {
            method: "PUT",
            headers: { "Content-Range": `bytes */${file.size}` },
            signal,
          });
          if (probe.status === 308) {
            const range = probe.headers.get("range");
            offset = range ? Number(range.split("-")[1]) + 1 : offset;
          } else if (probe.status === 200 || probe.status === 201) {
            finalBody = await probe.json().catch(() => null);
            offset = file.size;
            break;
          }
        } catch {
          // Probe failed too — loop and retry the chunk as-is.
        }
      }
    }
  }

  report({ phase: "finalising", bytesSent: file.size });

  const completed = await apiJson<{ mediaFileId: string; driveFileId: string; webViewLink?: string }>(
    `/api/uploads/${session.mediaFileId}`,
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        driveFileId: finalBody?.id,
        driveMd5: finalBody?.md5Checksum,
        webViewLink: finalBody?.webViewLink,
      }),
    },
  );

  report({ phase: "completed", bytesSent: file.size });

  return {
    mediaFileId: completed.mediaFileId,
    driveFileId: completed.driveFileId,
    webViewLink: completed.webViewLink ?? null,
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
