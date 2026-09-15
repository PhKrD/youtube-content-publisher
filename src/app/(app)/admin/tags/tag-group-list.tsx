"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";

interface Group {
  id: string;
  name: string;
  tags: string[];
  isMandatory: boolean;
}

export function TagGroupList({ groups }: { groups: Group[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTags, setNewTags] = useState("");
  const [busy, setBusy] = useState(false);

  /** Accepts commas, newlines, and optional leading '#'. */
  const parseTags = (raw: string) =>
    raw
      .split(/[,\n]/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);

  async function save(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not save.");
      if (body.dropped?.length > 0) {
        toast.warning("Some tags were dropped", {
          description: body.dropped
            .map((d: { tag: string; reason: string }) => `${d.tag}: ${d.reason}`)
            .join("; "),
        });
      } else {
        toast.success("Saved");
      }
      setAdding(false);
      setNewName("");
      setNewTags("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Could not delete the group.");
      toast.success("Group deleted");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="divide-y divide-line">
        {groups.map((g) => (
          <li key={g.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                {g.name}
                {g.isMandatory && <Badge tone="brand">Always applied</Badge>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {g.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-ink-soft"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={g.isMandatory ? "secondary" : "ghost"}
                disabled={busy}
                onClick={() =>
                  save({ id: g.id, name: g.name, tags: g.tags, isMandatory: !g.isMandatory })
                }
              >
                {g.isMandatory ? "Make optional" : "Make mandatory"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => remove(g.id)}
                aria-label={`Delete ${g.name}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-5 py-4">
        {adding ? (
          <div className="space-y-3">
            <Field label="Group name" required htmlFor="new-group-name">
              <Input
                id="new-group-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Bhagavad Gita"
              />
            </Field>
            <Field
              label="Tags"
              description="Separate with commas or new lines. A leading # is ignored."
              htmlFor="new-group-tags"
            >
              <Input
                id="new-group-tags"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="BhagavadGita, Krishna, Spirituality"
              />
            </Field>
            <div className="flex gap-2">
              <Button
                loading={busy}
                disabled={!newName.trim() || parseTags(newTags).length === 0}
                onClick={() => save({ name: newName.trim(), tags: parseTags(newTags) })}
              >
                Create group
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add a tag group
          </Button>
        )}
      </div>
    </>
  );
}
