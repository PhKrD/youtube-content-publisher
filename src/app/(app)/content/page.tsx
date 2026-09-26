import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, LibraryBig, Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { canReview, requirePrincipalPage } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, relativeTime, truncate } from "@/lib/utils";
import { SubmissionStatus, type Prisma } from "@/generated/prisma";

export const metadata: Metadata = { title: "Content" };

/** Library tabs (Section 31). */
const TABS: { key: string; label: string; statuses?: SubmissionStatus[] }[] = [
  { key: "all", label: "All" },
  {
    key: "drafts",
    label: "Drafts",
    statuses: [
      SubmissionStatus.DRAFT,
      SubmissionStatus.UPLOADING,
      SubmissionStatus.UPLOADED_TO_DRIVE,
      SubmissionStatus.READY,
    ],
  },
  {
    key: "review",
    label: "Under review",
    statuses: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW],
  },
  { key: "changes", label: "Changes required", statuses: [SubmissionStatus.CHANGES_REQUESTED] },
  { key: "approved", label: "Approved", statuses: [SubmissionStatus.APPROVED] },
  { key: "published", label: "Published", statuses: [SubmissionStatus.PUBLISHED] },
  { key: "failed", label: "Failed", statuses: [SubmissionStatus.FAILED] },
  { key: "archived", label: "Archived", statuses: [SubmissionStatus.ARCHIVED] },
];

const TAB_STYLES: Record<string, { active: string; idle: string }> = {
  all: { active: "bg-brand-600 text-white shadow-sm", idle: "bg-brand-50 text-brand-700 hover:bg-brand-100" },
  drafts: { active: "bg-info-600 text-white shadow-sm", idle: "bg-info-50 text-info-600 hover:bg-info-200/60" },
  review: { active: "bg-warn-600 text-white shadow-sm", idle: "bg-warn-50 text-warn-700 hover:bg-warn-200/60" },
  changes: { active: "bg-danger-600 text-white shadow-sm", idle: "bg-danger-50 text-danger-700 hover:bg-danger-200/60" },
  approved: { active: "bg-success-600 text-white shadow-sm", idle: "bg-success-50 text-success-700 hover:bg-success-200/60" },
  published: { active: "bg-success-700 text-white shadow-sm", idle: "bg-success-50 text-success-700 hover:bg-success-200/60" },
  failed: { active: "bg-danger-700 text-white shadow-sm", idle: "bg-danger-50 text-danger-700 hover:bg-danger-200/60" },
  archived: { active: "bg-ink-soft text-white shadow-sm", idle: "bg-surface-muted text-ink-soft hover:bg-line" },
};

export default async function ContentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; mine?: string }>;
}) {
  const principal = await requirePrincipalPage();
  const { tab = "all", q, status, mine } = await searchParams;

  const reviewer = canReview(principal);

  // A contributor is confined to their own submissions regardless of the
  // query string; the filter is not derived from client input.
  const ownership: Prisma.SubmissionWhereInput = reviewer
    ? mine === "1"
      ? { createdById: principal.id }
      : {}
    : { createdById: principal.id };

  // A `status` query param (used by the dashboard cards) wins over the tab.
  const statusesFromParam = status
    ?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is SubmissionStatus =>
      Object.values(SubmissionStatus).includes(s as SubmissionStatus),
    );
  const activeTab = statusesFromParam?.length ? undefined : TABS.find((t) => t.key === tab);
  const statuses = statusesFromParam?.length ? statusesFromParam : activeTab?.statuses;

  const search = q?.trim();
  const where: Prisma.SubmissionWhereInput = {
    organizationId: principal.organizationId,
    ...ownership,
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...(search
      ? {
          OR: [
            { computedTitle: { contains: search, mode: "insensitive" } },
            { topic: { contains: search, mode: "insensitive" } },
            { speaker: { contains: search, mode: "insensitive" } },
            { reference: { contains: search, mode: "insensitive" } },
            { publication: { youtubeVideoId: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const items = await db.submission.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 60,
    include: {
      playlist: { select: { title: true } },
      createdBy: { select: { name: true, email: true } },
      publication: { select: { youtubeVideoId: true, youtubeUrl: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Content"
        description={reviewer ? "All content in your organisation." : "Your content."}
        actions={
          <Button asChild>
            <Link href="/content/new">
              <Plus className="size-4" aria-hidden="true" />
              Create
            </Link>
          </Button>
        }
      />

      {/* --- search (Section 32) --- */}
      <form className="mb-4 flex flex-wrap gap-2" action="/content" method="get">
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Search title, programme, speaker, reference or YouTube ID…"
            aria-label="Search content"
            className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-brand-600"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {reviewer && (
          <Button asChild variant={mine === "1" ? "primary" : "ghost"} size="md">
            <Link href={`/content?tab=${tab}${mine === "1" ? "" : "&mine=1"}`}>Only mine</Link>
          </Button>
        )}
      </form>

      {/* --- tabs --- */}
      <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const active = !statusesFromParam?.length && t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/content?tab=${t.key}${search ? `&q=${encodeURIComponent(search)}` : ""}${mine === "1" ? "&mine=1" : ""}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border border-white/70 px-3.5 py-1.5 text-xs font-semibold transition-all",
                active ? TAB_STYLES[t.key]!.active : TAB_STYLES[t.key]!.idle,
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={LibraryBig}
            title={search ? "Nothing matched that search" : "No content here yet"}
            description={
              search
                ? "Try a different word, or search by reference (e.g. SUB-000001)."
                : "Content you create will appear here."
            }
            action={
              !search && (
                <Button asChild>
                  <Link href="/content/new">
                    <Plus className="size-4" aria-hidden="true" />
                    Create content
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((s) => (
              <li key={s.id}>
                <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted sm:px-5">
                  <Link href={`/content/${s.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {s.computedTitle
                        ? truncate(s.computedTitle, 80)
                        : s.topic || s.program || "Untitled draft"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-soft">
                      {s.reference}
                      {reviewer ? ` · ${s.createdBy.name ?? s.createdBy.email}` : ""}
                      {s.playlist ? ` · ${s.playlist.title}` : ""}
                      {` · updated ${relativeTime(s.updatedAt)}`}
                    </p>
                  </Link>

                  {s.publication?.youtubeUrl && (
                    <a
                      href={s.publication.youtubeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-ink-faint hover:text-ink"
                      aria-label="Open on YouTube"
                    >
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  )}
                  <StatusBadge status={s.status} className="shrink-0" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {items.length === 60 && (
        <p className="mt-3 text-center text-xs text-ink-faint">
          Showing the 60 most recently updated. Use search to narrow it down.
        </p>
      )}
    </>
  );
}
