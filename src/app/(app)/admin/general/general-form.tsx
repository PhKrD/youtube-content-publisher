"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

/** A short list of common IANA zones; used to interpret scheduled publish times. */
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

export function GeneralForm({
  initial,
}: {
  initial: { name: string; timezone: string; maxVideoMb: number; maxThumbnailKb: number };
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          timezone: form.timezone,
          maxVideoBytes: form.maxVideoMb * 1024 * 1024,
          maxThumbnailBytes: form.maxThumbnailKb * 1024,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not save.");
      toast.success("Settings saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  return (
    <div className="space-y-4">
      <Field label="Organisation name" required htmlFor="org-name">
        <Input
          id="org-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>

      <Field
        label="Timezone"
        description="Used to interpret scheduled publish times."
        htmlFor="org-tz"
      >
        <Select
          id="org-tz"
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Maximum video size (MB)"
          description="Rejected before any bytes are uploaded."
          htmlFor="org-max-video"
        >
          <Input
            id="org-max-video"
            type="number"
            min={1}
            max={1024 * 1024}
            value={form.maxVideoMb}
            onChange={(e) => setForm({ ...form, maxVideoMb: Number(e.target.value) })}
          />
        </Field>

        <Field
          label="Maximum thumbnail size (KB)"
          description="YouTube's own hard limit is 2048 KB."
          htmlFor="org-max-thumb"
        >
          <Input
            id="org-max-thumb"
            type="number"
            min={1}
            max={2048}
            value={form.maxThumbnailKb}
            onChange={(e) => setForm({ ...form, maxThumbnailKb: Number(e.target.value) })}
          />
        </Field>
      </div>

      <Button onClick={save} loading={busy} disabled={!dirty}>
        <Save className="size-4" aria-hidden="true" />
        Save settings
      </Button>
    </div>
  );
}
