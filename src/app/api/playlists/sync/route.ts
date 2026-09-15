import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { syncPlaylists } from "@/lib/google/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refreshes the cached playlists.
 *
 * Manual rather than automatic: playlists.list costs YouTube quota, and a
 * playlist set changes rarely. Syncing on page render would burn the daily
 * allowance for no benefit (Section 48).
 */
export const POST = route(async (request) => {
  const principal = await requireAdmin();

  const channel = await db.youTubeChannel.findFirst({
    where: { organizationId: principal.organizationId },
    orderBy: { isDefault: "desc" },
  });
  if (!channel) throw Errors.notConfigured("A YouTube channel");

  const result = await syncPlaylists(principal.organizationId, channel.id);

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.PLAYLISTS_SYNCED,
    entityType: "Playlist",
    newValue: result,
    request,
  });

  return ok(result);
});

const updateSchema = z.object({
  playlistId: z.string().min(1),
  isAllowed: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

/** Restricts which playlists contributors may target, and sets the default. */
export const PATCH = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, updateSchema);

  const playlist = await db.playlist.findUnique({ where: { id: body.playlistId } });
  if (!playlist || playlist.organizationId !== principal.organizationId) {
    throw Errors.notFound("playlist");
  }

  // A single-default partial unique index enforces this in the database, so
  // clear the old default first rather than relying on the write order.
  if (body.isDefault) {
    await db.playlist.updateMany({
      where: { organizationId: principal.organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updated = await db.playlist.update({
    where: { id: playlist.id },
    data: {
      ...(body.isAllowed !== undefined ? { isAllowed: body.isAllowed } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      // A playlist cannot be the default if it is not allowed.
      ...(body.isAllowed === false ? { isDefault: false } : {}),
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SETTINGS_UPDATED,
    entityType: "Playlist",
    entityId: playlist.id,
    youtubePlaylistId: playlist.youtubePlaylistId,
    newValue: { isAllowed: updated.isAllowed, isDefault: updated.isDefault },
    request,
  });

  return ok({ isAllowed: updated.isAllowed, isDefault: updated.isDefault });
});
