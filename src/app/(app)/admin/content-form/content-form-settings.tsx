"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import {
  CONTENT_FIELD_KEYS,
  CONTENT_FIELD_PLACEHOLDER,
  DEFAULT_CONTENT_FIELDS,
  DEFAULT_POST_TEMPLATE,
  POST_PLACEHOLDERS,
  POST_TEMPLATE_MAX,
  type ContentFieldKey,
  type ContentFieldsConfig,
} from "@/lib/content-fields";

export function ContentFormSettings({
  initialFields,
  initialPostTemplate,
}: {
  initialFields: ContentFieldsConfig;
  initialPostTemplate: string;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [postTemplate, setPostTemplate] = useState(initialPostTemplate);
  const [busy, setBusy] = useState(false);

  const dirty =
    JSON.stringify(fields) !== JSON.stringify(initialFields) || postTemplate !== initialPostTemplate;

  const setField = (key: ContentFieldKey, patch: Partial<ContentFieldsConfig[ContentFieldKey]>) =>
    setFields((f) => ({ ...f, [key]: { ...f[key], ...patch } }));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentFields: fields, postTemplate }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not save.");
      toast.success("Saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Content information fields</CardTitle>
          <p className="mt-1 text-xs text-ink-soft">
            Rename each field and its example text to match how your team talks. Hide fields you
            don&apos;t use. Templates keep working: each field still fills the same placeholder.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {CONTENT_FIELD_KEYS.map((key) => (
            <div key={key} className="rounded-lg border border-line p-3.5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-soft">
                  Fills <code className="font-mono">{`{{${CONTENT_FIELD_PLACEHOLDER[key]}}}`}</code>
                </p>
                <Checkbox
                  label="Hide this field"
                  checked={fields[key].hidden}
                  onChange={(e) => setField(key, { hidden: e.target.checked })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Label" required htmlFor={`label-${key}`}>
                  <Input
                    id={`label-${key}`}
                    maxLength={60}
                    value={fields[key].label}
                    placeholder={DEFAULT_CONTENT_FIELDS[key].label}
                    onChange={(e) => setField(key, { label: e.target.value })}
                  />
                </Field>
                {key !== "recordedOn" && (
                  <Field label="Example text" htmlFor={`placeholder-${key}`}>
                    <Input
                      id={`placeholder-${key}`}
                      maxLength={120}
                      value={fields[key].placeholder}
                      onChange={(e) => setField(key, { placeholder: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setFields(DEFAULT_CONTENT_FIELDS)}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Restore original wording
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default YouTube post text</CardTitle>
          <p className="mt-1 text-xs text-ink-soft">
            Every new post starts with this text. Anyone preparing content can change it for their
            own post.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label="Post text"
            required
            htmlFor="post-template"
            hint={`${postTemplate.length}/${POST_TEMPLATE_MAX}`}
          >
            <Textarea
              id="post-template"
              rows={6}
              maxLength={POST_TEMPLATE_MAX}
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value)}
            />
          </Field>
          <p className="text-xs text-ink-soft">
            You can use:{" "}
            {POST_PLACEHOLDERS.map((p) => (
              <code key={p} className="mr-1.5 inline-block font-mono text-[11px] text-ink">
                {`{{${p}}}`}
              </code>
            ))}
            and any variable from your description template (for example{" "}
            <code className="font-mono text-[11px] text-ink">{"{{HASHTAGS}}"}</code>). Empty fields
            are left out.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setPostTemplate(DEFAULT_POST_TEMPLATE)}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Restore the example text
          </Button>
        </CardContent>
      </Card>

      <Button onClick={save} loading={busy} disabled={!dirty || !postTemplate.trim()}>
        <Save className="size-4" aria-hidden="true" />
        Save
      </Button>
    </div>
  );
}
