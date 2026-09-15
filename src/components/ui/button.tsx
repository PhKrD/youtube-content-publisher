import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `publish` is a deliberately distinct variant rather than a reuse of
 * `danger`: publishing is irreversible and must never look like an ordinary
 * primary action, but it is not destructive either.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 focus-visible:outline-brand-600",
        secondary:
          "bg-surface text-ink border border-line-strong shadow-sm hover:bg-surface-muted focus-visible:outline-brand-600",
        ghost: "text-ink-soft hover:bg-surface-muted hover:text-ink focus-visible:outline-brand-600",
        danger: "bg-danger-600 text-white shadow-sm hover:bg-danger-700 focus-visible:outline-danger-600",
        publish:
          "bg-danger-600 text-white shadow-sm hover:bg-danger-700 focus-visible:outline-danger-600 font-semibold",
        link: "text-brand-600 underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        // 40px minimum: comfortable as a touch target on a phone (Section 41).
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10 p-0",
      },
      full: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", full: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Announced to screen readers while `loading`. */
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, full, asChild = false, loading = false, loadingText, children, disabled, ...props },
    ref,
  ) => {
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, full }), className)} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, full }), className)}
        ref={ref}
        // A loading button must be unclickable, not merely styled as busy —
        // otherwise a double-click sends a second request.
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
        {loading && loadingText ? loadingText : children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
