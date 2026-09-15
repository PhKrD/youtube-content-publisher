import { formatDateTime } from "@/lib/utils";

export interface TimelineEvent {
  id: string;
  type: string;
  message: string;
  actor: string | null;
  createdAt: string;
}

/** Colour per event family. Never the only signal — the text always says what happened. */
function dotClass(type: string): string {
  if (type.includes("FAILED") || type.includes("REJECTED")) return "bg-danger-600";
  if (type === "PUBLISHED" || type.includes("APPROVED")) return "bg-success-600";
  if (type.includes("CHANGES")) return "bg-warn-600";
  if (type.includes("UPLOAD") || type.includes("PUBLISH")) return "bg-brand-500";
  return "bg-line-strong";
}

/** Submission history (Section 35). */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-faint">Nothing has happened yet.</p>;
  }

  return (
    <ol className="relative space-y-4">
      {/* Connector line, drawn behind the dots. */}
      <span
        aria-hidden="true"
        className="absolute left-[3px] top-1.5 bottom-1.5 w-px bg-line"
      />
      {events.map((event) => (
        <li key={event.id} className="relative flex gap-3 pl-0">
          <span
            aria-hidden="true"
            className={`relative z-10 mt-1.5 size-[7px] shrink-0 rounded-full ${dotClass(event.type)}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug text-ink">{event.message}</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
              {event.actor ? ` · ${event.actor}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
