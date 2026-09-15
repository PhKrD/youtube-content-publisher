"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";

/**
 * The production publishing switch.
 *
 * Asymmetric on purpose: enabling requires typing ENABLE, disabling is one
 * click. An emergency stop should never be gated behind a confirmation.
 */
export function ProductionSwitch({
  enabled,
  canEnable,
  channelTitle,
}: {
  enabled: boolean;
  canEnable: boolean;
  channelTitle: string | null;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: next,
          ...(next ? { confirmation } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not change the setting.");

      toast[next ? "warning" : "success"](
        next ? "Production publishing enabled" : "Production publishing disabled",
      );
      setConfirmation("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the setting.");
    } finally {
      setBusy(false);
    }
  }

  if (enabled) {
    return (
      <div className="border-t border-line pt-4">
        <Button variant="secondary" onClick={() => set(false)} loading={busy}>
          <PowerOff className="size-4" aria-hidden="true" />
          Turn production publishing off
        </Button>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-line pt-4">
      {!canEnable ? (
        <Alert tone="warn" icon={AlertTriangle}>
          Satisfy every requirement above before enabling production publishing.
        </Alert>
      ) : (
        <>
          <Alert tone="danger" title="This makes publishing real" icon={AlertTriangle}>
            Once enabled, approved content will be uploaded to{" "}
            <strong>{channelTitle ?? "the confirmed channel"}</strong> and will be visible to its
            audience. Uploads cannot be undone from this app.
          </Alert>

          <Field
            label='Type "ENABLE" to confirm'
            error={error}
            htmlFor="production-confirmation"
          >
            <Input
              id="production-confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="ENABLE"
              autoComplete="off"
            />
          </Field>

          <Button
            variant="danger"
            onClick={() => set(true)}
            loading={busy}
            disabled={confirmation.trim().toUpperCase() !== "ENABLE"}
          >
            <Power className="size-4" aria-hidden="true" />
            Enable production publishing
          </Button>
        </>
      )}
    </div>
  );
}
