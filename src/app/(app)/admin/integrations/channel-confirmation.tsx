"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

/**
 * Channel confirmation (Section 9).
 *
 * The admin must type the channel's exact name. This is the single most
 * important safeguard in the application: publishing to the wrong channel
 * cannot be undone, and a checkbox gets ticked without being read.
 */
export function ChannelConfirmation({
  channel,
}: {
  channel: {
    id: string;
    title: string;
    youtubeChannelId: string;
    customUrl: string | null;
    thumbnailUrl: string | null;
    confirmedAt: string | null;
  };
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const matches = normalise(value) === normalise(channel.title);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: channel.id, confirmTitle: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not confirm the channel.");
      toast.success("Channel confirmed");
      setValue("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm the channel.");
    } finally {
      setBusy(false);
    }
  }

  async function unconfirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/channels/confirm", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: channel.id }),
      });
      if (!res.ok) throw new Error("Could not remove the confirmation.");
      toast.success("Confirmation removed — publishing is now blocked");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the confirmation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex items-start gap-3">
        {channel.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.thumbnailUrl}
            alt=""
            className="size-14 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="size-14 shrink-0 rounded-full bg-surface-muted" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">{channel.title}</p>
          {channel.customUrl && <p className="text-sm text-ink-soft">{channel.customUrl}</p>}
          <p className="mt-0.5 font-mono text-xs text-ink-faint">{channel.youtubeChannelId}</p>
          <a
            href={`https://www.youtube.com/channel/${channel.youtubeChannelId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline"
          >
            Open this channel on YouTube to check
          </a>
        </div>
      </div>

      {channel.confirmedAt ? (
        <div className="mt-4 space-y-3">
          <Alert tone="success" title="Confirmed as the publishing target" icon={CheckCircle2}>
            Confirmed {formatDateTime(channel.confirmedAt)}.
          </Alert>
          <Button variant="ghost" size="sm" onClick={unconfirm} loading={busy}>
            Remove confirmation (blocks all publishing)
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Alert tone="warn" title="Not confirmed yet" icon={AlertTriangle}>
            Check the channel above really is the one you want. Publishing to the wrong channel
            cannot be undone from this app.
          </Alert>

          <Field
            label="Type the channel name to confirm"
            description={`Type exactly: ${channel.title}`}
            error={error}
            htmlFor={`confirm-${channel.id}`}
          >
            <Input
              id={`confirm-${channel.id}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={channel.title}
              autoComplete="off"
            />
          </Field>

          <Button onClick={confirm} loading={busy} disabled={!matches}>
            <ShieldCheck className="size-4" aria-hidden="true" />
            Yes, this is the channel I want to publish to
          </Button>
        </div>
      )}
    </div>
  );
}
