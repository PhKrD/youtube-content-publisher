import Link from "next/link";

/**
 * Chrome for the public legal pages. These must render without a session:
 * Google's OAuth brand verification fetches the privacy policy and terms
 * URLs anonymously, so anything behind `getPrincipal()` would read as a
 * dead link and fail review.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <article className="bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-card)] px-6 py-8 sm:px-8">
          {children}
        </article>
        <nav className="mt-6 flex justify-center gap-4 text-xs text-ink-faint">
          <Link href="/" className="hover:text-ink-soft">
            Home
          </Link>
          <Link href="/privacy" className="hover:text-ink-soft">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink-soft">
            Terms
          </Link>
          <Link href="/signin" className="hover:text-ink-soft">
            Sign in
          </Link>
        </nav>
      </div>
    </main>
  );
}
