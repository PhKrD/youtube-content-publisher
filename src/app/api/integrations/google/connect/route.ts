import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { createOAuthClient } from "@/lib/google/client";
import { PUBLISHING_SCOPES } from "@/lib/google/scopes";
import { beginOAuthFlow } from "@/lib/google/oauth-state";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts the "Connect Google" flow for the publishing account.
 *
 * Admin-only: this grant gives the application the ability to upload to the
 * organisation's YouTube channel, so it must never be initiated by a
 * contributor.
 */
export const GET = route(async (request) => {
  const principal = await requireAdmin();

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/admin/integrations";

  const { state, codeChallenge } = await beginOAuthFlow(returnTo);
  const client = createOAuthClient();

  const consentUrl = client.generateAuthUrl({
    // offline is what yields a refresh token; without it the integration dies
    // in one hour and cannot be repaired unattended.
    access_type: "offline",
    scope: [...PUBLISHING_SCOPES],
    state,
    code_challenge: codeChallenge,
    // google-auth-library's types spell this as an enum; "S256" is the value.
    code_challenge_method: "S256" as never,
    // Force the full consent screen every time. Google omits refresh_token on
    // a silent re-consent, which would leave us unable to refresh.
    prompt: "consent",
    include_granted_scopes: true,
  });

  logger.info("google publishing consent started", {
    organizationId: principal.organizationId,
    actorId: principal.id,
  });

  return NextResponse.redirect(consentUrl);
});
