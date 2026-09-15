import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit, AuditAction } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { mapGoogleError, toAppError } from "@/lib/errors";
import { createOAuthClient, storeIntegrationTokens } from "@/lib/google/client";
import { completeOAuthFlow } from "@/lib/google/oauth-state";
import { analyseScopes } from "@/lib/google/scopes";
import { fetchMyChannel, syncPlaylists } from "@/lib/google/youtube";
import { ensureFolderTree } from "@/lib/google/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth callback for the publishing account.
 *
 * Does the whole connection in one pass so the admin lands on a page that
 * already shows the channel and playlists rather than a bare "connected":
 *   1. validate state, exchange the code (PKCE)
 *   2. identify the Google account
 *   3. store tokens, encrypted
 *   4. read the YouTube channel (still UNCONFIRMED — Section 9)
 *   5. create the Drive folder tree
 *   6. cache the playlists
 *
 * Steps 4–6 are best-effort: a failure there must not discard a perfectly
 * good token, or the admin would be stuck in a reconnect loop.
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
      ? await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID })
      : null;
    const payload = idToken?.getPayload();

    if (!payload?.sub || !payload.email) {
      return redirectWith(returnTo, {
        error: "Google did not identify the account. Please try connecting again.",
      });
    }

    // ---- 3. check we got everything we asked for ----
    const scopeReport = analyseScopes(tokens.scope);

    // ---- 4. store (encrypted) ----
    const integration = await storeIntegrationTokens({
      organizationId: principal.organizationId,
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
      newValue: { email: payload.email, scopes: scopeReport.granted },
      request,
    });

    if (!scopeReport.ok) {
      return redirectWith(returnTo, {
        error:
          "Connected, but some permissions were not granted. Please reconnect and accept every permission Google asks for.",
      });
    }

    // ---- 5. channel, folders, playlists (best-effort) ----
    let channelWarning: string | null = null;
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
          subscriberCount: channel.subscriberCount ? BigInt(channel.subscriberCount) : null,
          videoCount: channel.videoCount ? BigInt(channel.videoCount) : null,
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
          subscriberCount: channel.subscriberCount ? BigInt(channel.subscriberCount) : null,
          videoCount: channel.videoCount ? BigInt(channel.videoCount) : null,
          syncedAt: new Date(),
        },
      });

      await ensureFolderTree(principal.organizationId).catch((e) => {
        logger.warn("drive folder setup deferred", { error: toAppError(e).detail });
      });

      await syncPlaylists(principal.organizationId, saved.id).catch((e) => {
        logger.warn("playlist sync deferred", { error: toAppError(e).detail });
      });
    } catch (e) {
      const mapped = mapGoogleError(e, "youtube");
      channelWarning = mapped.userMessage;
      logger.warn("channel discovery failed after connect", { detail: mapped.detail });
    }

    return redirectWith(returnTo, {
      connected: "1",
      ...(channelWarning ? { warning: channelWarning } : {}),
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
});
