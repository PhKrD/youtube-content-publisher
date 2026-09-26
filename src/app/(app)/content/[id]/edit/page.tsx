import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { canEditSubmission, requireOrganization, requirePrincipalPage } from "@/lib/authz";
import { buildValidationReport, submissionInclude } from "@/lib/submissions";
import { canPublish } from "@/lib/authz";
import { getEditorSettings } from "@/lib/org-settings";
import { PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { ContentEditor, type EditorVariable } from "@/components/content/content-editor";
import { ApprovalMode, MediaKind } from "@/generated/prisma";

export const metadata: Metadata = { title: "Edit content" };

/** ISO date -> the `yyyy-MM-dd` an <input type="date"> expects. */
function toDateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** ISO date -> the `yyyy-MM-ddTHH:mm` a datetime-local input expects. */
function toDateTimeInput(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * YouTube's assignable category ids.
 *
 * Hard-coded rather than fetched: videoCategories.list costs quota on every
 * page render and the list has been stable for years. The ids are global.
 */
const CATEGORIES = [
  { id: "22", title: "People & Blogs" },
  { id: "27", title: "Education" },
  { id: "25", title: "News & Politics" },
  { id: "24", title: "Entertainment" },
  { id: "10", title: "Music" },
  { id: "15", title: "Pets & Animals" },
  { id: "17", title: "Sports" },
  { id: "19", title: "Travel & Events" },
  { id: "20", title: "Gaming" },
  { id: "23", title: "Comedy" },
  { id: "26", title: "Howto & Style" },
  { id: "28", title: "Science & Technology" },
  { id: "29", title: "Nonprofits & Activism" },
];

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const principal = await requirePrincipalPage();

  const submission = await db.submission.findUnique({
    where: { id },
    include: submissionInclude,
  });

  if (!submission || submission.organizationId !== principal.organizationId) notFound();

  // Frozen for editing (under review, published) — send the user to the
  // read-only detail page rather than showing inputs that cannot be saved.
  if (!canEditSubmission(principal, submission)) {
    redirect(`/content/${id}`);
  }

  const organization = await requireOrganization(principal);
  const [playlists, tagGroups, languageTemplates] = await Promise.all([
    db.playlist.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: [{ isDefault: "desc" }, { title: "asc" }],
      select: { id: true, title: true, isAllowed: true },
    }),
    db.tagGroup.findMany({
      where: { organizationId: principal.organizationId, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, tags: true, isMandatory: true },
    }),
    // Which languages this programme has templates for; the Hindi/English
    // choice is only offered when there is more than one.
    db.descriptionTemplate.findMany({
      where: {
        organizationId: principal.organizationId,
        isActive: true,
        program: submission.program,
        language: { not: null },
      },
      select: { language: true },
      distinct: ["language"],
    }),
  ]);
  const languages = languageTemplates.map((t) => t.language!);

  const [{ report, rendered }, { contentFields }] = await Promise.all([
    buildValidationReport(submission, organization, principal),
    getEditorSettings(principal.organizationId),
  ]);

  const video = submission.mediaFiles.find((m) => m.kind === MediaKind.VIDEO) ?? null;
  const thumbnail = submission.mediaFiles.find((m) => m.kind === MediaKind.THUMBNAIL) ?? null;

  const variables: EditorVariable[] = (submission.descriptionTemplate?.variables ?? []).map((v) => ({
    key: v.key,
    label: v.label,
    helpText: v.helpText,
    inputType: v.inputType,
    required: v.required,
    isLocked: v.isLocked,
    // Safe to send: these are the organisation's own published values, and
    // the contributor will see them in the finished description anyway.
    lockedValue: v.lockedValue,
    maxLength: v.maxLength,
    options: v.options,
  }));

  const templateValues = Object.fromEntries(
    Object.entries((submission.templateValues ?? {}) as Record<string, unknown>).map(([k, v]) => [
      k,
      v === null || v === undefined ? "" : String(v),
    ]),
  );

  return (
    <>
      <Link
        href={`/content/${id}`}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to details
      </Link>

      <PageHeader
        title={submission.computedTitle || submission.topic || "New content"}
        description={submission.reference}
        actions={<StatusBadge status={submission.status} />}
      />

      <ContentEditor
        submissionId={submission.id}
        reference={submission.reference}
        status={submission.status}
        canPublish={canPublish(principal)}
        approvalRequired={organization.approvalMode === ApprovalMode.APPROVAL_REQUIRED}
        channelTitle={submission.channel?.title ?? null}
        channelConfirmed={Boolean(submission.channel?.confirmedAt)}
        playlists={playlists}
        categories={CATEGORIES}
        tagGroups={tagGroups}
        variables={variables}
        languages={languages}
        media={{
          video: video
            ? {
                id: video.id,
                kind: "VIDEO",
                originalFilename: video.originalFilename,
                sizeBytes: Number(video.sizeBytes),
                mimeType: video.mimeType,
                uploadState: video.uploadState,
                driveWebViewLink: video.driveWebViewLink,
              }
            : null,
          thumbnail: thumbnail
            ? {
                id: thumbnail.id,
                kind: "THUMBNAIL",
                originalFilename: thumbnail.originalFilename,
                sizeBytes: Number(thumbnail.sizeBytes),
                mimeType: thumbnail.mimeType,
                uploadState: thumbnail.uploadState,
                width: thumbnail.width,
                height: thumbnail.height,
                driveWebViewLink: thumbnail.driveWebViewLink,
              }
            : null,
          images: submission.mediaFiles
            .filter((m) => m.kind === MediaKind.SUPPORTING_IMAGE && m.uploadState === "COMPLETED")
            .map((m) => ({
              id: m.id,
              kind: "SUPPORTING_IMAGE" as const,
              originalFilename: m.originalFilename,
              sizeBytes: Number(m.sizeBytes),
              mimeType: m.mimeType,
              uploadState: m.uploadState,
              width: m.width,
              height: m.height,
              driveWebViewLink: m.driveWebViewLink,
            })),
        }}
        fields={contentFields}
        initial={{
          postText: submission.postText,
          program: submission.program ?? "FFL",
          language: submission.language,
          descriptionOverride: submission.descriptionOverride,
          topic: submission.topic ?? "",
          speaker: submission.speaker ?? "",
          location: submission.location ?? "",
          recordedOn: toDateInput(submission.recordedOn),
          templateValues,
          playlistId: submission.playlistId ?? "",
          categoryId: submission.categoryId,
          defaultLanguage: submission.defaultLanguage,
          privacyStatus: submission.privacyStatus,
          publishMode: submission.publishMode,
          scheduledAt: toDateTimeInput(submission.scheduledAt),
          tags: submission.tags,
          madeForKids: submission.madeForKids,
        }}
        initialPreview={{
          title: rendered.title.text,
          description: rendered.description.text,
          tags: rendered.tags.tags,
          postDefault: rendered.post.defaultText,
          withPlaceholders: rendered.withPlaceholders,
        }}
        initialValidation={report}
      />
    </>
  );
}
