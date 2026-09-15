"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Lock, LockOpen, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import type { TemplateLintIssue } from "@/lib/templates";

interface Variable {
  id: string;
  key: string;
  label: string;
  required: boolean;
  isLocked: boolean;
  lockedValue: string | null;
  helpText: string | null;
}

/**
 * Template editor.
 *
 * Lint results come from the same `lintTemplate` the server uses, so what the
 * admin is warned about here is exactly what would go wrong in a published
 * description.
 */
export function TemplateEditor({
  kind,
  id,
  value,
  maxLength,
  variables,
  initialIssues,
}: {
  kind: "title" | "description";
  id: string;
  value: string;
  maxLength?: number;
  variables: Variable[];
  initialIssues: TemplateLintIssue[];
}) {
  const router = useRouter();
  const [text, setText] = useState(value);
  const [issues, setIssues] = useState(initialIssues);
  const [busy, setBusy] = useState(false);

  async function saveTemplate() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "title" ? { kind, id, pattern: text, maxLength } : { kind, id, body: text },
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not save the template.");
      setIssues(body.issues ?? []);
      toast.success("Template saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the template.");
    } finally {
      setBusy(false);
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="space-y-4">
      <Field
        label={kind === "title" ? "Title pattern" : "Description body"}
        description={
          kind === "title"
            ? "One line. YouTube truncates titles at 100 characters."
            : "Use blank lines for paragraphs. Unused optional placeholders are removed cleanly."
        }
        hint={`${text.length} characters`}
        htmlFor={`template-${id}`}
      >
        {kind === "title" ? (
          <Input id={`template-${id}`} value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <Textarea
            id={`template-${id}`}
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-xs"
          />
        )}
      </Field>

      {errors.length > 0 && (
        <Alert tone="danger" title="Problems with this template" icon={AlertTriangle}>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {errors.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert tone="warn" title="Suggestions">
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {warnings.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Button onClick={saveTemplate} loading={busy} disabled={text === value}>
        <Save className="size-4" aria-hidden="true" />
        Save template
      </Button>

      {/* ---- fields ---- */}
      <div className="border-t border-line pt-4">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Fields ({variables.length})
        </p>
        <ul className="space-y-2">
          {variables.map((v) => (
            <VariableRow key={v.id} variable={v} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function VariableRow({ variable }: { variable: Variable }) {
  const router = useRouter();
  const [lockedValue, setLockedValue] = useState(variable.lockedValue ?? "");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "variable", id: variable.id, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not update the field.");
      toast.success("Field updated");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the field.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            {variable.isLocked && <Lock className="size-3.5 text-ink-faint" aria-hidden="true" />}
            {variable.label}
          </p>
          <p className="font-mono text-xs text-ink-faint">{`{{${variable.key}}}`}</p>
        </div>

        <Button
          size="sm"
          variant={variable.isLocked ? "secondary" : "ghost"}
          disabled={busy}
          onClick={() => {
            if (variable.isLocked) {
              void patch({ isLocked: false });
            } else {
              // Locking needs a value, so open the editor rather than
              // locking to an empty string.
              setExpanded(true);
            }
          }}
        >
          {variable.isLocked ? (
            <>
              <LockOpen className="size-3.5" aria-hidden="true" />
              Unlock
            </>
          ) : (
            <>
              <Lock className="size-3.5" aria-hidden="true" />
              Lock
            </>
          )}
        </Button>

        {!variable.isLocked && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => patch({ required: !variable.required })}
          >
            {variable.required ? "Required" : "Optional"}
          </Button>
        )}
      </div>

      {(variable.isLocked || expanded) && (
        <div className="mt-3">
          <Field
            label="Locked value — always used, contributors cannot change it"
            htmlFor={`locked-${variable.id}`}
          >
            <Textarea
              id={`locked-${variable.id}`}
              rows={3}
              value={lockedValue}
              onChange={(e) => setLockedValue(e.target.value)}
              className="text-xs"
            />
          </Field>
          <Button
            size="sm"
            className="mt-2"
            loading={busy}
            disabled={!lockedValue.trim()}
            onClick={() => patch({ isLocked: true, lockedValue })}
          >
            Save locked value
          </Button>
        </div>
      )}
    </li>
  );
}
