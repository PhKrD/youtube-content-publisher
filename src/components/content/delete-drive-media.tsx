"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HardDrive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DeleteDriveMedia({ submissionId, fileCount }: { submissionId: string; fileCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/submissions/${submissionId}/drive-media`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not delete the Drive files.");
      if (body.failed?.length) {
        toast.error(`${body.deleted} deleted, but ${body.failed.length} could not be deleted. Please try again.`);
      } else {
        toast.success(`${body.deleted} Drive file${body.deleted === 1 ? "" : "s"} deleted.`);
      }
      setConfirming(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the Drive files.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4 text-ink-faint" aria-hidden="true" />
          Drive storage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!confirming ? (
          <>
            <p className="text-xs text-ink-soft">
              The YouTube video is safe. You can remove the uploaded video and images from Google Drive to free space.
            </p>
            <Button size="sm" variant="secondary" full onClick={() => setConfirming(true)}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              Delete files from Drive
            </Button>
          </>
        ) : (
          <div className="space-y-3 rounded-lg border border-danger-200 bg-danger-50 p-3">
            <p className="text-sm font-medium text-danger-700">Permanently delete {fileCount} file{fileCount === 1 ? "" : "s"}?</p>
            <p className="text-xs text-danger-700">
              This deletes the video, thumbnail and post images from Drive. It does not delete the published YouTube video. Download any post images you still need first.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" loading={busy} loadingText="Deleting…" onClick={() => void remove()}>
                Delete permanently
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
