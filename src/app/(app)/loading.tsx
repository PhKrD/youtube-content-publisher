/**
 * Shown instantly on navigation inside the app shell while the next page's
 * server data loads. Its presence also lets Next.js prefetch dynamic routes
 * up to this boundary, so tab and nav clicks respond immediately.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="mb-6 space-y-2">
        <div className="h-7 w-56 rounded-lg bg-line" />
        <div className="h-4 w-80 max-w-full rounded bg-line/70" />
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-5 py-4 last:border-0">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-line" />
              <div className="h-3 w-1/3 rounded bg-line/70" />
            </div>
            <div className="h-5 w-20 rounded-full bg-line/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
