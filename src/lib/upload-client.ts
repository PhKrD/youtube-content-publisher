"use client";

/**
 * Browser-side chunked uploader for large files (up to 2 GB).
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
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(undefined);
    img.src = URL.createObjectURL(file);
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
  const res = await fetch(url, options);
  const body = await res.json() as T & { error?: { message: string } };
  if (!res.ok) {
    throw new Error(body?.error?.message ?? "Something went wrong. Please try again.");
  }
  return body;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Uploads a file using chunked upload to support large files (up to 2 GB).
 * Browser uploads file in chunks to server, server streams to Google Drive.
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

  console.log(`[Upload client] Using chunked upload for ${file.name}, size ${file.size}`);

  // Create chunked upload session
  const session = await apiJson<{
    mediaFileId: string;
    sessionUri: string;
    chunkSize: number;
    totalChunks: number;
    status: string;
  }>("/api/uploads/chunked", {
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

  console.log(`[Upload client] Session created: ${session.mediaFileId}, total chunks: ${session.totalChunks}`);

  const chunkSize = session.chunkSize;
  const totalChunks = session.totalChunks;
  let offset = 0;

  report({ phase: "uploading", bytesSent: 0 });

  // Upload file in chunks
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const end = Math.min(offset + chunkSize, file.size);
    const blob = file.slice(offset, end);

    console.log(`[Upload client] Uploading chunk ${chunkIndex + 1}/${totalChunks}: offset ${offset}, size ${blob.size}`);

    // Convert blob to base64
    const chunkBase64 = await blobToBase64(blob);

    const res = await fetch("/api/uploads/chunked", {
      method: "POST",
      signal,
      body: JSON.stringify({
        mediaFileId: session.mediaFileId,
        chunkIndex,
        chunkData: chunkBase64,
        totalChunks,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[Upload client] Chunk ${chunkIndex + 1} failed: ${res.status}`, body.slice(0, 500));
      throw new Error(`Chunk upload failed: ${body.slice(0, 200)}`);
    }

    const result = await res.json();
    console.log(`[Upload client] Chunk ${chunkIndex + 1} result:`, result.status);

    if (result.status === "upload_complete") {
      console.log(`[Upload client] Upload complete: ${result.driveFileId}`);
      report({ phase: "completed", bytesSent: file.size });
      return {
        mediaFileId: session.mediaFileId,
        driveFileId: result.driveFileId,
        webViewLink: result.webViewLink ?? null,
        duplicateOfSubmissionRef: null,
      };
    }

    offset = end;
    meter.record(offset);
    report({ phase: "uploading", bytesSent: offset });
  }

  throw new Error("Upload did not complete successfully");
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
