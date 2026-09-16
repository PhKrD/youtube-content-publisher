"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

/** Records consent, then sends the user on to where they were heading. */
export function AcceptForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/policy-consent", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Could not record your agreement.");
      }
      router.replace(returnTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      {error && (
        <Alert tone="danger" icon={AlertTriangle} className="mb-5">
          {error}
        </Alert>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-surface-muted px-3.5 py-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-line accent-[var(--color-brand-600)]"
        />
        <span className="text-sm leading-relaxed text-ink-soft">
          I have read and agree to the Privacy Policy and the Terms of Service, and
          I agree to be bound by the YouTube Terms of Service.
        </span>
      </label>

      <Button
        onClick={accept}
        disabled={!checked}
        loading={busy}
        loadingText="Saving your agreement"
        full
        className="mt-5"
      >
        Agree and continue
      </Button>

      <p className="mt-4 text-center text-xs text-ink-faint">
        If you do not agree, simply sign out — the app cannot be used without
        agreeing.
      </p>
    </div>
  );
}
