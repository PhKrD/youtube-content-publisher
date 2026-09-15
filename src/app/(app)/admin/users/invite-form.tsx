"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("CONTRIBUTOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not send the invitation.");

      setInvited(email);
      setEmail("");
      toast.success("Invitation created");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="Email address" required error={error} htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@example.com"
            required
            autoComplete="off"
          />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="REVIEWER">Reviewer</option>
            <option value="ADMIN">Administrator</option>
          </Select>
        </Field>
      </div>

      <Button type="submit" loading={busy} disabled={!email.trim()}>
        <UserPlus className="size-4" aria-hidden="true" />
        Create invitation
      </Button>

      {invited && (
        <Alert tone="success" title={`${invited} can now sign in`}>
          {/*
            Honesty about a real limitation: no email is sent. Claiming
            otherwise would leave an admin waiting for a message that never
            arrives.
          */}
          This app does not send emails yet. Tell them to open the app and choose{" "}
          <strong>Continue with Google</strong> using exactly this address.
        </Alert>
      )}
    </form>
  );
}
