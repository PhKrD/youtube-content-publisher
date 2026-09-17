import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileEdit,
  ListVideo,
  Plus,
  RefreshCw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { db } from "@/lib/db";
import { requirePrincipalPage } from "@/lib/authz";
import { getQueueStats } from "@/lib/publishing/queue";
import { getIntegration } from "@/lib/google/client";
import { analyseScopes } from "@/lib/google/scopes";
import { isPublishingEnabledGlobally } from "@/lib/env";
import { getCachedOrganization } from "@/lib/cache";
import { submissionListInclude } from "@/lib/submissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, StatCard } from "@/components/ui/misc";
import { relativeTime, truncate } from "@/lib/utils";
import { Role, SubmissionStatus } from "@/generated/prisma";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const p = await requirePrincipalPage();
  const isAdmin = p.role === Role.ADMIN;
  const canReview = isAdmin || p.role === Role.REVIEWER;

  // Contributors see only their own counts; reviewers/admins see the org's.
  const scope = canReview
    ? { organizationId: p.organizationId }
    : { organizationId: p.organizationId, createdById: p.id };

  const [counts, recent, pendingReview, queue, integration, org] = await Promise.all([
    db.submission.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    db.submission.findMany({
      where: scope,
      orderBy: { updatedAt: "desc" },
      take: 5, // Reduced from 8 for faster load
      select: {
        id: true,
        reference: true,
        computedTitle: true,
        topic: true,
        program: true,
        status: true,
        updatedAt: true,
        playlist: { select: { title: true } },
        createdBy: { select: { name: true, email: true } },
        publication: { select: { youtubeVideoId: true } },
      },
    }),
    canReview
      ? db.submission.findMany({
          where: {
            organizationId: p.organizationId,
            status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
          },
          orderBy: { submittedAt: "asc" },
          take: 3, // Reduced from 5
          select: {
            id: true,
            reference: true,
            computedTitle: true,
            topic: true,
            submittedAt: true,
            updatedAt: true,
            createdBy: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    isAdmin ? getQueueStats(p.organizationId) : Promise.resolve(null),
    isAdmin ? getIntegration(p.organizationId) : Promise.resolve(null),
    getCachedOrganization(p.organizationId),
  ]);

  const count = (s: SubmissionStatus) =>
    counts.find((c) => c.status === s)?._count._all ?? 0;

  const drafts = count(SubmissionStatus.DRAFT) + count(SubmissionStatus.UPLOADING) + count(SubmissionStatus.READY);
  const underReview = count(SubmissionStatus.SUBMITTED) + count(SubmissionStatus.UNDER_REVIEW);
  const published = count(SubmissionStatus.PUBLISHED);
  const failed = count(SubmissionStatus.FAILED);
  const changes = count(SubmissionStatus.CHANGES_REQUESTED);
  const total = counts.reduce((sum, c) => sum + c._count._all, 0);

  const scopeReport = integration ? analyseScopes(integration.scopes) : null;
  const setupIncomplete = isAdmin && !org?.setupCompletedAt;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${p.name?.split(" ")[0] ?? "there"}`}
        description={
          canReview
            ? "An overview of all content in your organisation."
            : "Create and publish your content."
        }
        actions={
          <Button asChild>
            <Link href="/content/new">
              <Plus className="size-4" aria-hidden="true" />
              Create content
            </Link>
          </Button>
        }
      />

      {/* --- things that need attention, most urgent first --- */}
      <div className="mb-6 space-y-3">
        {setupIncomplete && (
          <Alert tone="info" title="Finish setting up" icon={ShieldAlert}>
            <p>
              Connect Google, confirm your YouTube channel and create your templates before
              contributors start uploading.
            </p>
            <Button asChild size="sm" className="mt-2.5">
              <Link href="/setup">Open setup wizard</Link>
            </Button>
          </Alert>
        )}

        {isAdmin && integration && scopeReport && !scopeReport.ok && (
          <Alert tone="danger" title="Google permissions incomplete" icon={AlertTriangle}>
            The connected account did not grant every permission this app needs. Reconnect it and
            accept all requested permissions.{" "}
            <Link href="/admin/integrations" className="font-medium underline">
              Fix now
            </Link>
          </Alert>
        )}

        {isAdmin && integration?.status === "NEEDS_RECONSENT" && (
          <Alert tone="danger" title="Google connection expired" icon={AlertTriangle}>
            Publishing is paused until the Google account is reconnected. No content has been lost.{" "}
            <Link href="/admin/integrations" className="font-medium underline">
              Reconnect
            </Link>
          </Alert>
        )}

        {isAdmin && org && !org.productionPublishingEnabled && !setupIncomplete && (
          <Alert tone="warn" title="Production publishing is off" icon={ShieldAlert}>
            Content can be prepared and reviewed, but nothing will reach YouTube until you enable
            production publishing.{" "}
            <Link href="/admin/publishing" className="font-medium underline">
              Review and enable
            </Link>
          </Alert>
        )}

        {isAdmin && !isPublishingEnabledGlobally() && (
          <Alert tone="info" title="Publishing disabled at the deployment level">
            <code className="font-mono text-xs">PUBLISHING_ENABLED</code> is not{" "}
            <code className="font-mono text-xs">true</code> in this environment. Both this and the
            organisation switch must be on for content to go live.
          </Alert>
        )}

        {changes > 0 && !canReview && (
          <Alert tone="warn" title={`${changes} submission${changes === 1 ? "" : "s"} need changes`}>
            A reviewer has asked for changes.{" "}
            <Link href="/content?status=CHANGES_REQUESTED" className="font-medium underline">
              View
            </Link>
          </Alert>
        )}

        {failed > 0 && (
          <Alert tone="danger" title={`${failed} publication${failed === 1 ? "" : "s"} failed`} icon={AlertTriangle}>
            Your content is safe. Open each one to see what happened and retry.{" "}
            <Link href="/content?status=FAILED" className="font-medium underline">
              View failures
            </Link>
          </Alert>
        )}
      </div>

      {/* --- metrics --- */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total content" value={total} icon={ListVideo} href="/content" />
        <StatCard label="Drafts" value={drafts} icon={FileEdit} href="/content?status=DRAFT" />
        <StatCard
          label="Under review"
          value={underReview}
          tone={underReview > 0 ? "warn" : "neutral"}
          icon={Clock}
          href="/content?status=SUBMITTED"
        />
        <StatCard
          label="Published"
          value={published}
          tone="success"
          icon={CheckCircle2}
          href="/content?status=PUBLISHED"
        />
        <StatCard
          label="Failed"
          value={failed}
          tone={failed > 0 ? "danger" : "neutral"}
          icon={AlertTriangle}
          href="/content?status=FAILED"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- recent content --- */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Recent content</CardTitle>
            <Link href="/content" className="text-xs font-medium text-brand-600 hover:underline">
              View all
            </Link>
          </CardHeader>
          {recent.length === 0 ? (
            <EmptyState
              icon={Upload}
              title="No content yet"
              description="Upload your first video and this app will build the title, description, tags and playlist for you."
              action={
                <Button asChild>
                  <Link href="/content/new">
                    <Plus className="size-4" aria-hidden="true" />
                    Create content
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/content/${s.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {s.computedTitle
                          ? truncate(s.computedTitle, 70)
                          : s.topic || s.program || "Untitled draft"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-soft">
                        {s.reference}
                        {canReview && s.createdBy
                          ? ` · ${s.createdBy.name ?? s.createdBy.email}`
                          : ""}
                        {s.playlist ? ` · ${s.playlist.title}` : ""}
                        {` · ${relativeTime(s.updatedAt)}`}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          {/* --- review queue --- */}
          {canReview && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Pending reviews</CardTitle>
                {pendingReview.length > 0 && (
                  <Link href="/review" className="text-xs font-medium text-brand-600 hover:underline">
                    Open queue
                  </Link>
                )}
              </CardHeader>
              {pendingReview.length === 0 ? (
                <EmptyState
                  icon={ClipboardCheck}
                  title="Nothing waiting"
                  description="Submissions needing review will appear here."
                  className="py-10"
                />
              ) : (
                <ul className="divide-y divide-line">
                  {pendingReview.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/content/${s.id}`}
                        className="block px-5 py-3 transition-colors hover:bg-surface-muted"
                      >
                        <p className="truncate text-sm font-medium text-ink">
                          {s.computedTitle ? truncate(s.computedTitle, 44) : s.topic || s.reference}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-soft">
                          {s.createdBy.name ?? s.createdBy.email} ·{" "}
                          {relativeTime(s.submittedAt ?? s.updatedAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* --- admin: connected services + queue --- */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Connected services</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm">
                <ServiceRow
                  label="Google account"
                  ok={Boolean(integration && integration.status === "CONNECTED")}
                  detail={integration?.email ?? "Not connected"}
                />
                <ServiceRow
                  label="Google Drive"
                  ok={Boolean(scopeReport?.capabilities.drive)}
                  detail={scopeReport?.capabilities.drive ? "Authorised" : "Not authorised"}
                />
                <ServiceRow
                  label="YouTube"
                  ok={Boolean(scopeReport?.capabilities.youtubeUpload)}
                  detail={
                    scopeReport?.capabilities.youtubeUpload ? "Upload authorised" : "Not authorised"
                  }
                />
                <ServiceRow
                  label="Approval mode"
                  ok
                  neutral
                  detail={
                    org?.approvalMode === "APPROVAL_REQUIRED" ? "Approval required" : "Direct publish"
                  }
                />

                {queue && (
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2.5">
                    <span className="flex items-center gap-2 text-xs font-medium text-ink-soft">
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                      Publishing queue
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {queue.pending}
                    </span>
                  </div>
                )}

                <Button asChild variant="secondary" size="sm" full className="mt-3">
                  <Link href="/admin">Open settings</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ServiceRow({
  label,
  ok,
  detail,
  neutral = false,
}: {
  label: string;
  ok: boolean;
  detail: string;
  neutral?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-soft">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={
            neutral
              ? "size-2 rounded-full bg-ink-faint"
              : ok
                ? "size-2 rounded-full bg-success-600"
                : "size-2 rounded-full bg-danger-600"
          }
        />
        <span className="truncate text-xs text-ink">{detail}</span>
        {/* Never rely on the dot alone (Section 43). */}
        <span className="sr-only">{neutral ? "" : ok ? "connected" : "not connected"}</span>
      </span>
    </div>
  );
}
