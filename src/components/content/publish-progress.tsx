"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Clock,
  ExternalLink,
  Loader2,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, IndeterminateProgress, Progress } from "@/components/ui/misc";
import { cn, formatBytes, relativeTime } from "@/lib/utils";

interface JobState {
  id: string;
  state: "QUEUED" | "RUNNING" | "WAITING_RETRY" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  currentStep:
    | "CREATE_YOUTUBE_UPLOAD"
    | "RELAY_BYTES"
    | "APPLY_THUMBNAIL"
    | "ADD_TO_PLAYLIST"
    | "VERIFY"
    | "DONE";
  attempt: number;
  maxAttempts: number;
  bytesSent: number;
  totalBytes: number | null;
  lastError: string | null;
  isTerminal: boolean;
  runAfter: string;
  willRetry: boolean;
}

interface PublicationState {
  youtubeVideoId: string;
  youtubeUrl: string | null;
  videoUploadedAt: string | null;
  thumbnailAppliedAt: string | null;
  playlistAddedAt: string | null;
  verifiedAt: string | null;
  uploadStatus: string | null;
  processingStatus: string | null;
  rejectionReason: string | null;
}

/**
 * Live publishing progress (Section 24).
 *
 * Every row reflects real, server-recorded state. Where progress genuinely
 * cannot be measured — YouTube's own transcoding — an indeterminate bar is
 * used rather than a fabricated percentage.
 */
export function PublishProgress({
  submissionId,
  canRetry,
  hasThumbnail,
  hasPlaylist,
  channelTitle,
}: {
  submissionId: string;
  canRetry: boolean;
  hasThumbnail: boolean;
  hasPlaylist: boolean;
  /** Needed to re-confirm the destination on retry — a retry still writes live. */
  channelTitle: string | null;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobState | null>(null);
  const [publication, setPublication] = useState<PublicationState | null>(null);
  const [retrying, setRetrying] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/submissions/${submissionId}/publish`, { cache: "no-store" });
      if (!res.ok) return null;
      const body = await res.json();
      setJob(body.job);
      setPublication(body.publication);
      return body.job as JobState | null;
    } catch {
      return null;
    }
  }, [submissionId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const current = await poll();
      if (cancelled) return;

      const active =
        current && ["QUEUED", "RUNNING", "WAITING_RETRY"].includes(current.state);

      if (active) {
        // Poll faster while bytes are moving, slower while waiting to retry —
        // there is no point hammering the server during a backoff window.
        timer = setTimeout(tick, current!.state === "RUNNING" ? 2500 : 8000);
      } else if (current?.state === "SUCCEEDED") {
        // Refresh the server component so the page reflects PUBLISHED.
        router.refresh();
      }
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [poll, router]);

  const retry = useCallback(
    async (channelTitle: string) => {
      setRetrying(true);
      try {
        const res = await fetch(`/api/submissions/${submissionId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmChannelTitle: channelTitle }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not retry.");
        toast.success("Retrying", {
          description: "Only the steps that did not finish will be attempted again.",
        });
        void poll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not retry.");
      } finally {
        setRetrying(false);
      }
    },
    [submissionId, poll],
  );

  if (!job) return null;

  const stepOrder = [
    "CREATE_YOUTUBE_UPLOAD",
    "RELAY_BYTES",
    "APPLY_THUMBNAIL",
    "ADD_TO_PLAYLIST",
    "VERIFY",
    "DONE",
  ];
  const currentIndex = stepOrder.indexOf(job.currentStep);
  const failed = job.state === "FAILED";
  const done = job.state === "SUCCEEDED";

  /**
   * Completion is derived from the *publication record* rather than from the
   * job's current step, because the publication is the durable evidence that
   * a remote side-effect actually happened.
   */
  const steps = [
    {
      key: "CREATE_YOUTUBE_UPLOAD",
      label: "Preparing YouTube upload",
      complete: Boolean(publication?.youtubeVideoId) || currentIndex > 0,
    },
    {
      key: "RELAY_BYTES",
      label: "Uploading to YouTube",
      complete: Boolean(publication?.videoUploadedAt),
      progress:
        job.currentStep === "RELAY_BYTES" && job.totalBytes
          ? { sent: job.bytesSent, total: job.totalBytes }
          : undefined,
    },
    {
      key: "APPLY_THUMBNAIL",
      label: hasThumbnail ? "Applying thumbnail" : "Thumbnail (none supplied)",
      complete: Boolean(publication?.thumbnailAppliedAt) || (!hasThumbnail && currentIndex > 2),
      skipped: !hasThumbnail,
    },
    {
      key: "ADD_TO_PLAYLIST",
      label: hasPlaylist ? "Adding to playlist" : "Playlist (none selected)",
      complete: Boolean(publication?.playlistAddedAt) || (!hasPlaylist && currentIndex > 3),
      skipped: !hasPlaylist,
    },
    {
      key: "VERIFY",
      label: "Verifying on YouTube",
      complete: Boolean(publication?.verifiedAt),
      indeterminate:
        job.currentStep === "VERIFY" &&
        publication?.processingStatus !== null &&
        publication?.processingStatus !== "succeeded",
    },
  ];

  return (
    <div className="space-y-4">
      {/* --- failure explanation and recovery (Section 25) --- */}
      {failed && (
        <Alert
          tone="danger"
          title={job.isTerminal ? "Publishing failed" : "Publishing failed after several attempts"}
          icon={AlertTriangle}
        >
          <p>{job.lastError ?? "Something went wrong."}</p>

          {/* The reassurance that matters most: nothing was lost. */}
          {publication?.youtubeVideoId ? (
            <p className="mt-2 font-medium">
              The video is already on YouTube. Retrying will only complete the remaining steps — it
              will not upload a second copy.
            </p>
          ) : (
            <p className="mt-2 font-medium">
              Your video is safely stored in Google Drive. Nothing has been lost.
            </p>
          )}

          {canRetry && channelTitle && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              loading={retrying}
              loadingText="Retrying…"
              onClick={() => void retry(channelTitle)}
            >
              <RotateCw className="size-3.5" aria-hidden="true" />
              Retry the remaining steps
            </Button>
          )}
        </Alert>
      )}

      {job.willRetry && (
        <Alert tone="warn" title="Will retry automatically" icon={Clock}>
          {job.lastError ?? "A temporary problem occurred."} Attempt {job.attempt} of{" "}
          {job.maxAttempts}. Next try {relativeTime(job.runAfter)}.
        </Alert>
      )}

      {publication?.rejectionReason && (
        <Alert tone="danger" title="YouTube rejected this video" icon={AlertTriangle}>
          Reason: {publication.rejectionReason}
        </Alert>
      )}

      {/* --- step list --- */}
      <ol className="space-y-2.5">
        {steps.map((step, i) => {
          const isCurrent = !done && !failed && job.currentStep === step.key;
          const isPending = !step.complete && !isCurrent;

          return (
            <li key={step.key} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {step.complete ? (
                  <Check className="size-4 text-success-600" aria-hidden="true" />
                ) : isCurrent ? (
                  <Loader2 className="size-4 animate-spin text-brand-600" aria-hidden="true" />
                ) : failed && i === currentIndex ? (
                  <AlertTriangle className="size-4 text-danger-600" aria-hidden="true" />
                ) : (
                  <CircleDashed className="size-4 text-ink-faint" aria-hidden="true" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm",
                    step.complete
                      ? "text-ink"
                      : isCurrent
                        ? "font-medium text-ink"
                        : "text-ink-faint",
                    step.skipped && "italic",
                  )}
                >
                  {step.label}
                  {step.complete && step.skipped ? "" : ""}
                </p>

                {step.progress && (
                  <div className="mt-1.5">
                    <Progress
                      value={step.progress.sent}
                      total={step.progress.total}
                      label="YouTube upload progress"
                    />
                    <p className="mt-1 text-xs text-ink-soft">
                      {formatBytes(step.progress.sent)} of {formatBytes(step.progress.total)}
                    </p>
                  </div>
                )}

                {step.indeterminate && (
                  <div className="mt-1.5">
                    <IndeterminateProgress label="YouTube is processing the video" />
                    <p className="mt-1 text-xs text-ink-soft">
                      YouTube is processing the video. This can take several minutes and does not
                      report progress.
                    </p>
                  </div>
                )}

                {isPending && !step.progress && !step.indeterminate && (
                  <span className="sr-only">pending</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {publication?.youtubeUrl && (
        <Button asChild variant="secondary" size="sm">
          <a href={publication.youtubeUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" aria-hidden="true" />
            View on YouTube
          </a>
        </Button>
      )}
    </div>
  );
}
