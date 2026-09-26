import type { TemplateVariable } from "@/generated/prisma";

/**
 * Title and description template engine (Sections 15–17).
 *
 * Pure functions, no database and no I/O, so the same code runs in the browser
 * for the live preview and on the server for the authoritative render. That
 * shared-code property is the point: a preview that disagreed with what gets
 * published would undermine the whole review workflow.
 *
 * SECURITY: `renderDescription`/`renderTitle` take the variable *definitions*
 * as the source of truth for locked values and ignore whatever the client sent
 * for a locked key. A contributor cannot rewrite the organisation's contact
 * block by tampering with a request body.
 */

/** `{{ NAME }}` — whitespace tolerated, A-Z/0-9/underscore only. */
const PLACEHOLDER_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

/**
 * Marks the position of a placeholder that resolved to nothing.
 *
 * Needed because "this line is blank" and "this line is blank *because a
 * placeholder vanished*" must be treated differently: the former is an
 * intentional paragraph break the admin typed, the latter is a hole that
 * should close up. U+0000 cannot occur in a template body.
 */
const EMPTY_MARK = "\u0000";

/**
 * Removes lines whose only content was empty placeholders, and strips the
 * marks from lines that still have real text.
 */
function closeEmptyPlaceholderLines(input: string): string {
  return input
    .split("\n")
    .filter((line) => {
      if (!line.includes(EMPTY_MARK)) return true;
      // Drop the line entirely only if nothing but marks/whitespace remains.
      return line.split(EMPTY_MARK).join("").trim() !== "";
    })
    .map((line) => line.split(EMPTY_MARK).join(""))
    .join("\n");
}

export interface RenderIssue {
  key: string;
  label: string;
  message: string;
}

export interface RenderResult {
  text: string;
  /** Required variables with no value. Blocks submission. */
  missing: RenderIssue[];
  /** Placeholders in the body with no matching variable definition. */
  unknownPlaceholders: string[];
  /** Defined variables never used by the body. Informational only. */
  unusedVariables: string[];
}

/** Every distinct placeholder in a template body, in order of appearance. */
export function extractPlaceholders(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

type VariableLike = Pick<
  TemplateVariable,
  "key" | "label" | "required" | "isLocked" | "lockedValue" | "defaultValue" | "maxLength"
>;

/**
 * Resolves the value for one variable, in strict precedence order:
 *   locked value  >  submitted value  >  default value
 *
 * A locked variable ignores submitted input entirely — that is what makes
 * Section 17 an actual guarantee rather than a disabled input box.
 */
export function resolveValue(
  variable: VariableLike,
  submitted: Record<string, unknown>,
): { value: string; wasLocked: boolean } {
  if (variable.isLocked) {
    return { value: (variable.lockedValue ?? "").toString(), wasLocked: true };
  }
  const raw = submitted[variable.key];
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return { value: String(raw), wasLocked: false };
  }
  return { value: (variable.defaultValue ?? "").toString(), wasLocked: false };
}

/**
 * Substitutes variables into a template body.
 *
 * Unresolved *optional* placeholders are removed, and the blank lines they
 * leave behind are collapsed — otherwise an unused {{SOCIAL_LINKS}} would
 * leave an ugly hole in every description.
 */
export function renderTemplate(
  body: string,
  variables: VariableLike[],
  submitted: Record<string, unknown>,
): RenderResult {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const missing: RenderIssue[] = [];
  const unknownPlaceholders: string[] = [];
  const usedKeys = new Set<string>();

  let text = body.replace(PLACEHOLDER_RE, (_full, key: string) => {
    const variable = byKey.get(key);
    if (!variable) {
      unknownPlaceholders.push(key);
      // Leave it visible rather than silently deleting it, so a
      // misconfigured template is obvious to the admin in preview.
      return `{{${key}}}`;
    }
    usedKeys.add(key);
    const { value } = resolveValue(variable, submitted);
    if (!value) {
      if (variable.required) {
        missing.push({
          key,
          label: variable.label,
          message: `${variable.label} is required.`,
        });
      }
      return EMPTY_MARK;
    }
    return value;
  });

  text = tidyWhitespace(closeEmptyPlaceholderLines(text));

  return {
    text,
    missing,
    unknownPlaceholders: [...new Set(unknownPlaceholders)],
    unusedVariables: variables.filter((v) => !usedKeys.has(v.key)).map((v) => v.key),
  };
}

/**
 * Renders a template with placeholders visible instead of values.
 * Useful for showing which fields fill which parts of the text.
 */
export function renderTemplateWithPlaceholders(
  body: string,
  variables: VariableLike[],
): string {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const usedKeys = new Set<string>();

  let text = body.replace(PLACEHOLDER_RE, (_full, key: string) => {
    const variable = byKey.get(key);
    if (!variable) {
      return `{{${key}}}`;
    }
    usedKeys.add(key);
    // Show the placeholder in brackets instead of the value
    return `[${key}]`;
  });

  text = tidyWhitespace(closeEmptyPlaceholderLines(text));
  return text;
}

/**
 * Collapses the gaps left by removed placeholders.
 * Preserves intentional paragraph breaks (one blank line) but removes runs of
 * three or more newlines, and strips lines that became whitespace-only.
 */
export function tidyWhitespace(input: string): string {
  return input
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : line.replace(/[ \t]+$/, "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// YouTube field limits
// ---------------------------------------------------------------------------

/**
 * YouTube's documented hard limits. Exceeding these makes the API reject the
 * insert, so we check before spending an upload.
 */
export const YOUTUBE_LIMITS = {
  titleMaxChars: 100,
  descriptionMaxChars: 5000,
  /** Sum of all tags, including separators. */
  tagsMaxTotalChars: 500,
  tagMaxChars: 100,
  maxTags: 60,
} as const;

/**
 * `<` and `>` are rejected outright by the videos.insert endpoint in titles
 * and descriptions — a common surprise when a description contains markup.
 */
export const YOUTUBE_FORBIDDEN_CHARS = ["<", ">"] as const;

export function findForbiddenChars(text: string): string[] {
  return YOUTUBE_FORBIDDEN_CHARS.filter((c) => text.includes(c));
}

export interface TitleRenderResult extends RenderResult {
  tooLong: boolean;
  length: number;
  forbiddenChars: string[];
}

export function renderTitle(
  pattern: string,
  variables: VariableLike[],
  submitted: Record<string, unknown>,
  maxLength: number = YOUTUBE_LIMITS.titleMaxChars,
): TitleRenderResult {
  const base = renderTemplate(pattern, variables, submitted);
  // A title is a single line; a newline pasted into a variable would otherwise
  // be sent to YouTube verbatim.
  const text = base.text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  return {
    ...base,
    text,
    length: [...text].length,
    tooLong: [...text].length > Math.min(maxLength, YOUTUBE_LIMITS.titleMaxChars),
    forbiddenChars: findForbiddenChars(text),
  };
}

export interface DescriptionRenderResult extends RenderResult {
  tooLong: boolean;
  length: number;
  forbiddenChars: string[];
}

export function renderDescription(
  body: string,
  variables: VariableLike[],
  submitted: Record<string, unknown>,
): DescriptionRenderResult {
  const base = renderTemplate(body, variables, submitted);
  return {
    ...base,
    length: [...base.text].length,
    tooLong: [...base.text].length > YOUTUBE_LIMITS.descriptionMaxChars,
    forbiddenChars: findForbiddenChars(base.text),
  };
}

// ---------------------------------------------------------------------------
// Tags (Section 18)
// ---------------------------------------------------------------------------

export interface TagResolution {
  tags: string[];
  /** Mandatory tags the client omitted and we re-added. */
  reAdded: string[];
  dropped: { tag: string; reason: string }[];
  totalChars: number;
}

/**
 * Merges chosen tags with the organisation's mandatory groups, then enforces
 * YouTube's limits.
 *
 * Mandatory tags are unioned in server-side, so removing them client-side has
 * no effect. They are also placed FIRST, which means that if the 500-character
 * budget forces truncation, the organisation's required tags are the ones that
 * survive.
 */
export function resolveTags(
  selected: string[],
  mandatory: string[],
  limits = YOUTUBE_LIMITS,
): TagResolution {
  const clean = (t: string) => t.trim().replace(/\s+/g, " ");
  const seen = new Set<string>();
  const dropped: { tag: string; reason: string }[] = [];
  const reAdded: string[] = [];

  const selectedClean = selected.map(clean).filter(Boolean);
  const selectedLower = new Set(selectedClean.map((t) => t.toLowerCase()));

  const ordered: string[] = [];
  for (const tag of mandatory.map(clean).filter(Boolean)) {
    if (!selectedLower.has(tag.toLowerCase())) reAdded.push(tag);
    if (!seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      ordered.push(tag);
    }
  }
  for (const tag of selectedClean) {
    if (!seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      ordered.push(tag);
    }
  }

  const out: string[] = [];
  let total = 0;
  for (const tag of ordered) {
    if (tag.length > limits.tagMaxChars) {
      dropped.push({ tag, reason: `longer than ${limits.tagMaxChars} characters` });
      continue;
    }
    if (out.length >= limits.maxTags) {
      dropped.push({ tag, reason: `over the ${limits.maxTags}-tag limit` });
      continue;
    }
    // YouTube counts a quoted tag's characters plus separators; approximate
    // conservatively with tag length + 1.
    const cost = tag.length + 1;
    if (total + cost > limits.tagsMaxTotalChars) {
      dropped.push({ tag, reason: `over the ${limits.tagsMaxTotalChars}-character tag budget` });
      continue;
    }
    out.push(tag);
    total += cost;
  }

  return { tags: out, reAdded, dropped, totalChars: total };
}

/** Extracts `#hashtags` from a rendered description, lower-cased and unique. */
export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  // \p{M} (combining marks) is essential for Indic and many other scripts:
  // "कृष्ण" is क + vowel sign + ष + virama + ण, and omitting marks would
  // truncate the tag at the first sign.
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}\p{M}_]+)/gu)) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}

/**
 * Confirms every mandatory hashtag survived into the final description
 * (Section 21). Compared case-insensitively and without the leading '#'.
 */
export function findMissingHashtags(description: string, required: string[]): string[] {
  const present = new Set(extractHashtags(description));
  return required
    .map((h) => h.replace(/^#/, "").toLowerCase())
    .filter((h) => h.length > 0 && !present.has(h));
}

// ---------------------------------------------------------------------------
// Authoring-time template validation (for the admin editor)
// ---------------------------------------------------------------------------

export interface TemplateLintIssue {
  severity: "error" | "warning";
  message: string;
}

/** Checks a template body against its declared variables. */
export function lintTemplate(body: string, variables: VariableLike[]): TemplateLintIssue[] {
  const issues: TemplateLintIssue[] = [];
  const keys = new Set(variables.map((v) => v.key));
  const placeholders = extractPlaceholders(body);

  for (const p of placeholders) {
    if (!keys.has(p)) {
      issues.push({
        severity: "error",
        message: `{{${p}}} is used in the template but is not defined as a field, so it will appear literally in the published text.`,
      });
    }
  }
  for (const v of variables) {
    if (!placeholders.includes(v.key)) {
      issues.push({
        severity: "warning",
        message: `Field "${v.label}" ({{${v.key}}}) is defined but never used, so contributors will fill it in for nothing.`,
      });
    }
    if (v.isLocked && !v.lockedValue) {
      issues.push({
        severity: "error",
        message: `Field "${v.label}" is locked but has no locked value, so it will always render empty.`,
      });
    }
  }
  // A malformed placeholder is easy to typo and silently publishes as text.
  for (const m of body.matchAll(/\{\{[^}]*\}\}/g)) {
    if (!/^\{\{\s*[A-Z0-9_]+\s*\}\}$/.test(m[0])) {
      issues.push({
        severity: "error",
        message: `"${m[0]}" is not a valid placeholder. Use uppercase letters, numbers and underscores, e.g. {{SPEAKER_NAME}}.`,
      });
    }
  }
  return issues;
}
