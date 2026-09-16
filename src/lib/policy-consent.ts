/**
 * Privacy-policy consent.
 *
 * YouTube API Services Developer Policy III.A.2 requires an API client to
 * "require users to agree to a privacy policy before users can access the API
 * Client's features and functionality". A footer link is not enough — consent
 * has to be recorded, so it is stored per user against the policy version they
 * actually saw.
 *
 * Bump this whenever the privacy policy changes materially. Everyone is then
 * re-prompted, because their recorded version no longer matches.
 */
export const CURRENT_POLICY_VERSION = "2026-09-16";

/** Where an un-consented user is sent. */
export const CONSENT_PATH = "/accept-terms";

export function hasAcceptedCurrentPolicy(user: {
  policyAcceptedAt: Date | null;
  policyAcceptedVersion: string | null;
}): boolean {
  return (
    user.policyAcceptedAt !== null &&
    user.policyAcceptedVersion === CURRENT_POLICY_VERSION
  );
}
