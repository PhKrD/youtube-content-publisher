import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { SubmissionStatus } from "@/generated/prisma";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-surface-muted text-ink-soft border-line-strong",
        brand: "bg-brand-50 text-brand-700 border-brand-200",
        success: "bg-success-50 text-success-700 border-success-200",
        warn: "bg-warn-50 text-warn-700 border-warn-200",
        danger: "bg-danger-50 text-danger-700 border-danger-200",
        info: "bg-info-50 text-info-600 border-info-200",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), "forced-border", className)} {...props} />;
}

/**
 * Status presentation, defined once.
 *
 * Colour alone never carries the meaning — the label is always present — which
 * keeps the status readable for colour-blind users (Section 43).
 */
const STATUS_PRESENTATION: Record<
  SubmissionStatus,
  { label: string; tone: NonNullable<BadgeProps["tone"]> }
> = {
  [SubmissionStatus.DRAFT]: { label: "Draft", tone: "neutral" },
  [SubmissionStatus.UPLOADING]: { label: "Uploading", tone: "info" },
  [SubmissionStatus.UPLOADED_TO_DRIVE]: { label: "Uploaded", tone: "info" },
  [SubmissionStatus.READY]: { label: "Ready", tone: "brand" },
  [SubmissionStatus.SUBMITTED]: { label: "Submitted", tone: "warn" },
  [SubmissionStatus.UNDER_REVIEW]: { label: "Under review", tone: "warn" },
  [SubmissionStatus.CHANGES_REQUESTED]: { label: "Changes required", tone: "danger" },
  [SubmissionStatus.APPROVED]: { label: "Approved", tone: "success" },
  [SubmissionStatus.PUBLISHING]: { label: "Publishing", tone: "info" },
  [SubmissionStatus.PUBLISHED]: { label: "Published", tone: "success" },
  [SubmissionStatus.FAILED]: { label: "Failed", tone: "danger" },
  [SubmissionStatus.ARCHIVED]: { label: "Archived", tone: "neutral" },
};

export function statusLabel(status: SubmissionStatus): string {
  return STATUS_PRESENTATION[status]?.label ?? status;
}

export function StatusBadge({
  status,
  className,
}: {
  status: SubmissionStatus;
  className?: string;
}) {
  const p = STATUS_PRESENTATION[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={p.tone} className={className}>
      {p.label}
    </Badge>
  );
}
