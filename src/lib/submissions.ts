import { db } from "./db";
import { isPublishingEnabledGlobally } from "./env";
import {
  findMissingHashtags,
  renderDescription,
  renderTitle,
  renderTemplateWithPlaceholders,
  resolveTags,
  resolveValue,
  extractHashtags,
} from "./templates";
import { getEditorSettings } from "./org-settings";
import { programDisplayName } from "./programs";
import { renderPostText } from "./post-pack";
import { validateSubmission, type ValidationInput, type ValidationReport } from "./validation";
import { analyseScopes } from "./google/scopes";
import { getIntegration } from "./google/client";
import { canPublish, type Principal } from "./authz";
import {
  MediaKind,
  UploadState,
  type MediaFile,
  type Organization,
  type Playlist,
  type Program,
  type Submission,
  type TemplateVariable,
  type YouTubeChannel,
  type YouTubePublication,
} from "@/generated/prisma";

/**
 * Submission service: the single place where a submission's final YouTube
 * metadata is derived.
 *
 * Both the "preview" endpoint and the publish path call `renderSubmission`,
 * which is what guarantees the description a reviewer approved is byte-for-byte
 * what gets published. Locked template values are read from the template
 * definition here, so a tampered request body cannot influence them.
 */

/**
 * The title and description templates for a programme: its own templates if
 * an admin has created them, otherwise the organisation's general ones.
 */
export async function findTemplatesForProgram(organizationId: string, program: Program) {
  const pick = async <T>(find: (where: { program: Program | null }) => Promise<T | null>) =>
    (await find({ program })) ?? (await find({ program: null }));
  const base = { organizationId, isActive: true };
  const [titleTemplate, descriptionTemplate] = await Promise.all([
    pick((p) =>
      db.titleTemplate.findFirst({ where: { ...base, ...p }, orderBy: { isDefault: "desc" } }),
    ),
    pick((p) =>
      db.descriptionTemplate.findFirst({ where: { ...base, ...p }, orderBy: { isDefault: "desc" } }),
    ),
  ]);
  return { titleTemplate, descriptionTemplate };
}

/** Allocates the next human-readable reference, e.g. SUB-000042. */
export async function nextReference(): Promise<string> {
  const rows = await db.$queryRaw<{ v: bigint }[]>`
    SELECT nextval('submission_reference_seq') AS v
  `;
  const n = Number(rows[0]?.v ?? 1);
  return `SUB-${String(n).padStart(6, "0")}`;
}

export type SubmissionWithRelations = Submission & {
  mediaFiles: MediaFile[];
  playlist: Playlist | null;
  channel: YouTubeChannel | null;
  publication: YouTubePublication | null;
  titleTemplate: ({ variables: TemplateVariable[] } & { pattern: string; maxLength: number }) | null;
  descriptionTemplate: ({ variables: TemplateVariable[] } & { body: string }) | null;
};

export interface RenderedSubmission {
  title: ReturnType<typeof renderTitle>;
  description: ReturnType<typeof renderDescription>;
  tags: ReturnType<typeof resolveTags>;
  missingMandatoryHashtags: string[];
  post: {
    /** The organisation's default post text for this submission. */
    defaultText: string;
    /** What will actually be posted: the contributor's text, or the default. */
    text: string;
  };
  /** Version with placeholders visible (e.g., [SPEAKER] instead of actual name) */
  withPlaceholders: {
    title: string;
    description: string;
  };
}

/**
 * Renders the final title, description and tags.
 *
 * `templateValues` is contributor input and is treated as untrusted — every
 * locked variable is substituted from `lockedValue` regardless of what it
 * contains (see templates.resolveValue).
 */
export async function renderSubmission(
  submission: SubmissionWithRelations,
): Promise<RenderedSubmission> {
  const values = (submission.templateValues ?? {}) as Record<string, unknown>;

  // Fill in the structured content fields so a template can reference them
  // without the contributor retyping them.
  const merged: Record<string, unknown> = {
    TOPIC: submission.topic ?? "",
    SPEAKER_NAME: submission.speaker ?? "",
    LOCATION: submission.location ?? "",
    DATE: submission.recordedOn
      ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(submission.recordedOn)
      : "",
    // e.g. २६/०९/२०२६. UTC because a date input is stored as UTC midnight.
    DATE_HI: submission.recordedOn
      ? new Intl.DateTimeFormat("hi-IN-u-nu-deva", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "UTC",
        }).format(submission.recordedOn)
      : "",
    ...values,
    PROGRAM_NAME: programDisplayName(submission.program, values),
  };

  const title = submission.titleTemplate
    ? renderTitle(
        submission.titleTemplate.pattern,
        submission.titleTemplate.variables,
        merged,
        submission.titleTemplate.maxLength,
      )
    : renderTitle("{{TITLE}}", [], { TITLE: submission.titleOverride ?? "" });

  // A manual override wins over the pattern, when the org allows one.
  const effectiveTitle = submission.titleOverride
    ? renderTitle("{{TITLE}}", [], { TITLE: submission.titleOverride })
    : title;

  const description = submission.descriptionTemplate
    ? renderDescription(
        submission.descriptionTemplate.body,
        submission.descriptionTemplate.variables,
        merged,
      )
    : renderDescription("{{MAIN_DESCRIPTION}}", [], merged);

  // Generate placeholder versions for preview
  const titleWithPlaceholders = submission.titleTemplate
    ? renderTemplateWithPlaceholders(
        submission.titleTemplate.pattern,
        submission.titleTemplate.variables,
      )
    : "[TITLE]";

  const descriptionWithPlaceholders = submission.descriptionTemplate
    ? renderTemplateWithPlaceholders(
        submission.descriptionTemplate.body,
        submission.descriptionTemplate.variables,
      )
    : "[MAIN_DESCRIPTION]";

  const [mandatoryGroups, settings] = await Promise.all([
    db.tagGroup.findMany({
      where: { organizationId: submission.organizationId, isMandatory: true, isActive: true },
    }),
    getEditorSettings(submission.organizationId),
  ]);
  const mandatoryTags = mandatoryGroups.flatMap((g) => g.tags);

  // Post text sees everything the templates see, with locked values applied
  // exactly as they are for the description.
  const postValues: Record<string, string> = Object.fromEntries(
    Object.entries(merged).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]),
  );
  for (const v of [
    ...(submission.titleTemplate?.variables ?? []),
    ...(submission.descriptionTemplate?.variables ?? []),
  ]) {
    postValues[v.key] = resolveValue(v, merged).value;
  }
  postValues.TITLE = effectiveTitle.text;
  if (submission.publication?.youtubeUrl) postValues.VIDEO_URL = submission.publication.youtubeUrl;
  const post = {
    defaultText: renderPostText(settings.postTemplate, postValues),
    text: renderPostText(submission.postText ?? settings.postTemplate, postValues),
  };

  const tags = resolveTags(submission.tags, mandatoryTags);

  // Hashtags that must survive into the published description. Taken from the
  // locked HASHTAGS variable when the template defines one.
  const lockedHashtagVar = submission.descriptionTemplate?.variables.find(
    (v) => v.key === "HASHTAGS" && v.isLocked,
  );
  const requiredHashtags = lockedHashtagVar?.lockedValue
    ? extractHashtags(lockedHashtagVar.lockedValue)
    : [];

  return {
    title: effectiveTitle,
    description,
    tags,
    missingMandatoryHashtags: findMissingHashtags(description.text, requiredHashtags),
    post,
    withPlaceholders: {
      title: titleWithPlaceholders,
      description: descriptionWithPlaceholders,
    },
  };
}

/** Assembles everything `validateSubmission` needs. */
export async function buildValidationReport(
  submission: SubmissionWithRelations,
  organization: Organization,
  principal: Principal,
): Promise<{ report: ValidationReport; rendered: RenderedSubmission }> {
  const [rendered, settings] = await Promise.all([
    renderSubmission(submission),
    getEditorSettings(submission.organizationId),
  ]);

  const video = submission.mediaFiles.find((m) => m.kind === MediaKind.VIDEO);
  const thumbnail = submission.mediaFiles.find((m) => m.kind === MediaKind.THUMBNAIL);

  const integration = await getIntegration(submission.organizationId);
  const scopes = integration ? analyseScopes(integration.scopes) : null;

  // Warn if this exact file was already uploaded under another submission.
  let sameChecksumRef: string | null = null;
  if (video?.checksumSha256) {
    const other = await db.mediaFile.findFirst({
      where: {
        organizationId: submission.organizationId,
        checksumSha256: video.checksumSha256,
        submissionId: { not: submission.id },
        uploadState: UploadState.COMPLETED,
      },
      include: { submission: { select: { reference: true } } },
    });
    sameChecksumRef = other?.submission.reference ?? null;
  }

  const input: ValidationInput = {
    video: video
      ? {
          present: true,
          uploadComplete: video.uploadState === UploadState.COMPLETED,
          mimeType: video.mimeType,
          sizeBytes: Number(video.sizeBytes),
          filename: video.originalFilename,
        }
      : { present: false, uploadComplete: false },
    thumbnail: thumbnail
      ? {
          present: true,
          uploadComplete: thumbnail.uploadState === UploadState.COMPLETED,
          mimeType: thumbnail.mimeType,
          sizeBytes: Number(thumbnail.sizeBytes),
          width: thumbnail.width ?? undefined,
          height: thumbnail.height ?? undefined,
        }
      : { present: false, uploadComplete: false },
    title: {
      text: rendered.title.text,
      tooLong: rendered.title.tooLong,
      length: rendered.title.length,
      forbiddenChars: rendered.title.forbiddenChars,
    },
    description: {
      text: rendered.description.text,
      tooLong: rendered.description.tooLong,
      length: rendered.description.length,
      forbiddenChars: rendered.description.forbiddenChars,
      missingVariables: [
        ...rendered.title.missing.map((m) => ({ key: m.key, label: m.label })),
        ...rendered.description.missing.map((m) => ({ key: m.key, label: m.label })),
      ],
      unknownPlaceholders: [
        ...rendered.title.unknownPlaceholders,
        ...rendered.description.unknownPlaceholders,
      ],
    },
    tags: { tags: rendered.tags.tags, totalChars: rendered.tags.totalChars },
    missingMandatoryHashtags: rendered.missingMandatoryHashtags,
    playlist: {
      selected: Boolean(submission.playlistId),
      allowed: submission.playlist?.isAllowed ?? false,
      title: submission.playlist?.title,
    },
    contentInfo: {
      program: programDisplayName(
        submission.program,
        (submission.templateValues ?? {}) as Record<string, unknown>,
      ),
      topic: submission.topic,
      speaker: submission.speaker,
      programLabel: settings.contentFields.program.label,
      programHidden: settings.contentFields.program.hidden,
    },
    schedule: { mode: submission.publishMode, at: submission.scheduledAt },
    integration: {
      connected: Boolean(integration && integration.status === "CONNECTED"),
      channelConfirmed: Boolean(submission.channel?.confirmedAt),
      scopesOk: Boolean(scopes?.ok),
    },
    permissions: { canPublish: canPublish(principal) },
    duplicate: {
      sameChecksumSubmissionRef: sameChecksumRef,
      alreadyPublishedVideoId: submission.publication?.youtubeVideoId ?? null,
    },
    limits: {
      maxVideoBytes: Number(organization.maxVideoBytes),
      maxThumbnailBytes: Number(organization.maxThumbnailBytes),
    },
    // Both gates must be on for the check to pass.
    publishingEnabled: isPublishingEnabledGlobally() && organization.productionPublishingEnabled,
  };

  return { report: validateSubmission(input), rendered };
}

/**
 * Freezes the rendered metadata onto the submission.
 *
 * Called on submit and again immediately before publishing, so that what a
 * reviewer saw is what YouTube receives — and so a later template edit cannot
 * retroactively change an already-approved description.
 */
export async function persistRenderedMetadata(
  submission: SubmissionWithRelations,
): Promise<{ computedTitle: string; computedDescription: string; tags: string[] }> {
  const rendered = await renderSubmission(submission);
  const data = {
    computedTitle: rendered.title.text,
    computedDescription: rendered.description.text,
    tags: rendered.tags.tags,
  };
  await db.submission.update({ where: { id: submission.id }, data });
  return data;
}

/** The relation set the render/validate helpers require. */
export const submissionInclude = {
  mediaFiles: true,
  playlist: true,
  channel: true,
  publication: true,
  titleTemplate: { include: { variables: { orderBy: { sortOrder: "asc" } } } },
  descriptionTemplate: { include: { variables: { orderBy: { sortOrder: "asc" } } } },
} as const;
