"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RemoveSubmissionButton({
  submissionId,
  published,
  title,
}: {
  submissionId: string;
  published: boolean;
  title: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/submissions/${submissionId}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not remove this content.");
      toast.success(body.archived ? "Published content moved to Archived." : "Content deleted.");
      setConfirming(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove this content.");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-danger-200 bg-danger-50 p-1" onClick={(event) => event.preventDefault()}>
        <span className="hidden max-w-48 truncate px-1 text-[11px] font-medium text-danger-700 sm:block">
          {published ? "Move to Archived?" : `Delete “${title}”?`}
        </span>
        <Button size="sm" variant="danger" loading={busy} loadingText="Removing…" onClick={() => void remove()}>
          Confirm
        </Button>
        <button
          type="button"
          aria-label="Cancel"
          disabled={busy}
          className="rounded-md p-1.5 text-danger-700 hover:bg-danger-200/60 disabled:opacity-50"
          onClick={() => setConfirming(false)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={published ? `Archive ${title}` : `Delete ${title}`}
      title={published ? "Remove from recent content and move to Archived" : "Delete content"}
      className="shrink-0 rounded-lg p-2 text-ink-faint transition-colors hover:bg-danger-50 hover:text-danger-600"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </button>
  );
}
