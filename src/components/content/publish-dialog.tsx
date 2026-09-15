"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, PlayCircle, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, DetailRow } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

/**
 * Final publish confirmation (Section 22).
 *
 * Requires the administrator/publisher to TYPE the channel name. A plain
 * "Are you sure?" is clicked through reflexively; typing the destination
 * forces the one question that matters — "am I publishing to the right
 * channel?" — to actually be read. Publishing cannot be undone from here.
 */
export function PublishDialog({
  open,
  onOpenChange,
  submissionId,
  channelTitle,
  playlistTitle,
  title,
  scheduledAt,
  privacyStatus,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  channelTitle: string | null;
  playlistTitle: string | null;
  title: string;
  scheduledAt?: string | null;
  privacyStatus?: string;
  onPublished?: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Clears the typed confirmation on close, so reopening never starts out
   * already satisfied. Done in the change handler rather than an effect —
   * resetting state from an effect causes a cascading re-render, and React's
   * own lint rule flags it.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setConfirmation("");
      setError(null);
    }
    onOpenChange(next);
  };

  const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const matches = Boolean(channelTitle) && normalise(confirmation) === normalise(channelTitle!);

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmChannelTitle: confirmation }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not start publishing.");

      if (body.alreadyRunning) {
        toast.info("Already publishing", { description: body.message });
      } else {
        toast.success("Publishing started", {
          description: "You can close this page — it will continue in the background.",
        });
      }
      onOpenChange(false);
      onPublished?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start publishing.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-overlay)]"
          aria-describedby="publish-dialog-description"
        >
          <div className="border-b border-line px-5 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-ink">
              <Rocket className="size-4.5 text-danger-600" aria-hidden="true" />
              Publish to YouTube
            </Dialog.Title>
            <Dialog.Description id="publish-dialog-description" className="mt-1 text-sm text-ink-soft">
              This cannot be undone from here. Check the destination carefully.
            </Dialog.Description>
          </div>

          <div className="max-h-[60vh] overflow-auto px-5 py-4">
            <dl className="divide-y divide-line">
              <DetailRow label="Title">{title || "—"}</DetailRow>
              <DetailRow label="Channel">
                <span className="flex items-center gap-1.5 font-medium">
                  <PlayCircle className="size-4 text-danger-600" aria-hidden="true" />
                  {channelTitle ?? "Not configured"}
                </span>
              </DetailRow>
              <DetailRow label="Playlist">{playlistTitle ?? "None"}</DetailRow>
              <DetailRow label="Visibility">
                {scheduledAt
                  ? `Scheduled — ${formatDateTime(scheduledAt)}`
                  : (privacyStatus ?? "Private").toLowerCase()}
              </DetailRow>
            </dl>

            {scheduledAt && (
              <Alert tone="info" className="mt-4">
                The video will be uploaded now and stay private until the scheduled time, when
                YouTube will publish it automatically.
              </Alert>
            )}

            <div className="mt-4">
              <Field
                label={`Type the channel name to confirm`}
                description={channelTitle ? `Type: ${channelTitle}` : undefined}
                error={error}
                htmlFor="confirm-channel"
              >
                <Input
                  id="confirm-channel"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder={channelTitle ?? ""}
                  autoComplete="off"
                />
              </Field>
            </div>

            {!channelTitle && (
              <Alert tone="danger" icon={AlertTriangle} className="mt-3">
                No YouTube channel is configured, so nothing can be published. An administrator
                needs to connect Google and confirm the channel.
              </Alert>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface-muted/50 px-5 py-4 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={publishing}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="publish"
              onClick={publish}
              loading={publishing}
              loadingText="Starting…"
              disabled={!matches}
            >
              Publish now
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
