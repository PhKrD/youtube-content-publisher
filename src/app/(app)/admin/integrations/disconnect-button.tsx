"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";

/** Disconnects the publishing account. Requires typing the email address. */
export function DisconnectButton({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/google", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not disconnect.");
      toast.success("Google account disconnected");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="sm">
          <Unplug className="size-3.5" aria-hidden="true" />
          Disconnect
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-overlay)]">
          <Dialog.Title className="text-base font-semibold text-ink">
            Disconnect Google?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-ink-soft">
            Publishing will stop immediately. Already-published videos stay on YouTube, and files
            stay in Drive.
          </Dialog.Description>

          <Alert tone="warn" className="mt-3">
            Cached channel and playlist information will be removed. You will need to reconnect and
            confirm the channel again.
          </Alert>

          <div className="mt-4">
            <Field
              label="Type the account email to confirm"
              description={email}
              error={error}
              htmlFor="disconnect-email"
            >
              <Input
                id="disconnect-email"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={email}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="danger"
              onClick={disconnect}
              loading={busy}
              disabled={value.trim().toLowerCase() !== email.toLowerCase()}
            >
              Disconnect
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
