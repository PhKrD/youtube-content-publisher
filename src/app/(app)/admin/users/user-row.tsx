"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { initials } from "@/lib/utils";

export function UserRow({
  user,
  isSelf,
}: {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    role: string;
    canPublishDirectly: boolean;
    disabled: boolean;
    submissionCount: number;
    lastLogin: string;
    joined: string;
  };
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not update the user.");
      toast.success("Updated");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          className="size-9 shrink-0 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
          {initials(user.name, user.email)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
          {user.name ?? user.email}
          {isSelf && <Badge tone="brand">You</Badge>}
          {user.disabled && <Badge tone="danger">Disabled</Badge>}
        </p>
        <p className="truncate text-xs text-ink-soft">{user.email}</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          {user.submissionCount} submission{user.submissionCount === 1 ? "" : "s"} · last signed in{" "}
          {user.lastLogin}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={user.role}
          disabled={busy || isSelf}
          aria-label={`Role for ${user.email}`}
          className="h-9 w-36 text-xs"
          onChange={(e) => patch({ role: e.target.value })}
        >
          <option value="CONTRIBUTOR">Contributor</option>
          <option value="REVIEWER">Reviewer</option>
          <option value="ADMIN">Administrator</option>
        </Select>

        {/* Admins always have publishing rights, so the toggle is meaningless
            for them and is hidden rather than shown as a no-op. */}
        {user.role !== "ADMIN" && (
          <Button
            size="sm"
            variant={user.canPublishDirectly ? "primary" : "secondary"}
            disabled={busy}
            onClick={() => patch({ canPublishDirectly: !user.canPublishDirectly })}
          >
            {user.canPublishDirectly ? "Can publish" : "Cannot publish"}
          </Button>
        )}

        {!isSelf && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => patch({ disabled: !user.disabled })}
          >
            {user.disabled ? "Enable" : "Disable"}
          </Button>
        )}
      </div>
    </li>
  );
}
