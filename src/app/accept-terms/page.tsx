import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { db } from "@/lib/db";
import { getPrincipal } from "@/lib/authz";
import { hasAcceptedCurrentPolicy } from "@/lib/policy-consent";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Before you continue" };

/**
 * Consent gate. Deliberately outside the `(app)` route group: the app layout
 * redirects un-consented users here, so living inside that layout would loop.
 */
export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/signin");

  const user = await db.user.findUnique({
    where: { id: principal.id },
    select: { policyAcceptedAt: true, policyAcceptedVersion: true },
  });

  const { returnTo } = await searchParams;
  // Only ever bounce back to a path on this site, never to an absolute URL an
  // attacker could put in the query string.
  const safeReturnTo =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : "/dashboard";

  if (user && hasAcceptedCurrentPolicy(user)) redirect(safeReturnTo);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-600 shadow-[var(--shadow-raised)]">
            <ScrollText className="size-7 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Before you continue
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {user?.policyAcceptedAt
              ? "Our privacy policy has changed since you last agreed to it."
              : "Please review how this app handles your information."}
          </p>
        </div>

        <div className="bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6">
          <div className="space-y-3 text-sm leading-relaxed text-ink-soft">
            <p>
              This app uses <span className="font-medium text-ink">YouTube API
              Services</span> to publish videos, and Google Drive to store the media
              files.
            </p>
            <p>
              Read the{" "}
              <Link href="/privacy" className="underline" target="_blank">
                Privacy Policy
              </Link>{" "}
              and the{" "}
              <Link href="/terms" className="underline" target="_blank">
                Terms of Service
              </Link>
              . Your data is also handled by Google under the{" "}
              <a
                className="underline"
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Google Privacy Policy
              </a>
              , and use of this app is subject to the{" "}
              <a
                className="underline"
                href="https://www.youtube.com/t/terms"
                target="_blank"
                rel="noreferrer"
              >
                YouTube Terms of Service
              </a>
              .
            </p>
          </div>

          <AcceptForm returnTo={safeReturnTo} />
        </div>
      </div>
    </main>
  );
}
