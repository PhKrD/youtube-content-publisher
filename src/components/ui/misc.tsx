import * as React from "react";
import { cn, percent } from "@/lib/utils";

/** Determinate progress bar. Accessible by default. */
export function Progress({
  value,
  total,
  label,
  className,
  tone = "brand",
}: {
  value: number | bigint;
  total?: number | bigint | null;
  label?: string;
  className?: string;
  tone?: "brand" | "success" | "danger";
}) {
  const pct = total === undefined ? Math.max(0, Math.min(100, Number(value))) : percent(value, total);
  const barTone =
    tone === "success" ? "bg-success-600" : tone === "danger" ? "bg-danger-600" : "bg-brand-500";

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-line", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300 ease-out", barTone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * For work whose duration genuinely cannot be measured (YouTube's own
 * transcoding, for instance). Section 24 forbids inventing a percentage, so
 * this communicates activity without implying progress.
 */
export function IndeterminateProgress({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn(
        "progress-indeterminate relative h-2 w-full overflow-hidden rounded-full bg-line",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} />;
}

/** Meaningful empty state (Section 42) — always says what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted">
          <Icon className="size-6 text-ink-faint" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-soft">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Page heading with optional description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Summary metric tile for the dashboards. */
export function StatCard({
  label,
  value,
  tone = "neutral",
  icon: Icon,
  href,
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "brand" | "success" | "warn" | "danger";
  icon?: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const toneClasses = {
    neutral: "text-ink",
    brand: "text-brand-700",
    success: "text-success-700",
    warn: "text-warn-700",
    danger: "text-danger-700",
  }[tone];
  const shellTone = {
    neutral: "from-surface to-brand-50/35 border-brand-100/80",
    brand: "from-brand-50 to-info-50 border-brand-200/80",
    success: "from-success-50 to-surface border-success-200/80",
    warn: "from-warn-50 to-surface border-warn-200/80",
    danger: "from-danger-50 to-surface border-danger-200/80",
  }[tone];

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        {Icon && <Icon className="size-4 text-ink-faint" />}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", toneClasses)}>{value}</p>
    </>
  );

  const shell = cn(
    "bg-gradient-to-br border rounded-[var(--radius-card)] shadow-[var(--shadow-card)] px-4 py-3.5 transition-all",
    shellTone,
  );

  if (href) {
    return (
      <a
        href={href}
        className={cn(shell, "block transition-shadow hover:shadow-[var(--shadow-raised)]")}
      >
        {body}
      </a>
    );
  }
  return <div className={shell}>{body}</div>;
}

/** Inline contextual message. */
export function Alert({
  tone = "info",
  title,
  children,
  className,
  icon: Icon,
}: {
  tone?: "info" | "success" | "warn" | "danger";
  title?: string;
  children?: React.ReactNode;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const tones = {
    info: "bg-info-50 border-info-200 text-info-600",
    success: "bg-success-50 border-success-200 text-success-700",
    warn: "bg-warn-50 border-warn-200 text-warn-700",
    danger: "bg-danger-50 border-danger-200 text-danger-700",
  }[tone];

  return (
    <div
      className={cn("rounded-lg border px-4 py-3 text-sm", tones, className)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div className="flex items-start gap-2.5">
        {Icon && <Icon className="size-4 mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          {title && <p className="font-medium">{title}</p>}
          {children && <div className={cn(title && "mt-1", "text-[13px] leading-relaxed")}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

/** Key/value row used across the review and detail pages. */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-3 sm:gap-4", className)}>
      <dt className="text-xs font-medium text-ink-soft sm:text-sm">{label}</dt>
      <dd className="text-sm text-ink sm:col-span-2 break-words">{children}</dd>
    </div>
  );
}
