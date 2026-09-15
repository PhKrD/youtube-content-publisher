import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { safeEqual } from "../crypto";
import { Errors } from "../errors";
import type { GoogleService } from "./scopes";

/**
 * CSRF + PKCE state for the publishing-account OAuth flow.
 *
 * Both matter here:
 *
 *  - `state` stops an attacker completing the flow with *their* Google
 *    account in an admin's session, which would quietly repoint the
 *    organisation's publishing target at an attacker-controlled channel.
 *  - PKCE binds the authorization code to this specific browser, so an
 *    intercepted code (leaked Referer, shared proxy log) cannot be redeemed
 *    elsewhere. Google supports it for web clients and there is no reason not
 *    to use it.
 *
 * The verifier lives in a short-lived, httpOnly, SameSite=Lax cookie. Lax
 * rather than Strict because the cookie must survive the top-level
 * cross-site redirect back from accounts.google.com.
 */

const STATE_COOKIE = "ycp_oauth_state";
const VERIFIER_COOKIE = "ycp_oauth_verifier";
const RETURN_COOKIE = "ycp_oauth_return";
const SERVICE_COOKIE = "ycp_oauth_service";
const TTL_SECONDS = 600; // 10 minutes

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export interface StartedFlow {
  state: string;
  codeChallenge: string;
}

/**
 * Generates state + PKCE and stores the secrets in cookies.
 *
 * `service` says which half of the publishing integration is being connected.
 * It is kept server-side in a cookie rather than round-tripped through Google,
 * so the callback cannot be tricked into filing a Drive grant as a YouTube one.
 */
export async function beginOAuthFlow(
  returnTo = "/admin/integrations",
  service: GoogleService = "youtube",
): Promise<StartedFlow> {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(64));
  const codeChallenge = base64url(createHash("sha256").update(verifier).digest());

  const jar = await cookies();
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TTL_SECONDS,
  };

  jar.set(STATE_COOKIE, state, common);
  jar.set(VERIFIER_COOKIE, verifier, common);
  jar.set(SERVICE_COOKIE, service, common);
  // Only same-origin relative paths, so this cannot become an open redirect.
  jar.set(
    RETURN_COOKIE,
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/admin/integrations",
    common,
  );

  return { state, codeChallenge };
}

export interface VerifiedFlow {
  codeVerifier: string;
  returnTo: string;
  service: GoogleService;
}

/**
 * Validates the returned state and yields the PKCE verifier.
 * Always clears the cookies, so a state value can never be replayed.
 */
export async function completeOAuthFlow(returnedState: string | null): Promise<VerifiedFlow> {
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  const verifier = jar.get(VERIFIER_COOKIE)?.value;
  const returnTo = jar.get(RETURN_COOKIE)?.value ?? "/admin/integrations";
  const rawService = jar.get(SERVICE_COOKIE)?.value;

  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);
  jar.delete(RETURN_COOKIE);
  jar.delete(SERVICE_COOKIE);

  if (!expected || !verifier) {
    throw Errors.validation(
      "That connection attempt has expired. Please start again from the settings page.",
    );
  }
  if (!returnedState || !safeEqual(returnedState, expected)) {
    throw Errors.forbidden("oauth state mismatch");
  }

  const service: GoogleService = rawService === "drive" ? "drive" : "youtube";

  return { codeVerifier: verifier, returnTo, service };
}
