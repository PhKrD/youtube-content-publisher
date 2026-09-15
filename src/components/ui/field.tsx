"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Form primitives with accessibility wired in by construction (Section 43).
 *
 * `Field` generates one id and threads it through label / control /
 * description / error via aria-describedby and aria-invalid. Doing this by
 * hand on every input is how forms end up unlabelled, so the plumbing is not
 * optional here.
 */

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

export function useField() {
  return React.useContext(FieldContext);
}

export function Field({
  children,
  error,
  description,
  label,
  required,
  hint,
  className,
  htmlFor,
}: {
  children: React.ReactNode;
  label?: string;
  error?: string | null;
  description?: string;
  /** Right-aligned secondary text, e.g. a character counter. */
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  htmlFor?: string;
}) {
  const generated = React.useId();
  const id = htmlFor ?? generated;
  const descId = description ? `${id}-description` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cn("space-y-1.5", className)} data-field-anchor={id}>
        {(label || hint) && (
          <div className="flex items-baseline justify-between gap-3">
            {label && (
              <label htmlFor={id} className="block text-sm font-medium text-ink">
                {label}
                {required && (
                  <span className="text-danger-600 ml-0.5" aria-hidden="true">
                    *
                  </span>
                )}
                {required && <span className="sr-only"> (required)</span>}
              </label>
            )}
            {hint && <span className="text-xs text-ink-faint shrink-0">{hint}</span>}
          </div>
        )}
        {children}
        {description && !error && (
          <p id={descId} className="text-xs text-ink-soft">
            {description}
          </p>
        )}
        {error && (
          // role=alert so the message is announced the moment it appears.
          <p id={errId} role="alert" className="flex items-start gap-1.5 text-xs text-danger-700">
            <AlertCircle className="size-3.5 mt-px shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

const controlBase =
  "w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint " +
  "transition-colors disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-faint " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-600";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const field = useField();
    return (
      <input
        ref={ref}
        id={props.id ?? field?.id}
        aria-describedby={props["aria-describedby"] ?? field?.describedBy}
        aria-invalid={props["aria-invalid"] ?? field?.invalid ?? undefined}
        className={cn(
          controlBase,
          "h-10",
          field?.invalid ? "border-danger-500" : "border-line-strong",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  const field = useField();
  return (
    <textarea
      ref={ref}
      id={props.id ?? field?.id}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      aria-invalid={props["aria-invalid"] ?? field?.invalid ?? undefined}
      className={cn(
        controlBase,
        "py-2 min-h-24 resize-y leading-relaxed",
        field?.invalid ? "border-danger-500" : "border-line-strong",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

/**
 * A native <select>. Chosen over a custom listbox on purpose: it is fully
 * accessible for free and, critically, renders as the OS picker on mobile,
 * which is a much better experience for students on phones (Section 41).
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  const field = useField();
  return (
    <select
      ref={ref}
      id={props.id ?? field?.id}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      aria-invalid={props["aria-invalid"] ?? field?.invalid ?? undefined}
      className={cn(
        controlBase,
        "h-10 pr-9 appearance-none bg-no-repeat",
        field?.invalid ? "border-danger-500" : "border-line-strong",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: "right 0.65rem center",
      }}
      {...props}
    >
      {children}
    </select>
  );
});
Select.displayName = "Select";

export function Checkbox({
  className,
  label,
  description,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = React.useId();
  const inputId = props.id ?? id;
  return (
    <div className="flex items-start gap-2.5">
      <input
        type="checkbox"
        id={inputId}
        className={cn(
          "mt-0.5 size-4 shrink-0 rounded border-line-strong text-brand-600",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          className,
        )}
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-sm text-ink cursor-pointer">
          {label}
        </label>
        {description && <p className="text-xs text-ink-soft mt-0.5">{description}</p>}
      </div>
    </div>
  );
}
