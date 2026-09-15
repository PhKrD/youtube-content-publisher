import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  channelId: z.string().min(1),
  /**
   * The admin must type the channel's exact name. A single checkbox is too
   * easy to tick without reading, and publishing to the wrong channel cannot
   * be undone (Section 9).
   */
  confirmTitle: z.string().min(1),
});

/** Records an administrator's explicit confirmation of the publishing target. */
export const POST = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, schema);

  const channel = await db.youTubeChannel.findUnique({ where: { id: body.channelId } });
  if (!channel || channel.organizationId !== principal.organizationId) {
    throw Errors.notFound("channel");
  }

  const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalise(body.confirmTitle) !== normalise(channel.title)) {
    throw Errors.validation(
      `That does not match the channel name. Type "${channel.title}" exactly to confirm.`,
      "confirmTitle",
    );
  }

  const updated = await db.youTubeChannel.update({
    where: { id: channel.id },
    data: { confirmedAt: new Date(), confirmedById: principal.id, isDefault: true },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.CHANNEL_CONFIRMED,
    entityType: "YouTubeChannel",
    entityId: channel.id,
    newValue: { youtubeChannelId: channel.youtubeChannelId, title: channel.title },
    request,
  });

  logger.info("youtube channel confirmed", {
    organizationId: principal.organizationId,
    channelId: channel.youtubeChannelId,
    actorId: principal.id,
  });

  return ok({ confirmed: true, confirmedAt: updated.confirmedAt });
});

/** Revokes confirmation, which immediately blocks all publishing. */
export const DELETE = route(async (request) => {
  const principal = await requireAdmin();
  const { channelId } = await parseJson(request, z.object({ channelId: z.string().min(1) }));

  const channel = await db.youTubeChannel.findUnique({ where: { id: channelId } });
  if (!channel || channel.organizationId !== principal.organizationId) {
    throw Errors.notFound("channel");
  }

  await db.youTubeChannel.update({
    where: { id: channel.id },
    data: { confirmedAt: null, confirmedById: null },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: "channel.unconfirmed",
    entityType: "YouTubeChannel",
    entityId: channel.id,
    request,
  });

  return ok({ confirmed: false });
});
