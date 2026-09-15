import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { isPublishingEnabledGlobally } from "@/lib/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  approvalMode: z.enum(["DIRECT_PUBLISH", "APPROVAL_REQUIRED"]).optional(),
  timezone: z.string().max(64).optional(),
  maxVideoBytes: z.number().int().positive().max(1024 ** 4).optional(),
  maxThumbnailBytes: z.number().int().positive().max(10 * 1024 * 1024).optional(),
  setupCompleted: z.boolean().optional(),
});

export const PATCH = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, schema);

  const before = await db.organization.findUniqueOrThrow({
    where: { id: principal.organizationId },
  });

  const updated = await db.organization.update({
    where: { id: principal.organizationId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.approvalMode !== undefined ? { approvalMode: body.approvalMode } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.maxVideoBytes !== undefined ? { maxVideoBytes: BigInt(body.maxVideoBytes) } : {}),
      ...(body.maxThumbnailBytes !== undefined
        ? { maxThumbnailBytes: BigInt(body.maxThumbnailBytes) }
        : {}),
      ...(body.setupCompleted ? { setupCompletedAt: new Date() } : {}),
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SETTINGS_UPDATED,
    entityType: "Organization",
    entityId: principal.organizationId,
    oldValue: { approvalMode: before.approvalMode, name: before.name },
    newValue: body,
    request,
  });

  return ok({
    organization: {
      name: updated.name,
      approvalMode: updated.approvalMode,
      timezone: updated.timezone,
      productionPublishingEnabled: updated.productionPublishingEnabled,
    },
  });
});

const publishingSchema = z.object({
  enabled: z.boolean(),
  /** Typing "ENABLE" makes this a conscious act, not a stray click. */
  confirmation: z.string().optional(),
});

/**
 * The production publishing switch (Sections 9, 40).
 *
 * Turning it ON is gated on: the deployment-level env flag, a connected
 * Google account with sufficient scopes, and a channel an admin has
 * explicitly confirmed. Each precondition returns a specific message so the
 * admin knows exactly what to fix.
 *
 * Turning it OFF is deliberately unconditional — the emergency stop must
 * always work.
 */
export const POST = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, publishingSchema);

  if (!body.enabled) {
    await db.organization.update({
      where: { id: principal.organizationId },
      data: { productionPublishingEnabled: false, productionEnabledAt: null },
    });
    await audit({
      organizationId: principal.organizationId,
      actorId: principal.id,
      action: AuditAction.PRODUCTION_PUBLISHING_DISABLED,
      entityType: "Organization",
      entityId: principal.organizationId,
      request,
    });
    logger.warn("production publishing disabled", {
      organizationId: principal.organizationId,
      actorId: principal.id,
    });
    return ok({ productionPublishingEnabled: false });
  }

  if (body.confirmation?.trim().toUpperCase() !== "ENABLE") {
    throw Errors.validation('Type "ENABLE" to confirm.', "confirmation");
  }

  if (!isPublishingEnabledGlobally()) {
    throw Errors.conflict(
      'This deployment has publishing switched off. Set PUBLISHING_ENABLED="true" in the environment and redeploy before enabling it here.',
    );
  }

  const integration = await db.integrationAccount.findFirst({
    where: { organizationId: principal.organizationId, status: "CONNECTED" },
  });
  if (!integration) {
    throw Errors.conflict("Connect a Google account before enabling production publishing.");
  }

  const channel = await db.youTubeChannel.findFirst({
    where: { organizationId: principal.organizationId, confirmedAt: { not: null } },
  });
  if (!channel) {
    throw Errors.conflict(
      "Confirm which YouTube channel to publish to before enabling production publishing.",
    );
  }

  await db.organization.update({
    where: { id: principal.organizationId },
    data: {
      productionPublishingEnabled: true,
      productionEnabledAt: new Date(),
      productionEnabledById: principal.id,
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.PRODUCTION_PUBLISHING_ENABLED,
    entityType: "Organization",
    entityId: principal.organizationId,
    newValue: { channel: channel.youtubeChannelId },
    request,
  });

  logger.warn("production publishing ENABLED", {
    organizationId: principal.organizationId,
    actorId: principal.id,
    channelId: channel.youtubeChannelId,
  });

  return ok({ productionPublishingEnabled: true, channel: channel.title });
});
