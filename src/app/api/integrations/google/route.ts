import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { disconnectIntegration, getIntegration } from "@/lib/google/client";
import { analyseScopes, describeScope } from "@/lib/google/scopes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current integration status for the settings page. Never returns tokens. */
export const GET = route(async () => {
  const principal = await requireAdmin();
  const integration = await getIntegration(principal.organizationId);

  if (!integration) {
    return ok({ connected: false });
  }

  const scopes = analyseScopes(integration.scopes);
  const channels = await db.youTubeChannel.findMany({
    where: { organizationId: principal.organizationId },
    orderBy: { isDefault: "desc" },
  });

  return ok({
    connected: true,
    // Deliberately no token material of any kind in this response.
    integration: {
      id: integration.id,
      email: integration.email,
      displayName: integration.displayName,
      avatarUrl: integration.avatarUrl,
      status: integration.status,
      connectedAt: integration.connectedAt,
      lastRefreshAt: integration.lastRefreshAt,
      lastError: integration.lastError,
      hasRefreshToken: Boolean(integration.refreshTokenEnc),
      tokenExpiresAt: integration.accessTokenExpiresAt,
    },
    scopes: {
      ok: scopes.ok,
      capabilities: scopes.capabilities,
      granted: scopes.granted.map((s) => ({ scope: s, label: describeScope(s) })),
      missing: scopes.missing.map((s) => ({ scope: s, label: describeScope(s) })),
    },
    channels: channels.map((c) => ({
      id: c.id,
      youtubeChannelId: c.youtubeChannelId,
      title: c.title,
      customUrl: c.customUrl,
      thumbnailUrl: c.thumbnailUrl,
      subscriberCount: c.subscriberCount ? Number(c.subscriberCount) : null,
      videoCount: c.videoCount ? Number(c.videoCount) : null,
      confirmedAt: c.confirmedAt,
      isDefault: c.isDefault,
    })),
  });
});

const disconnectSchema = z.object({
  /** Typing the account email is required, to make this hard to do by accident. */
  confirmEmail: z.string().min(1),
});

/**
 * Disconnects the publishing account.
 *
 * Refuses while anything is mid-publish: pulling the token out from under a
 * running upload would strand a half-uploaded video on YouTube.
 */
export const DELETE = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, disconnectSchema);

  const integration = await getIntegration(principal.organizationId);
  if (!integration) throw Errors.notFound("Google connection");

  if (body.confirmEmail.trim().toLowerCase() !== integration.email.toLowerCase()) {
    throw Errors.validation(
      "The email address did not match the connected account.",
      "confirmEmail",
    );
  }

  const active = await db.publishingJob.count({
    where: {
      organizationId: principal.organizationId,
      state: { in: ["QUEUED", "RUNNING", "WAITING_RETRY"] },
    },
  });
  if (active > 0) {
    throw Errors.conflict(
      `${active} item${active === 1 ? " is" : "s are"} currently publishing. Wait for them to finish before disconnecting.`,
    );
  }

  await disconnectIntegration(integration.id);

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.INTEGRATION_DISCONNECTED,
    entityType: "IntegrationAccount",
    entityId: integration.id,
    oldValue: { email: integration.email },
    request,
  });

  return ok({ disconnected: true });
});
