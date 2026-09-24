import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardCheck,
  HardDriveUpload,
  Lock,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { getPrincipal } from "@/lib/authz";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

/**
 * Public home page.
 *
 * Signed-in users go straight to their dashboard. Everyone else gets a real
 * description of the app rather than a redirect to a bare login wall: Google's
 * OAuth brand verification fetches this URL anonymously and expects it to
 * explain what the app does and who operates it.
 *
 * Note the deliberate absence of YouTube logos or marks — the YouTube API
 * Services Branding Guidelines forbid using them alongside an app's own name.
 */
export default async function RootPage() {
  const principal = await getPrincipal();
  if (principal) redirect("/dashboard");

  return (
    <main className="min-h-dvh bg-canvas px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="text-center">
          <BrandMark className="mx-auto mb-4 size-12 rounded-xl shadow-[var(--shadow-raised)]" />
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Channel Publisher
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            A private review-and-publish tool for a single YouTube channel. Team
            members submit a video for approval; only after a named reviewer
            approves it does it get published to the channel. Works with YouTube
            and Google Drive.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link href="/signin">Sign in</Link>
            </Button>
            <p className="mt-3 text-xs text-ink-faint">
              Access is by invitation only.
            </p>
          </div>
        </header>

        <section className="mt-12">
          <h2 className="text-sm font-semibold text-ink">How it works</h2>
          <ol className="mt-4 space-y-3">
            {[
              {
                icon: HardDriveUpload,
                title: "Submit",
                body: "A contributor uploads a video with a proposed title, description, tags and thumbnail. The file is stored in the organisation's own Google Drive.",
              },
              {
                icon: ClipboardCheck,
                title: "Review",
                body: "A reviewer reads the submission and either approves it or sends it back with comments. Nothing reaches the channel without this step.",
              },
              {
                icon: UserCheck,
                title: "Publish",
                body: "On approval, the video is uploaded to the channel and optionally added to a playlist. Every action is recorded against the person who took it.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5"
              >
                <Icon
                  className="mt-0.5 size-4 shrink-0 text-ink-faint"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-ink">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold text-ink">
            What it does with your data
          </h2>
          <div className="mt-4 space-y-3">
            <div className="flex gap-3 rounded-[var(--radius-card)] bg-surface-muted px-4 py-3.5">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 text-ink-faint"
                aria-hidden="true"
              />
              <p className="text-sm leading-relaxed text-ink-soft">
                Signing in tells us only your name and email address. This app never
                sees or stores your Google password, shows no advertising, and does
                not sell or transfer your data.
              </p>
            </div>
            <div className="flex gap-3 rounded-[var(--radius-card)] bg-surface-muted px-4 py-3.5">
              <Lock
                className="mt-0.5 size-4 shrink-0 text-ink-faint"
                aria-hidden="true"
              />
              <p className="text-sm leading-relaxed text-ink-soft">
                Permission to publish is granted once by an administrator, not asked
                of every contributor. It can only touch Drive files the app itself
                created, and its access can be revoked at any time from your Google
                account.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold text-ink">Who runs this</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            This app is operated privately for one organisation&rsquo;s own channel.
            It is not a commercial service and there is nothing to buy. For
            questions, including about privacy, contact{" "}
            <a className="underline" href="mailto:palanharkrsnadas@gmail.com">
              palanharkrsnadas@gmail.com
            </a>
            .
          </p>
        </section>

        <footer className="mt-12 border-t border-line pt-6">
          <p className="text-xs leading-relaxed text-ink-faint">
            This application uses YouTube API Services. By using it you agree to the{" "}
            <a
              className="underline"
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noreferrer"
            >
              YouTube Terms of Service
            </a>
            , and your data is handled by Google under the{" "}
            <a
              className="underline"
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
            >
              Google Privacy Policy
            </a>
            .
          </p>
          <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-faint">
            <Link href="/privacy" className="hover:text-ink-soft">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-ink-soft">
              Terms of Service
            </Link>
            <a
              href="https://security.google.com/settings/security/permissions"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink-soft"
            >
              Manage Google access
            </a>
            <Link href="/signin" className="hover:text-ink-soft">
              Sign in
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
