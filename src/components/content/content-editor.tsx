"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Eye,
  Lock,
  RotateCcw,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { POST_TEMPLATE_MAX, type ContentFieldsConfig } from "@/lib/content-fields";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { FileUpload, type ExistingMedia } from "./file-upload";
import { ValidationChecklist } from "./validation-checklist";
import { PublishDialog } from "./publish-dialog";
import type { ValidationReport } from "@/lib/validation";
import { cn } from "@/lib/utils";

export interface EditorVariable {
  key: string;
  label: string;
  helpText: string | null;
  inputType: "TEXT" | "TEXTAREA" | "DATE" | "SELECT" | "URL";
  required: boolean;
  isLocked: boolean;
  lockedValue: string | null;
  maxLength: number | null;
  options: unknown;
}

export interface EditorProps {
  submissionId: string;
  reference: string;
  status: string;
  canPublish: boolean;
  approvalRequired: boolean;
  channelTitle: string | null;
  channelConfirmed: boolean;
  playlists: { id: string; title: string; isAllowed: boolean }[];
  categories: { id: string; title: string }[];
  tagGroups: { id: string; name: string; tags: string[]; isMandatory: boolean }[];
  variables: EditorVariable[];
  media: { video: ExistingMedia | null; thumbnail: ExistingMedia | null; images: ExistingMedia[] };
  /** The organisation's wording for the content-information fields. */
  fields: ContentFieldsConfig;
  initial: {
    /** Null = use the organisation's default post text. */
    postText: string | null;
    program: "FFL" | "PITRU_PAKSHA" | "OTHERS";
    topic: string;
    speaker: string;
    location: string;
    recordedOn: string;
    templateValues: Record<string, string>;
    playlistId: string;
    categoryId: string;
    defaultLanguage: string;
    privacyStatus: string;
    publishMode: string;
    scheduledAt: string;
    tags: string[];
    madeForKids: boolean;
  };
  initialPreview: {
    title: string;
    description: string;
    tags: string[];
    postDefault: string;
    withPlaceholders: {
      title: string;
      description: string;
    };
  };
  initialValidation: ValidationReport;
}

interface PatchResponse {
  preview: {
    title: string;
    titleLength: number;
    description: string;
    descriptionLength: number;
    tags: string[];
    reAddedTags: string[];
    postDefault: string;
    withPlaceholders: {
      title: string;
      description: string;
    };
  };
  validation: ValidationReport;
  status: string;
}

/**
 * Create/edit content.
 *
 * The preview and the checklist are rendered by the SERVER on every save
 * (the PATCH response carries both). That costs a round trip but removes any
 * possibility of the browser showing a description that differs from what
 * will actually be published — the single most important property of this
 * screen.
 *
 * Saving is debounced and automatic, because a student on a phone should not
 * lose a paragraph of typing to a dropped connection.
 */
export function ContentEditor(props: EditorProps) {
  const router = useRouter();

  const [form, setForm] = useState(props.initial);
  const [preview, setPreview] = useState(props.initialPreview);
  const [validation, setValidation] = useState(props.initialValidation);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const editableVariables = useMemo(
    () => props.variables.filter((v) => !v.isLocked),
    [props.variables],
  );
  const lockedVariables = useMemo(
    () => props.variables.filter((v) => v.isLocked),
    [props.variables],
  );

  /**
   * Fields the structured inputs already provide. Showing a second box for
   * "Topic" because the template also declares {{TOPIC}} would be confusing,
   * so those are filtered out of the template section.
   */
  const STRUCTURAL = useMemo(
    () => new Set(["PROGRAM_NAME", "TOPIC", "SPEAKER_NAME", "DATE", "LOCATION"]),
    [],
  );

  const save = useCallback(
    async (patch: Partial<typeof form>, opts: { silent?: boolean } = {}) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/submissions/${props.submissionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            program: patch.program ?? form.program ?? "OTHERS",
            topic: patch.topic ?? form.topic ?? null,
            speaker: patch.speaker ?? form.speaker ?? null,
            location: patch.location ?? form.location ?? null,
            recordedOn: (patch.recordedOn ?? form.recordedOn)
              ? new Date(patch.recordedOn ?? form.recordedOn).toISOString()
              : null,
            templateValues: patch.templateValues ?? form.templateValues,
            playlistId: (patch.playlistId ?? form.playlistId) || null,
            categoryId: patch.categoryId ?? form.categoryId,
            defaultLanguage: patch.defaultLanguage ?? form.defaultLanguage,
            privacyStatus: patch.privacyStatus ?? form.privacyStatus,
            publishMode: patch.publishMode ?? form.publishMode,
            scheduledAt: (patch.scheduledAt ?? form.scheduledAt)
              ? new Date(patch.scheduledAt ?? form.scheduledAt).toISOString()
              : null,
            tags: patch.tags ?? form.tags,
            madeForKids: patch.madeForKids ?? form.madeForKids,
            // `??` would turn an explicit reset (null) back into the old text.
            postText: "postText" in patch ? patch.postText : form.postText,
          }),
        });

        const body = (await res.json()) as PatchResponse & { error?: { message: string } };
        if (!res.ok) throw new Error(body.error?.message ?? "Could not save.");

        setPreview({
          title: body.preview.title,
          description: body.preview.description,
          tags: body.preview.tags,
          postDefault: body.preview.postDefault,
          withPlaceholders: body.preview.withPlaceholders,
        });
        setValidation(body.validation);
        setSavedAt(new Date());
        dirty.current = false;

        if (body.preview.reAddedTags.length > 0 && !opts.silent) {
          toast.info("Required tags were added back", {
            description: body.preview.reAddedTags.join(", "),
          });
        }
      } catch (e) {
        if (!opts.silent) {
          toast.error(e instanceof Error ? e.message : "Could not save.");
        }
      } finally {
        setSaving(false);
      }
    },
    [form, props.submissionId],
  );

  /** Updates local state and schedules a debounced save. */
  const update = useCallback(
    (patch: Partial<typeof form>) => {
      setForm((f) => ({ ...f, ...patch }));
      dirty.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(patch, { silent: true }), 900);
    },
    [save],
  );

  // Warn before losing unsaved edits. Autosave makes this rare, but a
  // closed tab mid-debounce would otherwise silently drop the last change.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  /** Scrolls to and focuses the field a failed check points at. */
  const focusField = useCallback((field: string) => {
    const el =
      document.getElementById(`field-${field}`) ??
      document.querySelector<HTMLElement>(`[data-field-anchor="${field}"]`) ??
      document.getElementById(field);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = el.querySelector<HTMLElement>("input, textarea, select") ?? el;
    focusable.focus?.();
  }, []);

  const submitForReview = useCallback(async () => {
    setSubmitting(true);
    try {
      if (dirty.current) await save({}, { silent: true });
      const res = await fetch(`/api/submissions/${props.submissionId}/submit`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not submit.");

      toast.success(
        props.approvalRequired ? "Submitted for review" : "Marked ready to publish",
      );
      router.push(`/content/${props.submissionId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }, [props.submissionId, props.approvalRequired, router, save]);

  const mandatoryTags = props.tagGroups.filter((g) => g.isMandatory).flatMap((g) => g.tags);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-5">
        {/* ============ MEDIA ============ */}
        <Card>
          <CardHeader>
            <CardTitle>Media</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div data-field-anchor="video">
              <p className="mb-2 text-sm font-medium text-ink">Video</p>
              <FileUpload
                submissionId={props.submissionId}
                kind="VIDEO"
                label="Video"
                description="MP4 works best. Large files upload in the background."
                accept="video/*"
                existing={props.media.video}
                onChanged={() => router.refresh()}
                anchorId="field-video"
              />
            </div>

            <div data-field-anchor="thumbnail">
              <p className="mb-2 text-sm font-medium text-ink">
                Thumbnail <span className="font-normal text-ink-faint">(recommended)</span>
              </p>
              <FileUpload
                submissionId={props.submissionId}
                kind="THUMBNAIL"
                label="Thumbnail"
                description="JPEG or PNG, 1280×720, under 2 MB."
                accept="image/jpeg,image/png"
                existing={props.media.thumbnail}
                onChanged={() => router.refresh()}
                anchorId="field-thumbnail"
              />
            </div>

            {/* Images for the YouTube post section hidden per user request */}
            {/* <div data-field-anchor="images">
              <p className="mb-2 text-sm font-medium text-ink">
                Images for the YouTube post{" "}
                <span className="font-normal text-ink-faint">(optional)</span>
              </p>
              <div className="space-y-2">
                {props.media.images.map((img) => (
                  <FileUpload
                    key={img.id}
                    submissionId={props.submissionId}
                    kind="SUPPORTING_IMAGE"
                    label="Image"
                    accept="image/jpeg,image/png,image/webp"
                    existing={img}
                    onChanged={() => router.refresh()}
                  />
                ))}
                <FileUpload
                  // Re-mount after each upload so the empty slot is ready for the next image.
                  key={`new-image-${props.media.images.length}`}
                  submissionId={props.submissionId}
                  kind="SUPPORTING_IMAGE"
                  label="Add an image"
                  description="Photos or posters to post alongside the video. JPEG, PNG or WebP, up to 25 MB each."
                  accept="image/jpeg,image/png,image/webp"
                  onChanged={() => router.refresh()}
                />
              </div>
            </div> */}
          </CardContent>
        </Card>

        {/* ============ CONTENT INFORMATION ============ */}
        <Card>
          <CardHeader>
            <CardTitle>Content information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Program" required htmlFor="field-program">
              <Select
                id="field-program"
                value={form.program}
                onChange={(e) => update({ program: e.target.value as "FFL" | "PITRU_PAKSHA" | "OTHERS" })}
              >
                <option value="FFL">Food for Life</option>
                <option value="PITRU_PAKSHA">Pitru Paksha</option>
                <option value="OTHERS">Others</option>
              </Select>
            </Field>

            {!props.fields.topic.hidden && (
              <Field label={props.fields.topic.label} required htmlFor="field-topic">
                <Input
                  id="field-topic"
                  value={form.topic}
                  onChange={(e) => update({ topic: e.target.value })}
                  placeholder={props.fields.topic.placeholder}
                />
              </Field>
            )}

            {!props.fields.speaker.hidden && (
              <Field label={props.fields.speaker.label} required htmlFor="field-speaker">
                <Input
                  id="field-speaker"
                  value={form.speaker}
                  onChange={(e) => update({ speaker: e.target.value })}
                  placeholder={props.fields.speaker.placeholder}
                />
              </Field>
            )}

            {!props.fields.recordedOn.hidden && (
              <Field label={props.fields.recordedOn.label} htmlFor="field-recordedOn">
                <Input
                  id="field-recordedOn"
                  type="date"
                  value={form.recordedOn}
                  onChange={(e) => update({ recordedOn: e.target.value })}
                />
              </Field>
            )}

            {!props.fields.location.hidden && (
              <Field
                label={props.fields.location.label}
                htmlFor="field-location"
                className="sm:col-span-2"
              >
                <Input
                  id="field-location"
                  value={form.location}
                  onChange={(e) => update({ location: e.target.value })}
                  placeholder={props.fields.location.placeholder}
                />
              </Field>
            )}
          </CardContent>
        </Card>

        {/* ============ DESCRIPTION FIELDS ============ */}
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
            <p className="mt-1 text-xs text-ink-soft">
              Fill these in and the full YouTube description is built for you.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {editableVariables
              .filter((v) => !STRUCTURAL.has(v.key))
              .map((v) => (
                <Field
                  key={v.key}
                  label={v.label}
                  required={v.required}
                  description={v.helpText ?? undefined}
                  htmlFor={`field-var.${v.key}`}
                  hint={
                    v.maxLength
                      ? `${(form.templateValues[v.key] ?? "").length}/${v.maxLength}`
                      : undefined
                  }
                >
                  {v.inputType === "TEXTAREA" ? (
                    <Textarea
                      id={`field-var.${v.key}`}
                      rows={5}
                      maxLength={v.maxLength ?? undefined}
                      value={form.templateValues[v.key] ?? ""}
                      onChange={(e) =>
                        update({
                          templateValues: { ...form.templateValues, [v.key]: e.target.value },
                        })
                      }
                    />
                  ) : (
                    <Input
                      id={`field-var.${v.key}`}
                      type={v.inputType === "DATE" ? "date" : v.inputType === "URL" ? "url" : "text"}
                      maxLength={v.maxLength ?? undefined}
                      value={form.templateValues[v.key] ?? ""}
                      onChange={(e) =>
                        update({
                          templateValues: { ...form.templateValues, [v.key]: e.target.value },
                        })
                      }
                    />
                  )}
                </Field>
              ))}

            {/* Locked sections are shown, read-only, so contributors can see
                what will be published without being able to change it. */}
            {lockedVariables.length > 0 && (
              <div className="rounded-lg border border-line bg-surface-muted/60 p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Set by your administrator — included automatically
                </p>
                <dl className="mt-2.5 space-y-2">
                  {lockedVariables.map((v) => (
                    <div key={v.key}>
                      <dt className="text-xs font-medium text-ink">{v.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-xs text-ink-soft">
                        {v.lockedValue || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ============ COMPANION POST ============ */}
        <Card>
          <CardHeader>
            <CardTitle>YouTube post</CardTitle>
            <p className="mt-1 text-xs text-ink-soft">
              Optional. Starts from your organisation&apos;s default text — change it if you like.
              The images above are attached. After the video is published, the content page gives
              you this text and the images ready to post.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Field
              label="Post text"
              htmlFor="field-postText"
              hint={`${(form.postText ?? preview.postDefault).length}/${POST_TEMPLATE_MAX}`}
              description="{{VIDEO_URL}} becomes the video link once it is published."
            >
              <Textarea
                id="field-postText"
                rows={5}
                maxLength={POST_TEMPLATE_MAX}
                value={form.postText ?? preview.postDefault}
                onChange={(e) => update({ postText: e.target.value })}
              />
            </Field>
            {form.postText !== null && form.postText !== preview.postDefault && (
              <Button size="sm" variant="ghost" onClick={() => update({ postText: null })}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Use the default text
              </Button>
            )}
          </CardContent>
        </Card>

        {/* ============ YOUTUBE ============ */}
        <Card>
          <CardHeader>
            <CardTitle>YouTube settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Playlist" required htmlFor="field-playlist" className="sm:col-span-2">
              <Select
                id="field-playlist"
                value={form.playlistId}
                onChange={(e) => update({ playlistId: e.target.value })}
              >
                <option value="">Select a playlist…</option>
                {props.playlists.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.isAllowed}>
                    {p.title}
                    {p.isAllowed ? "" : " (unavailable)"}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Category" htmlFor="field-category">
              <Select
                id="field-category"
                value={form.categoryId}
                onChange={(e) => update({ categoryId: e.target.value })}
              >
                {props.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Language" htmlFor="field-language">
              <Select
                id="field-language"
                value={form.defaultLanguage}
                onChange={(e) => update({ defaultLanguage: e.target.value })}
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="bn">Bengali</option>
                <option value="ta">Tamil</option>
                <option value="te">Telugu</option>
                <option value="mr">Marathi</option>
                <option value="gu">Gujarati</option>
                <option value="kn">Kannada</option>
              </Select>
            </Field>

            <Field label="When to publish" htmlFor="field-publishMode">
              <Select
                id="field-publishMode"
                value={form.publishMode}
                onChange={(e) => update({ publishMode: e.target.value })}
              >
                <option value="NOW">Publish immediately</option>
                <option value="SCHEDULED">Schedule for later</option>
              </Select>
            </Field>

            {form.publishMode === "SCHEDULED" ? (
              <Field
                label="Scheduled time"
                required
                htmlFor="field-scheduledAt"
                description="YouTube keeps the video private until this time."
              >
                <Input
                  id="field-scheduledAt"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => update({ scheduledAt: e.target.value })}
                />
              </Field>
            ) : (
              <Field label="Visibility" htmlFor="field-privacy">
                <Select
                  id="field-privacy"
                  value={form.privacyStatus}
                  onChange={(e) => update({ privacyStatus: e.target.value })}
                >
                  <option value="PRIVATE">Private</option>
                  <option value="UNLISTED">Unlisted</option>
                  <option value="PUBLIC">Public</option>
                </Select>
              </Field>
            )}

            <div className="sm:col-span-2" data-field-anchor="tags">
              <p className="mb-2 text-sm font-medium text-ink">Tags</p>
              {mandatoryTags.length > 0 && (
                <p className="mb-2 text-xs text-ink-soft">
                  Required tags are always included: {mandatoryTags.join(", ")}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {props.tagGroups
                  .filter((g) => !g.isMandatory)
                  .map((group) => {
                    const allSelected = group.tags.every((t) => form.tags.includes(t));
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() =>
                          update({
                            tags: allSelected
                              ? form.tags.filter((t) => !group.tags.includes(t))
                              : [...new Set([...form.tags, ...group.tags])],
                          })
                        }
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          allSelected
                            ? "border-brand-200 bg-brand-50 text-brand-700"
                            : "border-line-strong bg-surface text-ink-soft hover:bg-surface-muted",
                        )}
                      >
                        {allSelected && <CheckCircle2 className="mr-1 inline size-3" />}
                        {group.name}
                      </button>
                    );
                  })}
              </div>
              {preview.tags.length > 0 && (
                <p className="mt-2 text-xs text-ink-faint">
                  Will publish with: {preview.tags.join(", ")}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <Checkbox
                label="This content is made for children"
                description="Affects comments and personalised ads on YouTube."
                checked={form.madeForKids}
                onChange={(e) => update({ madeForKids: e.target.checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* ============ PREVIEW ============ */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Eye className="size-4 text-ink-faint" aria-hidden="true" />
            <CardTitle>Preview — exactly what YouTube will receive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 flex items-baseline justify-between text-xs font-medium text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  Generated title
                </span>
                <span className={cn(preview.title.length > 100 && "text-danger-700")}>
                  {preview.title.length}/100
                </span>
              </p>
              <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm font-medium text-ink">
                {preview.title || <span className="text-ink-faint">Fill in the fields above…</span>}
              </p>
              {preview.withPlaceholders?.title && (
                <p className="mt-1 rounded-lg border border-dashed border-line px-3 py-1.5 font-mono text-[11px] text-ink-faint">
                  {preview.withPlaceholders.title}
                </p>
              )}
            </div>

            <div>
              <p className="mb-1 flex items-baseline justify-between text-xs font-medium text-ink-soft">
                <span>Generated description</span>
                <span className={cn(preview.description.length > 5000 && "text-danger-700")}>
                  {preview.description.length}/5000
                </span>
              </p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-sans text-[13px] leading-relaxed text-ink">
                {preview.description || "…"}
              </pre>
              {preview.withPlaceholders?.description && (
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-dashed border-line px-3 py-1.5 font-mono text-[11px] leading-relaxed text-ink-faint">
                  {preview.withPlaceholders.description}
                </pre>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ============ SIDEBAR ============ */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Before publishing</CardTitle>
          </CardHeader>
          <CardContent>
            <ValidationChecklist report={validation} onFocusField={focusField} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-ink-soft">
              <span>{props.reference}</span>
              <span>
                {saving
                  ? "Saving…"
                  : savedAt
                    ? `Saved ${savedAt.toLocaleTimeString()}`
                    : "All changes save automatically"}
              </span>
            </div>

            <Button variant="secondary" full onClick={() => void save({})} loading={saving}>
              <Save className="size-4" aria-hidden="true" />
              Save draft
            </Button>

            {props.approvalRequired ? (
              <Button
                full
                onClick={submitForReview}
                loading={submitting}
                disabled={!validation.readyToSubmit}
              >
                <Send className="size-4" aria-hidden="true" />
                Submit for review
              </Button>
            ) : (
              <Button
                full
                onClick={submitForReview}
                loading={submitting}
                disabled={!validation.readyToSubmit}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Mark ready
              </Button>
            )}

            {props.canPublish && (
              <Button
                variant="publish"
                full
                disabled={!validation.readyToPublish}
                onClick={() => setPublishOpen(true)}
              >
                Publish to YouTube
              </Button>
            )}

            {!validation.readyToSubmit && (
              <p className="text-center text-xs text-ink-faint">
                Complete the items above to continue.
              </p>
            )}
          </CardContent>
        </Card>

        {!props.channelConfirmed && (
          <Alert tone="warn" title="Channel not confirmed">
            An administrator must confirm the YouTube channel before anything can be published. You
            can still prepare and submit content.
          </Alert>
        )}
      </aside>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        submissionId={props.submissionId}
        channelTitle={props.channelTitle}
        playlistTitle={props.playlists.find((p) => p.id === form.playlistId)?.title ?? null}
        title={preview.title}
        scheduledAt={form.publishMode === "SCHEDULED" ? form.scheduledAt : null}
        privacyStatus={form.privacyStatus}
        onPublished={() => router.push(`/content/${props.submissionId}`)}
      />
    </div>
  );
}
