"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function PlaylistRow({
  playlist,
}: {
  playlist: {
    id: string;
    title: string;
    youtubePlaylistId: string;
    itemCount: number;
    privacyStatus: string | null;
    isAllowed: boolean;
    isDefault: boolean;
    submissionCount: number;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/playlists/sync", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: playlist.id, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not update the playlist.");
      toast.success("Updated");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the playlist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
          {playlist.title}
          {playlist.isDefault && <Badge tone="brand">Default</Badge>}
          {!playlist.isAllowed && <Badge tone="neutral">Unavailable</Badge>}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">
          {playlist.youtubePlaylistId}
        </p>
        <p className="text-xs text-ink-soft">
          {playlist.itemCount} video{playlist.itemCount === 1 ? "" : "s"} on YouTube
          {playlist.privacyStatus ? ` · ${playlist.privacyStatus}` : ""}
          {playlist.submissionCount > 0
            ? ` · ${playlist.submissionCount} submission${playlist.submissionCount === 1 ? "" : "s"} here`
            : ""}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {playlist.isAllowed && !playlist.isDefault && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => patch({ isDefault: true })}
          >
            <Star className="size-3.5" aria-hidden="true" />
            Make default
          </Button>
        )}
        <Button
          size="sm"
          variant={playlist.isAllowed ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => patch({ isAllowed: !playlist.isAllowed })}
        >
          {playlist.isAllowed ? "Hide from contributors" : "Make available"}
        </Button>
      </div>
    </li>
  );
}
