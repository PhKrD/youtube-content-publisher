/**
 * Pre-publish validation (Section 21).
 *
 * One pure function produces the checklist the contributor sees AND the
 * verdict the server enforces. Duplicating these rules in a client-side form
 * and a server-side guard is how the two drift apart, and how "Publish" ends
 * up enabled for content YouTube will reject.
 *
 * Every failing check carries a `field` so the UI can jump straight to the
 * offending input, as Section 21 requires.
 */

export type CheckSeverity = "error" | "warning";

export interface ValidationCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: CheckSeverity;
  /** Shown only when `ok` is false. */
  message?: string;
  /** Form field / DOM anchor to focus. */
  field?: string;
}

export interface ValidationReport {
  checks: ValidationCheck[];
  errors: ValidationCheck[];
  warnings: ValidationCheck[];
  /** True when nothing blocking remains. */
  readyToPublish: boolean;
  /** True when it may be sent for review (slightly laxer than publishing). */
  readyToSubmit: boolean;
}

/** Inputs for validation — plain data, so this runs anywhere. */
export interface ValidationInput {
  video?: {
    present: boolean;
    uploadComplete: boolean;
    mimeType?: string;
    sizeBytes?: number;
    filename?: string;
  };
  thumbnail?: {
    present: boolean;
    uploadComplete: boolean;
    mimeType?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
  };
  title: { text: string; tooLong: boolean; length: number; forbiddenChars: string[] };
  description: {
    text: string;
    tooLong: boolean;
    length: number;
    forbiddenChars: string[];
    missingVariables: { key: string; label: string }[];
    unknownPlaceholders: string[];
  };
  tags: { tags: string[]; totalChars: number };
  missingMandatoryHashtags: string[];
  playlist: { selected: boolean; allowed: boolean; title?: string };
  contentInfo: { program?: string | null; topic?: string | null; speaker?: string | null };
  schedule: { mode: "NOW" | "SCHEDULED"; at?: Date | null };
  integration: { connected: boolean; channelConfirmed: boolean; scopesOk: boolean };
  permissions: { canPublish: boolean };
  duplicate: { sameChecksumSubmissionRef?: string | null; alreadyPublishedVideoId?: string | null };
  limits: { maxVideoBytes: number; maxThumbnailBytes: number };
  publishingEnabled: boolean;
}

/** YouTube's accepted container formats. */
export const ACCEPTED_VIDEO_MIME = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/webm",
  "video/mpeg",
  "video/3gpp",
  "video/x-flv",
  "video/x-ms-wmv",
] as const;

export const ACCEPTED_THUMBNAIL_MIME = ["image/jpeg", "image/png"] as const;

/** YouTube's recommended thumbnail geometry. */
export const THUMBNAIL_RECOMMENDED = {
  width: 1280,
  height: 720,
  minWidth: 640,
  aspectRatio: 16 / 9,
  aspectTolerance: 0.05,
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function validateSubmission(input: ValidationInput): ValidationReport {
  const checks: ValidationCheck[] = [];
  const add = (c: ValidationCheck) => checks.push(c);

  // ---- video ----
  add({
    id: "video.present",
    label: "Video uploaded",
    ok: Boolean(input.video?.present && input.video.uploadComplete),
    severity: "error",
    field: "video",
    message: !input.video?.present
      ? "Choose a video file to upload."
      : "The video upload has not finished yet.",
  });

  if (input.video?.present && input.video.mimeType) {
    const supported = (ACCEPTED_VIDEO_MIME as readonly string[]).includes(input.video.mimeType);
    add({
      id: "video.format",
      label: "Video format supported",
      ok: supported,
      severity: "error",
      field: "video",
      message: `YouTube does not accept "${input.video.mimeType}". Use MP4 (H.264) for the most reliable result.`,
    });
  }

  if (input.video?.present && typeof input.video.sizeBytes === "number") {
    add({
      id: "video.size",
      label: "Video within size limit",
      ok: input.video.sizeBytes <= input.limits.maxVideoBytes,
      severity: "error",
      field: "video",
      message: `The video is ${formatBytes(input.video.sizeBytes)}, over the ${formatBytes(
        input.limits.maxVideoBytes,
      )} limit.`,
    });
  }

  // ---- thumbnail (optional, but validated when present) ----
  const thumbPresent = Boolean(input.thumbnail?.present);
  add({
    id: "thumbnail.present",
    label: "Thumbnail uploaded",
    ok: thumbPresent && Boolean(input.thumbnail?.uploadComplete),
    // A warning, not an error: YouTube generates one automatically.
    severity: "warning",
    field: "thumbnail",
    message: thumbPresent
      ? "The thumbnail upload has not finished yet."
      : "No thumbnail chosen. YouTube will pick a frame automatically, which is usually worse.",
  });

  if (thumbPresent && input.thumbnail?.mimeType) {
    add({
      id: "thumbnail.format",
      label: "Thumbnail format supported",
      ok: (ACCEPTED_THUMBNAIL_MIME as readonly string[]).includes(input.thumbnail.mimeType),
      severity: "error",
      field: "thumbnail",
      message: "Thumbnails must be JPEG or PNG.",
    });
  }

  if (thumbPresent && typeof input.thumbnail?.sizeBytes === "number") {
    add({
      id: "thumbnail.size",
      label: "Thumbnail within 2 MB",
      ok: input.thumbnail.sizeBytes <= input.limits.maxThumbnailBytes,
      severity: "error",
      field: "thumbnail",
      message: `The thumbnail is ${formatBytes(
        input.thumbnail.sizeBytes,
      )}. YouTube rejects thumbnails over ${formatBytes(input.limits.maxThumbnailBytes)}.`,
    });
  }

  if (thumbPresent && input.thumbnail?.width && input.thumbnail?.height) {
    const { width, height } = input.thumbnail;
    add({
      id: "thumbnail.dimensions",
      label: "Thumbnail at least 640px wide",
      ok: width >= THUMBNAIL_RECOMMENDED.minWidth,
      severity: "error",
      field: "thumbnail",
      message: `The image is ${width}×${height}. YouTube requires at least ${THUMBNAIL_RECOMMENDED.minWidth}px wide; ${THUMBNAIL_RECOMMENDED.width}×${THUMBNAIL_RECOMMENDED.height} is recommended.`,
    });

    const ratio = width / height;
    add({
      id: "thumbnail.aspect",
      label: "Thumbnail is 16:9",
      ok: Math.abs(ratio - THUMBNAIL_RECOMMENDED.aspectRatio) <= THUMBNAIL_RECOMMENDED.aspectTolerance,
      severity: "warning",
      field: "thumbnail",
      message: `The image is ${width}×${height} (${ratio.toFixed(
        2,
      )}:1). YouTube will letterbox anything that is not 16:9.`,
    });
  }

  // ---- title ----
  add({
    id: "title.present",
    label: "Title present",
    ok: input.title.text.trim().length > 0,
    severity: "error",
    field: "title",
    message: "A title is required.",
  });
  add({
    id: "title.length",
    label: "Title within 100 characters",
    ok: !input.title.tooLong,
    severity: "error",
    field: "title",
    message: `The title is ${input.title.length} characters. YouTube truncates at 100.`,
  });
  if (input.title.forbiddenChars.length > 0) {
    add({
      id: "title.chars",
      label: "Title has no rejected characters",
      ok: false,
      severity: "error",
      field: "title",
      message: `YouTube rejects ${input.title.forbiddenChars
        .map((c) => `"${c}"`)
        .join(" and ")} in titles. Please remove them.`,
    });
  }

  // ---- description ----
  add({
    id: "description.variables",
    label: "All required fields completed",
    ok: input.description.missingVariables.length === 0,
    severity: "error",
    field: input.description.missingVariables[0]?.key
      ? `var.${input.description.missingVariables[0].key}`
      : "description",
    message:
      input.description.missingVariables.length > 0
        ? `Still needed: ${input.description.missingVariables.map((m) => m.label).join(", ")}.`
        : undefined,
  });
  add({
    id: "description.length",
    label: "Description within 5000 characters",
    ok: !input.description.tooLong,
    severity: "error",
    field: "description",
    message: `The description is ${input.description.length} characters. YouTube allows 5000.`,
  });
  if (input.description.forbiddenChars.length > 0) {
    add({
      id: "description.chars",
      label: "Description has no rejected characters",
      ok: false,
      severity: "error",
      field: "description",
      message: `YouTube rejects ${input.description.forbiddenChars
        .map((c) => `"${c}"`)
        .join(" and ")} in descriptions.`,
    });
  }
  if (input.description.unknownPlaceholders.length > 0) {
    add({
      id: "description.placeholders",
      label: "Template has no unresolved placeholders",
      ok: false,
      // An admin template bug, not something the contributor can fix.
      severity: "error",
      field: "description",
      message: `The template refers to ${input.description.unknownPlaceholders
        .map((p) => `{{${p}}}`)
        .join(", ")}, which is not a defined field. Ask an administrator to fix the template.`,
    });
  }

  // ---- mandatory hashtags ----
  if (input.missingMandatoryHashtags.length > 0) {
    add({
      id: "hashtags.mandatory",
      label: "Required hashtags present",
      ok: false,
      severity: "error",
      field: "description",
      message: `These required hashtags are missing: ${input.missingMandatoryHashtags
        .map((h) => `#${h}`)
        .join(", ")}.`,
    });
  }

  // ---- tags ----
  add({
    id: "tags.budget",
    label: "Tags within YouTube's limit",
    ok: input.tags.totalChars <= 500,
    severity: "warning",
    field: "tags",
    message: "Some tags were dropped to stay inside YouTube's 500-character budget.",
  });

  // ---- playlist ----
  add({
    id: "playlist.selected",
    label: "Playlist selected",
    ok: input.playlist.selected,
    severity: "error",
    field: "playlist",
    message: "Choose the playlist this video belongs to.",
  });
  if (input.playlist.selected) {
    add({
      id: "playlist.allowed",
      label: "Playlist still available",
      ok: input.playlist.allowed,
      severity: "error",
      field: "playlist",
      message:
        "The selected playlist is no longer available on YouTube. Pick another, or ask an administrator to refresh the list.",
    });
  }

  // ---- content information ----
  add({
    id: "content.program",
    label: "Programme provided",
    ok: Boolean(input.contentInfo.program?.trim()),
    severity: "warning",
    field: "program",
    message: "Adding the programme makes this much easier to find later.",
  });

  // ---- schedule ----
  if (input.schedule.mode === "SCHEDULED") {
    const at = input.schedule.at ? new Date(input.schedule.at) : null;
    add({
      id: "schedule.time",
      label: "Scheduled time is in the future",
      ok: Boolean(at && at.getTime() > Date.now()),
      severity: "error",
      field: "scheduledAt",
      message: at
        ? "The scheduled time has already passed. Choose a future time or publish now."
        : "Choose the date and time to publish.",
    });
  }

  // ---- integration & permissions ----
  add({
    id: "integration.connected",
    label: "YouTube connected",
    ok: input.integration.connected,
    severity: "error",
    message: "No Google account is connected. An administrator must connect one.",
  });
  add({
    id: "integration.scopes",
    label: "Google permissions sufficient",
    ok: input.integration.scopesOk,
    severity: "error",
    message:
      "The connected Google account is missing a required permission. An administrator should reconnect it.",
  });
  add({
    id: "integration.channel",
    label: "Channel confirmed by an administrator",
    ok: input.integration.channelConfirmed,
    severity: "error",
    message:
      "An administrator has not yet confirmed which YouTube channel to publish to. This prevents publishing to the wrong channel.",
  });
  add({
    id: "permissions.publish",
    label: "You are allowed to publish",
    ok: input.permissions.canPublish,
    severity: "error",
    message: "You do not have permission to publish. Submit for review instead.",
  });
  add({
    id: "publishing.enabled",
    label: "Production publishing enabled",
    ok: input.publishingEnabled,
    severity: "error",
    message:
      "Production publishing is switched off. An administrator must enable it before anything can go live.",
  });

  // ---- duplicate prevention (Section 26) ----
  if (input.duplicate.alreadyPublishedVideoId) {
    add({
      id: "duplicate.published",
      label: "Not already published",
      ok: false,
      severity: "error",
      message: `This submission has already been published as video ${input.duplicate.alreadyPublishedVideoId}. Publishing again would create a duplicate.`,
    });
  }
  if (input.duplicate.sameChecksumSubmissionRef) {
    add({
      id: "duplicate.checksum",
      label: "Video file not already used",
      ok: false,
      severity: "warning",
      field: "video",
      message: `An identical video file was already uploaded as ${input.duplicate.sameChecksumSubmissionRef}. Check you are not publishing the same recording twice.`,
    });
  }

  const errors = checks.filter((c) => !c.ok && c.severity === "error");
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning");

  // Submitting for review does not require publish permission, the production
  // switch, or channel confirmation — those are the publisher's problem, and
  // blocking a student on them would be confusing and unhelpful.
  const submitBlockers = errors.filter(
    (e) =>
      ![
        "permissions.publish",
        "publishing.enabled",
        "integration.channel",
        "integration.connected",
        "integration.scopes",
        "duplicate.published",
      ].includes(e.id),
  );

  return {
    checks,
    errors,
    warnings,
    readyToPublish: errors.length === 0,
    readyToSubmit: submitBlockers.length === 0,
  };
}
