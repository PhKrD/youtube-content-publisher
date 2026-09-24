import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { getPrincipal } from "@/lib/authz";
import { BrandMark } from "@/components/brand-mark";
import { isGoogleOAuthConfigured } from "@/lib/env";
import { Alert } from "@/components/ui/misc";
import { SignInButton } from "./sign-in-button";

export const metadata: Metadata = { title: "Sign in" };

/** Auth.js error codes mapped to something a human can act on. */
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That Google account is not allowed to sign in. Access is by invitation only — ask an administrator to invite your email address.",
  Configuration:
    "Sign-in is not configured correctly. An administrator needs to check the Google OAuth settings.",
  Verification: "That sign-in link has expired. Please try again.",
  OAuthAccountNotLinked:
    "This email address is already registered using a different sign-in method.",
  OAuthCallbackError: "Google could not complete the sign-in. Please try again.",
  Default: "Sign-in could not be completed. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const principal = await getPrincipal();
  if (principal) redirect("/dashboard");

  const { error, callbackUrl } = await searchParams;
  const configured = isGoogleOAuthConfigured();
  const message = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default) : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto mb-4 size-12 rounded-xl shadow-[var(--shadow-raised)]" />
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Channel Publisher
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            Sign in to prepare and publish content.
          </p>
        </div>

        <div className="bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6">
          {message && (
            <Alert tone="danger" icon={AlertTriangle} className="mb-5">
              {message}
            </Alert>
          )}

          {!configured ? (
            <Alert tone="warn" title="Not configured yet" icon={AlertTriangle}>
              Google sign-in has not been set up. An administrator must set{" "}
              <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code>. See{" "}
              <span className="font-medium">SETUP_GUIDE.md</span>.
            </Alert>
          ) : (
            <>
              <SignInButton callbackUrl={callbackUrl} />
              <p className="mt-4 text-center text-xs leading-relaxed text-ink-faint">
                We only ask Google for your name and email address. This app never
                sees or stores your Google password.
              </p>
            </>
          )}
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-lg bg-surface-muted px-3.5 py-3">
          <ShieldCheck className="size-4 mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-ink-soft">
            Access is by invitation. Permission to publish to YouTube is granted
            separately by an administrator and is never requested from you here.
          </p>
        </div>

        <nav className="mt-6 flex justify-center gap-4 text-xs text-ink-faint">
          <Link href="/privacy" className="hover:text-ink-soft">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink-soft">
            Terms
          </Link>
        </nav>
      </div>
    </main>
  );
}
