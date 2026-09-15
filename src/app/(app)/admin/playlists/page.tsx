import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ListVideo } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader } from "@/components/ui/misc";
import { relativeTime } from "@/lib/utils";
import { SyncPlaylistsButton } from "../integrations/sync-playlists-button";
import { PlaylistRow } from "./playlist-row";

export const metadata: Metadata = { title: "Playlists" };

export default async function PlaylistsPage() {
  const principal = await requireAdminPage();

  const playlists = await db.playlist.findMany({
    where: { organizationId: principal.organizationId },
    orderBy: [{ isDefault: "desc" }, { isAllowed: "desc" }, { title: "asc" }],
    include: { _count: { select: { submissions: true } } },
  });

  return (
    <>
      <Link
        href="/admin"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>

      <PageHeader
        title="Playlists"
        description="Choose which playlists contributors may file content into."
        actions={<SyncPlaylistsButton />}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {playlists.length} playlist{playlists.length === 1 ? "" : "s"} cached
          </CardTitle>
          <p className="mt-1 text-xs text-ink-soft">
            {playlists[0]?.syncedAt
              ? `Last refreshed ${relativeTime(playlists[0].syncedAt)}.`
              : "Not yet refreshed."}{" "}
            Cached on purpose — listing playlists costs YouTube API quota.
          </p>
        </CardHeader>

        {playlists.length === 0 ? (
          <EmptyState
            icon={ListVideo}
            title="No playlists yet"
            description="Connect Google and refresh from YouTube to load the channel's playlists."
          />
        ) : (
          <ul className="divide-y divide-line">
            {playlists.map((p) => (
              <PlaylistRow
                key={p.id}
                playlist={{
                  id: p.id,
                  title: p.title,
                  youtubePlaylistId: p.youtubePlaylistId,
                  itemCount: p.itemCount,
                  privacyStatus: p.privacyStatus,
                  isAllowed: p.isAllowed,
                  isDefault: p.isDefault,
                  submissionCount: p._count.submissions,
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      <Alert tone="info" className="mt-4">
        A playlist that has been deleted on YouTube is marked unavailable rather than removed, so
        older submissions keep a readable record of where they were filed.
      </Alert>
    </>
  );
}
