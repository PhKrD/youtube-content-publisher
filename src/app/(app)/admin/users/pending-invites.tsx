"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";

export function PendingInvites({
  invites,
}: {
  invites: { id: string; email: string; role: string; expiresAt: string }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId: id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "Could not revoke the invitation.");
      }
      toast.success("Invitation revoked");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke the invitation.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ul className="divide-y divide-line">
      {invites.map((i) => (
        <li key={i.id} className="flex items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{i.email}</p>
            <p className="text-xs text-ink-faint">
              expires {relativeTime(i.expiresAt)}
            </p>
          </div>
          <Badge tone="neutral">{i.role.toLowerCase()}</Badge>
          <Button
            size="sm"
            variant="ghost"
            loading={busyId === i.id}
            onClick={() => revoke(i.id)}
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}
