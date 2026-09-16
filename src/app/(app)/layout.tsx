import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPrincipal } from "@/lib/authz";
import { getUnreadCount } from "@/lib/notifications";
import { CONSENT_PATH, hasAcceptedCurrentPolicy } from "@/lib/policy-consent";
import { AppShell } from "@/components/layout/app-shell";
import { Role, SubmissionStatus } from "@/generated/prisma";

/**
 * Authenticated shell.
 *
 * Auth is enforced here (and again in every route handler) rather than in
 * middleware. Next.js middleware runs on the edge, where the Prisma adapter
 * cannot open a database socket — and more importantly, checking at the point
 * of data access cannot be bypassed by a route that forgets to opt in.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/signin");

  // YouTube Developer Policy III.A.2: no access to features before the user has
  // agreed to the privacy policy. Enforced here so no page can forget it.
  const consent = await db.user.findUnique({
    where: { id: principal.id },
    select: { policyAcceptedAt: true, policyAcceptedVersion: true },
  });
  if (!consent || !hasAcceptedCurrentPolicy(consent)) redirect(CONSENT_PATH);

  const canReview = principal.role === Role.ADMIN || principal.role === Role.REVIEWER;

  const [unreadCount, pendingReviews, org] = await Promise.all([
    getUnreadCount(principal.id),
    canReview
      ? db.submission.count({
          where: {
            organizationId: principal.organizationId,
            status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
          },
        })
      : Promise.resolve(0),
    db.organization.findUnique({
      where: { id: principal.organizationId },
      select: { productionPublishingEnabled: true },
    }),
  ]);

  return (
    <AppShell
      user={{
        name: principal.name,
        email: principal.email,
        image: principal.image,
        role: principal.role,
      }}
      unreadCount={unreadCount}
      pendingReviews={pendingReviews}
      isDevelopment={env.APP_ENV !== "production"}
      productionPublishingEnabled={Boolean(org?.productionPublishingEnabled)}
    >
      {children}
    </AppShell>
  );
}
