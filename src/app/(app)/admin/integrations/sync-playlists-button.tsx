"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Manually refreshes cached playlists. Manual because it costs API quota. */
export function SyncPlaylistsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      const res = await fetch("/api/playlists/sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not refresh playlists.");
      toast.success("Playlists refreshed", {
        description: `${body.added} new, ${body.updated} updated${
          body.disappeared ? `, ${body.disappeared} no longer on YouTube` : ""
        }.`,
      });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh playlists.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={sync} loading={busy} loadingText="Refreshing…">
      <RefreshCw className="size-3.5" aria-hidden="true" />
      Refresh from YouTube
    </Button>
  );
}
