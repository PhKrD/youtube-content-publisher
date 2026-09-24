import { z } from "zod";

/**
 * Admin-configurable wording for the "Content information" form, plus the
 * default text for the companion YouTube post.
 *
 * Pure (no database) so the admin form and the editor can share it. Stored per
 * organisation in the `Setting` table; see org-settings.ts.
 */

export const CONTENT_FIELD_KEYS = ["program", "topic", "speaker", "recordedOn", "location"] as const;
export type ContentFieldKey = (typeof CONTENT_FIELD_KEYS)[number];

export interface ContentFieldConfig {
  label: string;
  placeholder: string;
  hidden: boolean;
}
export type ContentFieldsConfig = Record<ContentFieldKey, ContentFieldConfig>;

export const DEFAULT_CONTENT_FIELDS: ContentFieldsConfig = {
  program: { label: "Programme", placeholder: "Bhagavad Gita Workshop", hidden: false },
  topic: { label: "Topic", placeholder: "Who Am I?", hidden: false },
  speaker: { label: "Speaker", placeholder: "Name of the speaker", hidden: false },
  recordedOn: { label: "Date of the programme", placeholder: "", hidden: false },
  location: { label: "Location", placeholder: "Temple hall", hidden: false },
};

/** The template placeholder each field feeds, shown to admins. */
export const CONTENT_FIELD_PLACEHOLDER: Record<ContentFieldKey, string> = {
  program: "PROGRAM_NAME",
  topic: "TOPIC",
  speaker: "SPEAKER_NAME",
  recordedOn: "DATE",
  location: "LOCATION",
};

const fieldSchema = z.object({
  label: z.string().trim().min(1, "Every field needs a label.").max(60),
  placeholder: z.string().trim().max(120),
  hidden: z.boolean(),
});

export const contentFieldsSchema = z.object({
  program: fieldSchema,
  topic: fieldSchema,
  speaker: fieldSchema,
  recordedOn: fieldSchema,
  location: fieldSchema,
});

/** Merges stored (possibly partial or stale) config over the defaults. */
export function resolveContentFields(stored: unknown): ContentFieldsConfig {
  const out = structuredClone(DEFAULT_CONTENT_FIELDS);
  if (!stored || typeof stored !== "object") return out;
  for (const key of CONTENT_FIELD_KEYS) {
    const parsed = fieldSchema.safeParse((stored as Record<string, unknown>)[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Companion YouTube post
// ---------------------------------------------------------------------------

export const POST_TEMPLATE_MAX = 5000;

export const DEFAULT_POST_TEMPLATE =
  "{{TOPIC}}\n{{PROGRAM_NAME}}\n\nWatch the full video: {{VIDEO_URL}}";

/** Placeholders always available in a post template, besides template variables. */
export const POST_PLACEHOLDERS = [
  "TITLE",
  "PROGRAM_NAME",
  "TOPIC",
  "SPEAKER_NAME",
  "DATE",
  "LOCATION",
  "VIDEO_URL",
] as const;

export const postTemplateSchema = z.string().trim().min(1).max(POST_TEMPLATE_MAX);
