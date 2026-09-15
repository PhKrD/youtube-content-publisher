"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublishDialog } from "./publish-dialog";

/** Opens the publish confirmation. Split out so the detail page stays a Server Component. */
export function PublishButton({
  submissionId,
  channelTitle,
  playlistTitle,
  title,
  scheduledAt,
  privacyStatus,
  disabled,
}: {
  submissionId: string;
  channelTitle: string | null;
  playlistTitle: string | null;
  title: string;
  scheduledAt?: string | null;
  privacyStatus?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="publish" full disabled={disabled} onClick={() => setOpen(true)}>
        <Rocket className="size-4" aria-hidden="true" />
        Publish to YouTube
      </Button>

      <PublishDialog
        open={open}
        onOpenChange={setOpen}
        submissionId={submissionId}
        channelTitle={channelTitle}
        playlistTitle={playlistTitle}
        title={title}
        scheduledAt={scheduledAt}
        privacyStatus={privacyStatus}
        onPublished={() => router.refresh()}
      />
    </>
  );
}
