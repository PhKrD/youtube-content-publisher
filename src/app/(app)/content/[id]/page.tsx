import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  FileVideo,
  ImageIcon,
  Pencil,
  Rocket,
} from "lucide-react";
import { db } from "@/lib/db";
import {
  canDeletePublishedMedia,
  canEditSubmission,
  canPublish,
  canPublishSubmission,
  canRetryPublish,
  canReviewSubmission,
  requireOrganization,
  requirePrincipalPage,
} from "@/lib/authz";
import { buildValidationReport, submissionInclude } from "@/lib/submissions";
import { getEditorSettings } from "@/lib/org-settings";
import { PostPack } from "@/components/content/post-pack";
import { DeleteDriveMedia } from "@/components/content/delete-drive-media";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert, DetailRow, PageHeader } from "@/components/ui/misc";
import { PublishProgress } from "@/components/content/publish-progress";
import { ValidationChecklist } from "@/components/content/validation-checklist";
import { ReviewPanel } from "@/components/content/review-panel";
import { PublishButton } from "@/components/content/publish-button";
import { Timeline } from "@/components/content/timeline";
import { formatBytes, formatDate, formatDateTime } from "@/lib/utils";
import { ApprovalMode, MediaKind, SubmissionStatus } from "@/generated/prisma";

export const metadata: Metadata = { title: "Content" };

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const principal = await requirePrincipalPage();

  const submission = await db.submission.findUnique({
    where: { id },
    include: {
      ...submissionInclude,
      createdBy: { select: { id: true, name: true, email: true, image: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true, email: true, image: true } } },
      },
      events: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!submission || submission.organizationId !== principal.organizationId) notFound();

  // Contributors may only view their own work.
  const isOwner = submission.createdById === principal.id;
  const isReviewerOrAdmin = principal.role === "ADMIN" || principal.role === "REVIEWER";
  if (!isOwner && !isReviewerOrAdmin) notFound();

  const organization = await requireOrganization(principal);
  const [{ report, rendered }, { contentFields }, postedBy] = await Promise.all([
    buildValidationReport(submission, organization, principal),
    getEditorSettings(principal.organizationId),
    submission.postPostedById
      ? db.user.findUnique({
          where: { id: submission.postPostedById },
          select: { name: true, email: true },
        })
      : Promise.resolve(null),
  ]);

  const approvalRequired = organization.approvalMode === ApprovalMode.APPROVAL_REQUIRED;
  const video = submission.mediaFiles.find((m) => m.kind === MediaKind.VIDEO);
  const thumbnail = submission.mediaFiles.find((m) => m.kind === MediaKind.THUMBNAIL);
  const images = submission.mediaFiles.filter(
    (m) => m.kind === MediaKind.SUPPORTING_IMAGE && m.uploadState === "COMPLETED",
  );

  const mayEdit = canEditSubmission(principal, submission);
  const mayReview = canReviewSubmission(principal, submission);
  const mayPublish = canPublishSubmission(principal, submission, approvalRequired);
  const mayRetry = canRetryPublish(principal, submission);

  const isPublishing =
    submission.status === SubmissionStatus.PUBLISHING ||
    submission.status === SubmissionStatus.FAILED ||
    submission.status === SubmissionStatus.PUBLISHED;

  return (
    <>
      <Link
        href="/content"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All content
      </Link>

      <PageHeader
        title={submission.computedTitle || rendered.title.text || submission.topic || "Untitled"}
        description={`${submission.reference} · created by ${
          submission.createdBy.name ?? submission.createdBy.email
        }`}
        actions={
          <>
            <StatusBadge status={submission.status} />
            {mayEdit && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/content/${id}/edit`}>
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {submission.publication?.youtubeUrl && (
            <Alert tone="success" title="Published to YouTube">
              <a
                href={submission.publication.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium underline"
              >
                {submission.publication.youtubeUrl}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </Alert>
          )}

          {/* --- publishing progress / recovery --- */}
          {isPublishing && (
            <Card>
              <CardHeader>
                <CardTitle>Publishing</CardTitle>
              </CardHeader>
              <CardContent>
                <PublishProgress
                  submissionId={id}
                  canRetry={mayRetry}
                  hasThumbnail={Boolean(thumbnail)}
                  hasPlaylist={Boolean(submission.playlistId)}
                  channelTitle={submission.channel?.title ?? null}
                />
              </CardContent>
            </Card>
          )}

          {/* --- reviewer actions --- */}
          {mayReview && (
            <ReviewPanel
              submissionId={id}
              status={submission.status}
              title={submission.computedTitle ?? rendered.title.text}
            />
          )}

          {/* --- latest review feedback, for the author --- */}
          {submission.reviews.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Review history</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {submission.reviews.map((r) => (
                  <div key={r.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-ink">
                        {r.decision === "APPROVED"
                          ? "Approved"
                          : r.decision === "CHANGES_REQUESTED"
                            ? "Changes requested"
                            : "Rejected"}
                      </p>
                      <p className="text-xs text-ink-faint">{formatDateTime(r.createdAt)}</p>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {r.reviewer.name ?? r.reviewer.email}
                    </p>
                    {r.comment && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{r.comment}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* --- final review: exactly what will be published (Section 22) --- */}
          <Card>
            <CardHeader>
              <CardTitle>What will be published</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-line">
                <DetailRow label="Title">
                  {submission.computedTitle || rendered.title.text || "—"}
                </DetailRow>
                <DetailRow label="Channel">
                  {submission.channel?.title ?? "Not configured"}
                  {submission.channel && !submission.channel.confirmedAt && (
                    <span className="ml-2 text-xs text-warn-700">(not confirmed)</span>
                  )}
                </DetailRow>
                <DetailRow label="Playlist">{submission.playlist?.title ?? "None"}</DetailRow>
                <DetailRow label="Visibility">
                  {submission.publishMode === "SCHEDULED"
                    ? `Scheduled — ${formatDateTime(submission.scheduledAt)}`
                    : submission.privacyStatus.toLowerCase()}
                </DetailRow>
                <DetailRow label="Tags">
                  {rendered.tags.tags.length > 0 ? rendered.tags.tags.join(", ") : "None"}
                </DetailRow>
                {!contentFields.program.hidden && (
                  <DetailRow label={contentFields.program.label}>{submission.program ?? "—"}</DetailRow>
                )}
                {!contentFields.topic.hidden && (
                  <DetailRow label={contentFields.topic.label}>{submission.topic ?? "—"}</DetailRow>
                )}
                {!contentFields.speaker.hidden && (
                  <DetailRow label={contentFields.speaker.label}>{submission.speaker ?? "—"}</DetailRow>
                )}
                {!contentFields.recordedOn.hidden && (
                  <DetailRow label={contentFields.recordedOn.label}>
                    {formatDate(submission.recordedOn)}
                  </DetailRow>
                )}
                {!contentFields.location.hidden && (
                  <DetailRow label={contentFields.location.label}>{submission.location ?? "—"}</DetailRow>
                )}
                <DetailRow label="Description">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-sans text-[13px] leading-relaxed">
                    {submission.computedDescription || rendered.description.text || "—"}
                  </pre>
                </DetailRow>
              </dl>
            </CardContent>
          </Card>

          {/* --- media --- */}
          <Card>
            <CardHeader>
              <CardTitle>Media</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <MediaRow
                icon={FileVideo}
                label="Video"
                file={
                  video
                    ? {
                        name: video.originalFilename,
                        meta: `${formatBytes(Number(video.sizeBytes))} · ${video.uploadState.toLowerCase()}`,
                        link: video.driveWebViewLink,
                      }
                    : null
                }
              />
              <MediaRow
                icon={ImageIcon}
                label="Thumbnail"
                file={
                  thumbnail
                    ? {
                        name: thumbnail.originalFilename,
                        meta: `${formatBytes(Number(thumbnail.sizeBytes))}${
                          thumbnail.width ? ` · ${thumbnail.width}×${thumbnail.height}` : ""
                        }`,
                        link: thumbnail.driveWebViewLink,
                      }
                    : null
                }
              />
              {images.map((img, i) => (
                <MediaRow
                  key={img.id}
                  icon={ImageIcon}
                  label={`Image ${i + 1}`}
                  file={{
                    name: img.originalFilename,
                    meta: `${formatBytes(Number(img.sizeBytes))}${
                      img.width ? ` · ${img.width}×${img.height}` : ""
                    }`,
                    link: img.driveWebViewLink,
                  }}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* --- sidebar --- */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {(mayPublish || mayRetry) && submission.status !== SubmissionStatus.PUBLISHED && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Rocket className="size-4 text-danger-600" aria-hidden="true" />
                  Publish
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PublishButton
                  submissionId={id}
                  channelTitle={submission.channel?.title ?? null}
                  playlistTitle={submission.playlist?.title ?? null}
                  title={submission.computedTitle ?? rendered.title.text}
                  scheduledAt={
                    submission.publishMode === "SCHEDULED"
                      ? submission.scheduledAt?.toISOString()
                      : null
                  }
                  privacyStatus={submission.privacyStatus}
                  disabled={!report.readyToPublish}
                />
                {!report.readyToPublish && (
                  <p className="mt-2 text-xs text-ink-faint">
                    {report.errors.length} item{report.errors.length === 1 ? "" : "s"} must be
                    resolved first.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {submission.status === SubmissionStatus.PUBLISHED &&
            submission.mediaFiles.length > 0 &&
            canDeletePublishedMedia(principal, submission) && (
              <DeleteDriveMedia submissionId={id} fileCount={submission.mediaFiles.length} />
            )}

          {(rendered.post.text.trim() !== "" || images.length > 0) && (
            <PostPack
              submissionId={id}
              text={rendered.post.text}
              images={images.map((img) => ({ id: img.id, name: img.originalFilename }))}
              published={Boolean(submission.publication?.youtubeUrl)}
              channelId={submission.channel?.youtubeChannelId ?? null}
              postedAt={submission.postPostedAt?.toISOString() ?? null}
              postedBy={postedBy ? (postedBy.name ?? postedBy.email) : null}
              canMarkPosted={canPublish(principal)}
            />
          )}

          {submission.status !== SubmissionStatus.PUBLISHED && (
            <Card>
              <CardHeader>
                <CardTitle>Readiness</CardTitle>
              </CardHeader>
              <CardContent>
                <ValidationChecklist report={report} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline
                events={submission.events.map((e) => ({
                  id: e.id,
                  type: e.type,
                  message: e.message,
                  actor: e.actor?.name ?? e.actor?.email ?? null,
                  createdAt: e.createdAt.toISOString(),
                }))}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function MediaRow({
  icon: Icon,
  label,
  file,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  file: { name: string; meta: string; link?: string | null } | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink-soft">{label}</p>
        {file ? (
          <>
            <p className="truncate text-sm text-ink">{file.name}</p>
            <p className="text-xs text-ink-faint">{file.meta}</p>
          </>
        ) : (
          <p className="text-sm text-ink-faint">Not uploaded</p>
        )}
      </div>
      {file?.link && (
        <a
          href={file.link}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-ink-faint hover:text-ink"
          aria-label={`Open ${label} in Google Drive`}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
