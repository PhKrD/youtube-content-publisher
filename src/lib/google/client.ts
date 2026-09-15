import { OAuth2Client } from "google-auth-library";
import { db } from "../db";
import { env, integrationCallbackUrl, isGoogleOAuthConfigured } from "../env";
import { decryptSecret, encryptOptional, encryptSecret } from "../crypto";
import { Errors, mapGoogleError } from "../errors";
import { logger } from "../logger";
import { analyseScopes } from "./scopes";
import { IntegrationStatus, type IntegrationAccount } from "@/generated/prisma";

/**
 * Google OAuth token lifecycle for the publishing account.
 *
 * Responsibilities:
 *  - never store a token in plaintext (see ../crypto)
 *  - never hand a token to the browser
 *  - refresh proactively, before expiry, rather than reacting to a 401 in the
 *    middle of a multi-hundred-megabyte upload
 *  - recognise a permanently dead grant and mark the integration
 *    NEEDS_RECONSENT so the UI can ask an admin to reconnect, instead of
 *    retrying forever
 */

/** Refresh this long before actual expiry, so a long operation cannot age out mid-flight. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function assertGoogleConfigured(): void {
  if (!isGoogleOAuthConfigured()) {
    throw Errors.notConfigured("Google OAuth (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }
}

export function assertGooglePublishingConfigured(): void {
  if (!env.GOOGLE_PUBLISHING_CLIENT_ID || !env.GOOGLE_PUBLISHING_CLIENT_SECRET) {
    throw Errors.notConfigured("Google Publishing OAuth (GOOGLE_PUBLISHING_CLIENT_ID / GOOGLE_PUBLISHING_CLIENT_SECRET)");
  }
}

/** A bare client, used for building consent URLs and exchanging codes. */
export function createOAuthClient(redirectUri = integrationCallbackUrl()): OAuth2Client {
  assertGooglePublishingConfigured();
  return new OAuth2Client({
    clientId: env.GOOGLE_PUBLISHING_CLIENT_ID,
    clientSecret: env.GOOGLE_PUBLISHING_CLIENT_SECRET,
    redirectUri,
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface StoreTokensInput {
  organizationId: string;
  googleUserId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  accessToken: string;
  /** Google only returns this on first consent (or with prompt=consent). */
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes: string;
  connectedById?: string | null;
}

/**
 * Upserts the integration, encrypting both tokens.
 *
 * Note the refresh-token handling: Google omits `refresh_token` when the user
 * re-consents to an already-authorised app. Overwriting the stored value with
 * null in that case would silently destroy our ability to refresh, and the
 * integration would appear fine until the access token expired an hour later.
 * So a missing refresh token preserves the existing one.
 */
export async function storeIntegrationTokens(input: StoreTokensInput): Promise<IntegrationAccount> {
  const existing = await db.integrationAccount.findUnique({
    where: {
      organizationId_provider_googleUserId: {
        organizationId: input.organizationId,
        provider: "google",
        googleUserId: input.googleUserId,
      },
    },
    select: { id: true, refreshTokenEnc: true },
  });

  const refreshTokenEnc = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : (existing?.refreshTokenEnc ?? null);

  if (!refreshTokenEnc) {
    // Without a refresh token the integration dies in one hour and cannot be
    // repaired without user interaction. Fail loudly at connect time.
    throw Errors.conflict(
      "Google did not return a refresh token. Disconnect the app at myaccount.google.com/permissions and connect again so the consent screen is shown in full.",
      "no refresh_token in token response",
    );
  }

  const data = {
    email: input.email,
    displayName: input.displayName ?? null,
    avatarUrl: input.avatarUrl ?? null,
    accessTokenEnc: encryptSecret(input.accessToken),
    refreshTokenEnc,
    accessTokenExpiresAt: input.expiresAt ?? null,
    scopes: input.scopes,
    status: IntegrationStatus.CONNECTED,
    lastError: null,
    lastErrorAt: null,
    lastRefreshAt: new Date(),
    lastCheckedAt: new Date(),
    connectedById: input.connectedById ?? null,
  };

  return db.integrationAccount.upsert({
    where: {
      organizationId_provider_googleUserId: {
        organizationId: input.organizationId,
        provider: "google",
        googleUserId: input.googleUserId,
      },
    },
    create: {
      organizationId: input.organizationId,
      provider: "google",
      googleUserId: input.googleUserId,
      ...data,
    },
    update: data,
  });
}

/** The organization's active publishing integration, if any. */
export async function getIntegration(organizationId: string): Promise<IntegrationAccount | null> {
  return db.integrationAccount.findFirst({
    where: { organizationId, provider: "google" },
    orderBy: { connectedAt: "desc" },
  });
}

async function markNeedsReconsent(id: string, detail: string): Promise<void> {
  await db.integrationAccount.update({
    where: { id },
    data: {
      status: IntegrationStatus.NEEDS_RECONSENT,
      lastError: detail.slice(0, 1000),
      lastErrorAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Authorised client
// ---------------------------------------------------------------------------

export interface AuthorizedGoogle {
  client: OAuth2Client;
  integration: IntegrationAccount;
  /** Current access token — for hand-rolled fetch calls (resumable uploads). */
  accessToken: string;
}

/**
 * Returns a ready-to-use OAuth2 client for the organization, refreshing the
 * access token first if it is missing, expired, or about to expire.
 *
 * Throws a terminal AppError when an administrator must reconnect — callers
 * should surface that rather than retry.
 */
export async function getAuthorizedClient(organizationId: string): Promise<AuthorizedGoogle> {
  assertGoogleConfigured();

  const integration = await getIntegration(organizationId);
  if (!integration) throw Errors.googleNotConnected();

  if (integration.status === IntegrationStatus.REVOKED) {
    throw Errors.googleReauthRequired("integration previously marked REVOKED");
  }

  const scopeReport = analyseScopes(integration.scopes);
  if (!scopeReport.ok) {
    throw Errors.insufficientScope(`missing scopes: ${scopeReport.missing.join(", ")}`);
  }

  const client = createOAuthClient();

  let accessToken: string;
  try {
    accessToken = decryptSecret(integration.accessTokenEnc);
  } catch (e) {
    // Almost always a changed TOKEN_ENCRYPTION_KEY.
    await markNeedsReconsent(integration.id, e instanceof Error ? e.message : String(e));
    throw Errors.googleReauthRequired("stored access token could not be decrypted");
  }

  const refreshToken = integration.refreshTokenEnc
    ? decryptSecret(integration.refreshTokenEnc)
    : null;

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken ?? undefined,
    expiry_date: integration.accessTokenExpiresAt?.getTime(),
  });

  const expiresAt = integration.accessTokenExpiresAt?.getTime() ?? 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < REFRESH_SKEW_MS;

  if (needsRefresh) {
    if (!refreshToken) {
      await markNeedsReconsent(integration.id, "no refresh token stored");
      throw Errors.googleReauthRequired("no refresh token stored");
    }
    const refreshed = await refreshAccessToken(client, integration);
    return { client, integration: refreshed.integration, accessToken: refreshed.accessToken };
  }

  return { client, integration, accessToken };
}

/**
 * Performs the refresh and persists the result.
 *
 * Two workers can reach here at the same time. That is harmless: Google
 * accepts concurrent refreshes and both receive usable access tokens, so the
 * last write simply wins. Serialising with a lock would add failure modes for
 * no benefit.
 */
async function refreshAccessToken(
  client: OAuth2Client,
  integration: IntegrationAccount,
): Promise<{ integration: IntegrationAccount; accessToken: string }> {
  try {
    const { credentials } = await client.refreshAccessToken();

    if (!credentials.access_token) {
      throw Errors.googleReauthRequired("refresh returned no access token");
    }

    const updated = await db.integrationAccount.update({
      where: { id: integration.id },
      data: {
        accessTokenEnc: encryptSecret(credentials.access_token),
        // Google occasionally rotates the refresh token; persist the new one
        // when present, keep the old one otherwise.
        ...(credentials.refresh_token
          ? { refreshTokenEnc: encryptOptional(credentials.refresh_token) }
          : {}),
        accessTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        status: IntegrationStatus.CONNECTED,
        lastRefreshAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
    });

    client.setCredentials(credentials);
    logger.debug("google access token refreshed", { integrationId: integration.id });

    return { integration: updated, accessToken: credentials.access_token };
  } catch (err) {
    const mapped = mapGoogleError(err, "oauth");
    if (mapped.code === "GOOGLE_REAUTH_REQUIRED" || mapped.terminal) {
      await markNeedsReconsent(integration.id, mapped.detail ?? mapped.message);
    }
    throw mapped;
  }
}

/**
 * Revokes the grant at Google and deletes the stored tokens.
 * Best-effort at the remote end: if Google rejects the revoke (already
 * revoked, network down) we still remove our copy, because leaving an
 * undecryptable or dead token behind is worse.
 */
export async function disconnectIntegration(integrationId: string): Promise<void> {
  const integration = await db.integrationAccount.findUnique({ where: { id: integrationId } });
  if (!integration) return;

  try {
    const client = createOAuthClient();
    const token = integration.refreshTokenEnc
      ? decryptSecret(integration.refreshTokenEnc)
      : decryptSecret(integration.accessTokenEnc);
    await client.revokeToken(token);
    logger.info("google grant revoked", { integrationId });
  } catch (e) {
    logger.warn("google revoke failed; removing local tokens anyway", {
      integrationId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Cascades to YouTubeChannel and therefore Playlist.
  await db.integrationAccount.delete({ where: { id: integrationId } });
}

/**
 * Cheap liveness probe for the health page. Does not consume YouTube quota —
 * it only exercises the token endpoint.
 */
export async function checkIntegrationHealth(
  organizationId: string,
): Promise<{ ok: boolean; status: IntegrationStatus | "NOT_CONNECTED"; message: string }> {
  const integration = await getIntegration(organizationId);
  if (!integration) {
    return { ok: false, status: "NOT_CONNECTED", message: "No Google account connected." };
  }
  try {
    await getAuthorizedClient(organizationId);
    await db.integrationAccount.update({
      where: { id: integration.id },
      data: { lastCheckedAt: new Date() },
    });
    return { ok: true, status: IntegrationStatus.CONNECTED, message: "Connected." };
  } catch (e) {
    const mapped = mapGoogleError(e, "oauth");
    return {
      ok: false,
      status: IntegrationStatus.NEEDS_RECONSENT,
      message: mapped.userMessage,
    };
  }
}
