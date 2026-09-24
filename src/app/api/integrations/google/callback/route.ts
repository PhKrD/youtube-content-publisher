import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit, AuditAction } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { mapGoogleError, toAppError } from "@/lib/errors";
import { createOAuthClient, getIntegrations, storeIntegrationTokens } from "@/lib/google/client";
import { completeOAuthFlow } from "@/lib/google/oauth-state";
import { analyseServiceScopes, SERVICE_LABELS } from "@/lib/google/scopes";
import { fetchMyChannel, syncPlaylists } from "@/lib/google/youtube";
import { ensureFolderTree } from "@/lib/google/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth callback for ONE half of the publishing account.
 *
 * Which half is decided by the server-side flow cookie, not by anything Google
 * echoes back (see lib/google/oauth-state.ts).
 *
 *   1. validate state, exchange the code (PKCE)
 *   2. identify the Google account
 *   3. store tokens, encrypted, filed under that service
 *   4. run that service's setup: YouTube -> read channel (still UNCONFIRMED,
 *      Section 9) and cache playlists; Drive -> create the folder tree
 *
 * Step 4 is best-effort: a failure there must not discard a perfectly good
 * token, or the admin would be stuck in a reconnect loop.
 */
export const GET = route(async (request) => {
  const principal = await requireAdmin();
  const url = new URL(request.url);

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // The admin pressed "Cancel" on Google's consent screen.
  if (error) {
    logger.warn("google consent declined", { error });
    return redirectWith("/admin/integrations", {
      error:
        error === "access_denied"
          ? "Connection cancelled. Nothing was changed."
          : "Google reported a problem with the connection. Please try again.",
    });
  }

  let returnTo = "/admin/integrations";

  try {
    const verified = await completeOAuthFlow(state);
    returnTo = verified.returnTo;

    if (!code) {
      return redirectWith(returnTo, { error: "Google did not return an authorization code." });
    }

    // ---- 1. exchange ----
    const client = createOAuthClient();
    const { tokens } = await client.getToken({
      code,
      codeVerifier: verified.codeVerifier,
    });

    if (!tokens.access_token) {
      return redirectWith(returnTo, { error: "Google did not return an access token." });
    }

    // ---- 2. confirm which account consented ----
    client.setCredentials(tokens);
    const idToken = tokens.id_token
      ? await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: env.GOOGLE_PUBLISHING_CLIENT_ID,
        })
      : null;
    const payload = idToken?.getPayload();

    if (!payload?.sub || !payload.email) {
      return redirectWith(returnTo, {
        error: "Google did not identify the account. Please try connecting again.",
      });
    }

    // ---- 3. check we got everything we asked for ----
    const scopeReport = analyseServiceScopes(verified.service, tokens.scope);

    // ---- 4. store (encrypted) ----
    const integration = await storeIntegrationTokens({
      organizationId: principal.organizationId,
      service: verified.service,
      googleUserId: payload.sub,
      email: payload.email,
      displayName: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? "",
      connectedById: principal.id,
    });

    await audit({
      organizationId: principal.organizationId,
      actorId: principal.id,
      action: AuditAction.INTEGRATION_CONNECTED,
      entityType: "IntegrationAccount",
      entityId: integration.id,
      newValue: { email: payload.email, service: verified.service, scopes: scopeReport.granted },
      request,
    });

    if (!scopeReport.ok) {
      return redirectWith(returnTo, {
        error: `Connected ${SERVICE_LABELS[verified.service]}, but some permissions were not granted. Please reconnect and accept every permission Google asks for.`,
      });
    }

    // ---- 5. per-service setup (best-effort) ----
    let channelWarning: string | null = null;

    if (verified.service === "drive") {
      let driveWarning: string | null = null;
      try {
        await ensureFolderTree(principal.organizationId);
      } catch (e) {
        driveWarning = mapGoogleError(e, "drive").userMessage;
        logger.warn("drive folder setup deferred", { error: toAppError(e).detail });
      }

      return redirectWith(returnTo, {
        connected: "drive",
        ...(driveWarning === null ? {} : { warning: driveWarning }),
        ...(await nextStepParam(principal.organizationId)),
      });
    }

    try {
      const channel = await fetchMyChannel(principal.organizationId);

      const saved = await db.youTubeChannel.upsert({
        where: {
          organizationId_youtubeChannelId: {
            organizationId: principal.organizationId,
            youtubeChannelId: channel.channelId,
          },
        },
        create: {
          organizationId: principal.organizationId,
          integrationAccountId: integration.id,
          youtubeChannelId: channel.channelId,
          title: channel.title,
          description: channel.description,
          customUrl: channel.customUrl,
          thumbnailUrl: channel.thumbnailUrl,
          uploadsPlaylistId: channel.uploadsPlaylistId,
          subscriberCount: null,
          videoCount: null,
          // NOT confirmed. An admin must explicitly tick the box before this
          // channel can ever be published to (Section 9).
          isDefault: true,
        },
        update: {
          integrationAccountId: integration.id,
          title: channel.title,
          description: channel.description,
          customUrl: channel.customUrl,
          thumbnailUrl: channel.thumbnailUrl,
          uploadsPlaylistId: channel.uploadsPlaylistId,
          subscriberCount: null,
          videoCount: null,
          syncedAt: new Date(),
        },
      });

      // Drive setup deliberately does NOT happen here — it needs the Drive
      // grant, which is a separate consent flow.
      await syncPlaylists(principal.organizationId, saved.id).catch((e) => {
        logger.warn("playlist sync deferred", { error: toAppError(e).detail });
      });
    } catch (e) {
      const mapped = mapGoogleError(e, "youtube");
      channelWarning = mapped.userMessage;
      logger.warn("channel discovery failed after connect", { detail: mapped.detail });
    }

    return redirectWith(returnTo, {
      connected: "youtube",
      ...(channelWarning ? { warning: channelWarning } : {}),
      ...(await nextStepParam(principal.organizationId)),
    });
  } catch (e) {
    const appError = toAppError(e);
    logger.error("google callback failed", { code: appError.code, detail: appError.detail });
    return redirectWith(returnTo, { error: appError.userMessage });
  }

  function redirectWith(path: string, params: Record<string, string>) {
    const target = new URL(path, env.AUTH_URL);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    return NextResponse.redirect(target);
  }

  /**
   * Tells the settings page which half is still outstanding, so it can prompt
   * for the second consent instead of looking finished after the first.
   */
  async function nextStepParam(organizationId: string): Promise<Record<string, string>> {
    const { youtube, drive } = await getIntegrations(organizationId);
    if (!youtube) return { connectNext: "youtube" };
    if (!drive) return { connectNext: "drive" };
    return {};
  }
});
