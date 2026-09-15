"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "APPROVAL_REQUIRED" | "DIRECT_PUBLISH";

/** Chooses between the two workflows in Section 27. */
export function ApprovalModeForm({ current }: { current: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(current);
  const [busy, setBusy] = useState(false);

  const options: { value: Mode; title: string; description: string }[] = [
    {
      value: "APPROVAL_REQUIRED",
      title: "Approval required",
      description:
        "Contributors submit for review. A reviewer approves, then someone with publishing rights publishes. Recommended when students are producing the content.",
    },
    {
      value: "DIRECT_PUBLISH",
      title: "Direct publish",
      description:
        "Anyone with publishing rights can publish their own content without review. Faster, but nothing is checked first.",
    },
  ];

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalMode: mode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not save.");
      toast.success("Approval workflow updated");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">Approval workflow</legend>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
              mode === o.value
                ? "border-brand-500 bg-brand-50"
                : "border-line hover:bg-surface-muted",
            )}
          >
            <input
              type="radio"
              name="approvalMode"
              value={o.value}
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
              className="mt-0.5 size-4 shrink-0 text-brand-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{o.title}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">{o.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Button onClick={save} loading={busy} disabled={mode === current}>
        Save workflow
      </Button>
    </div>
  );
}
