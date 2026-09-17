"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileVideo,
  ImageIcon,
  RotateCw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { cn, formatBytes } from "@/lib/utils";
import {
  formatEta,
  formatSpeed,
  uploadFile,
  type UploadProgress,
} from "@/lib/upload-client";

export interface ExistingMedia {
  id: string;
  kind: "VIDEO" | "THUMBNAIL" | "SUPPORTING_IMAGE";
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
  uploadState: string;
  width?: number | null;
  height?: number | null;
  driveWebViewLink?: string | null;
}

const PHASE_LABEL: Record<UploadProgress["phase"], string> = {
  idle: "",
  hashing: "Checking file…",
  creating: "Preparing upload…",
  uploading: "Uploading to Google Drive",
  completed: "Uploaded",
  failed: "Upload failed",
  cancelled: "Cancelled",
};

/**
 * Upload control for one media slot.
 *
 * Deliberate behaviours:
 *  - the file input accepts a single file and is re-created after each
 *    completion, so re-selecting the same file fires `change` again;
 *  - an in-flight upload can be cancelled, and cancelling aborts the network
 *    request rather than merely hiding the progress bar;
 *  - a failure keeps the chosen file so "Try again" does not require the user
 *    to hunt through their photo library a second time.
 */
export function FileUpload({
  submissionId,
  kind,
  label,
  description,
  accept,
  existing,
  onChanged,
  anchorId,
}: {
  submissionId: string;
  kind: "VIDEO" | "THUMBNAIL" | "SUPPORTING_IMAGE";
  label: string;
  description?: string;
  accept: string;
  existing?: ExistingMedia | null;
  onChanged?: () => void;
  anchorId?: string;
}) {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  /**
   * State, not a ref: the "Try again" button's presence depends on it, and a
   * ref mutation does not trigger the re-render that would reveal the button.
   */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs must be revoked or the tab leaks memory for every preview.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const start = useCallback(
    async (file: File) => {
      setPendingFile(file);
      const controller = new AbortController();
      abortRef.current = controller;

      if (file.type.startsWith("image/")) {
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(file);
        });
      }

      try {
        const result = await uploadFile({
          submissionId,
          kind,
          file,
          onProgress: setProgress,
          signal: controller.signal,
        });

        if (result.duplicateOfSubmissionRef) {
          toast.warning("This file has been uploaded before", {
            description: `An identical file is already attached to ${result.duplicateOfSubmissionRef}. Check you are not publishing the same recording twice.`,
          });
        } else {
          toast.success(`${label} uploaded`);
        }
        setPendingFile(null);
        onChanged?.();
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          setProgress({
            phase: "cancelled",
            bytesSent: 0,
            totalBytes: file.size,
            percent: 0,
            bytesPerSecond: null,
            secondsRemaining: null,
          });
          return;
        }
        const message = err instanceof Error ? err.message : "Upload failed.";
        setProgress({
          phase: "failed",
          bytesSent: 0,
          totalBytes: file.size,
          percent: 0,
          bytesPerSecond: null,
          secondsRemaining: null,
          error: message,
        });
        toast.error("Upload failed", { description: message });
      } finally {
        abortRef.current = null;
        // Reset the input so choosing the same file again still fires change.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [submissionId, kind, label, onChanged],
  );

  const remove = useCallback(async () => {
    if (!existing) return;
    try {
      const res = await fetch(`/api/uploads/${existing.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "Could not remove the file.");
      }
      setProgress(null);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      toast.success(`${label} removed`);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the file.");
    }
  }, [existing, label, onChanged]);

  const busy =
    progress !== null &&
    ["hashing", "creating", "uploading"].includes(progress.phase);

  // ---- already uploaded ----
  if (existing && existing.uploadState === "COMPLETED" && !busy) {
    const isImage = existing.mimeType.startsWith("image/");
    return (
      <div id={anchorId} className="rounded-lg border border-success-200 bg-success-50/50 p-3">
        <div className="flex items-start gap-3">
          {isImage && preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="size-16 shrink-0 rounded-md border border-line object-cover"
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-surface border border-line">
              {isImage ? (
                <ImageIcon className="size-6 text-ink-faint" aria-hidden="true" />
              ) : (
                <FileVideo className="size-6 text-ink-faint" aria-hidden="true" />
              )}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 shrink-0 text-success-700" aria-hidden="true" />
              <p className="truncate text-sm font-medium text-ink">
                {existing.originalFilename}
              </p>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">
              {formatBytes(existing.sizeBytes)}
              {existing.width && existing.height ? ` · ${existing.width}×${existing.height}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
                <RotateCw className="size-3.5" aria-hidden="true" />
                Replace
              </Button>
              <Button size="sm" variant="ghost" onClick={remove}>
                <Trash2 className="size-3.5" aria-hidden="true" />
                Remove
              </Button>
            </div>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void start(f);
          }}
        />
      </div>
    );
  }

  // ---- uploading ----
  if (busy && progress) {
    return (
      <div id={anchorId} className="rounded-lg border border-line bg-surface p-3.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium text-ink">
            {PHASE_LABEL[progress.phase]}
            {progress.retrying ? ` · retrying (${progress.attempt})` : ""}
          </p>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
            {progress.percent}%
          </span>
        </div>

        <Progress
          value={progress.bytesSent}
          total={progress.totalBytes}
          label={`${label} upload progress`}
        />

        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-soft">
          <span>
            {formatBytes(progress.bytesSent)} of {formatBytes(progress.totalBytes)}
            {progress.bytesPerSecond ? ` · ${formatSpeed(progress.bytesPerSecond)}` : ""}
          </span>
          <span>{formatEta(progress.secondsRemaining)}</span>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-faint">
            You can keep filling in the details below while this uploads.
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => abortRef.current?.abort()}
            aria-label="Cancel upload"
          >
            <X className="size-3.5" aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ---- failed / cancelled ----
  if (progress && (progress.phase === "failed" || progress.phase === "cancelled")) {
    return (
      <div id={anchorId} className="rounded-lg border border-danger-200 bg-danger-50/60 p-3.5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-danger-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-danger-700">
              {progress.phase === "cancelled" ? "Upload cancelled" : "Upload failed"}
            </p>
            {progress.error && (
              <p className="mt-0.5 text-xs text-danger-700/90">{progress.error}</p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {pendingFile && (
                <Button size="sm" onClick={() => void start(pendingFile)}>
                  <RotateCw className="size-3.5" aria-hidden="true" />
                  Try again
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
                Choose a different file
              </Button>
            </div>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void start(f);
          }}
        />
      </div>
    );
  }

  // ---- empty ----
  return (
    <div
      id={anchorId}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void start(f);
      }}
      className={cn(
        "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
        dragging ? "border-brand-500 bg-brand-50" : "border-line-strong bg-surface-muted/40",
      )}
    >
      <UploadCloud className="mx-auto size-7 text-ink-faint" aria-hidden="true" />
      <p className="mt-2.5 text-sm font-medium text-ink">{label}</p>
      {description && <p className="mt-1 text-xs text-ink-soft">{description}</p>}

      <Button
        type="button"
        variant="secondary"
        size="md"
        className="mt-3.5"
        onClick={() => inputRef.current?.click()}
      >
        Choose file
      </Button>
      <p className="mt-2 text-xs text-ink-faint sm:hidden">
        You can record and upload straight from your phone.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void start(f);
        }}
      />
    </div>
  );
}
