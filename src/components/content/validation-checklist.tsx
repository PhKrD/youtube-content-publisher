"use client";

import { AlertTriangle, Check, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValidationCheck, ValidationReport } from "@/lib/validation";

/**
 * The pre-publish checklist (Section 21).
 *
 * Clicking a failing item focuses the field responsible, which is the
 * difference between a useful checklist and a list of complaints.
 */
export function ValidationChecklist({
  report,
  onFocusField,
  className,
}: {
  report: ValidationReport;
  onFocusField?: (field: string) => void;
  className?: string;
}) {
  const { errors, warnings, readyToPublish } = report;
  const passed = report.checks.filter((c) => c.ok);

  return (
    <div className={cn("space-y-3", className)}>
      {readyToPublish ? (
        <div className="flex items-center gap-2 rounded-lg border border-success-200 bg-success-50 px-3.5 py-3">
          <CheckCircle2 className="size-4.5 shrink-0 text-success-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-success-700">Ready to publish</p>
            {warnings.length > 0 && (
              <p className="text-xs text-success-700/80">
                {warnings.length} suggestion{warnings.length === 1 ? "" : "s"} below.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-warn-200 bg-warn-50 px-3.5 py-3">
          <AlertTriangle className="size-4.5 shrink-0 text-warn-700" aria-hidden="true" />
          <p className="text-sm font-semibold text-warn-700">
            {errors.length} item{errors.length === 1 ? "" : "s"} need attention
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="space-y-1.5">
          {errors.map((check) => (
            <CheckRow key={check.id} check={check} onFocusField={onFocusField} tone="error" />
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1.5">
          {warnings.map((check) => (
            <CheckRow key={check.id} check={check} onFocusField={onFocusField} tone="warning" />
          ))}
        </ul>
      )}

      {passed.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
            {passed.length} check{passed.length === 1 ? "" : "s"} passed
          </summary>
          <ul className="mt-2 space-y-1">
            {passed.map((check) => (
              <li key={check.id} className="flex items-center gap-2 text-xs text-ink-soft">
                <Check className="size-3.5 shrink-0 text-success-600" aria-hidden="true" />
                {check.label}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CheckRow({
  check,
  onFocusField,
  tone,
}: {
  check: ValidationCheck;
  onFocusField?: (field: string) => void;
  tone: "error" | "warning";
}) {
  const interactive = Boolean(check.field && onFocusField);
  const Icon = tone === "error" ? X : AlertTriangle;

  const content = (
    <>
      <Icon
        className={cn(
          "size-3.5 mt-0.5 shrink-0",
          tone === "error" ? "text-danger-600" : "text-warn-600",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="font-medium text-ink">{check.label}</span>
        {check.message && (
          <span className="block text-ink-soft">{check.message}</span>
        )}
      </span>
    </>
  );

  return (
    <li>
      {interactive ? (
        <button
          type="button"
          onClick={() => onFocusField!(check.field!)}
          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-muted"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-start gap-2 px-2 py-1.5 text-xs">{content}</div>
      )}
    </li>
  );
}
