-- YouTube Developer Policy III.A.2: users must agree to the privacy policy
-- before they can access the app's features. Nullable so existing users are
-- re-prompted on their next visit rather than being silently treated as having
-- consented to something they never saw.
ALTER TABLE "User" ADD COLUMN "policyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "policyAcceptedVersion" TEXT;
