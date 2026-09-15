import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { createOAuthClient } from "@/lib/google/client";
import { scopesForService, type GoogleService } from "@/lib/google/scopes";
import { beginOAuthFlow } from "@/lib/google/oauth-state";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts the "Connect Google" flow for ONE half of the publishing account.
 *
 * `?service=youtube` (default) or `?service=drive`. The two halves must be
 * authorised in separate flows because Google rejects any single request that
 * mixes Drive and YouTube scopes — see lib/google/scopes.ts.
 *
 * Admin-only: this grant gives the application the ability to upload to the
 * organisation's YouTube channel, so it must never be initiated by a
 * contributor.
 */
export const GET = route(async (request) => {
  const principal = await requireAdmin();

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/admin/integrations";
  const service: GoogleService = url.searchParams.get("service") === "drive" ? "drive" : "youtube";

  const { state, codeChallenge } = await beginOAuthFlow(returnTo, service);
  const client = createOAuthClient();

  const consentUrl = client.generateAuthUrl({
    // offline is what yields a refresh token; without it the integration dies
    // in one hour and cannot be repaired unattended.
    access_type: "offline",
    scope: scopesForService(service),
    state,
    code_challenge: codeChallenge,
    // google-auth-library's types spell this as an enum; "S256" is the value.
    code_challenge_method: "S256" as never,
    // Force the full consent screen every time. Google omits refresh_token on
    // a silent re-consent, which would leave us unable to refresh.
    prompt: "consent",
    // Deliberately NOT include_granted_scopes: it would make Google add the
    // other half's previously-granted scopes to this request, recreating the
    // forbidden Drive+YouTube combination and failing with invalid_request.
    include_granted_scopes: false,
  });

  logger.info("google publishing consent started", {
    organizationId: principal.organizationId,
    actorId: principal.id,
    service,
  });

  return NextResponse.redirect(consentUrl);
});
