import { cn } from "@/lib/utils";

/**
 * The app's own mark: an arrow rising out of a tray ("publish").
 *
 * Deliberately not a play button: YouTube's branding guidelines forbid
 * marks that could be mistaken for YouTube's own. Keep src/app/icon.svg in
 * sync with this drawing.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[62%]"
        aria-hidden="true"
      >
        <path d="M12 14V4" />
        <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
        <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" />
      </svg>
    </span>
  );
}
