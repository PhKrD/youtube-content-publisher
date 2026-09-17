"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, LibraryBig, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { relativeTime, truncate } from "@/lib/utils";
import { SubmissionStatus } from "@/generated/prisma";

interface Submission {
  id: string;
  reference: string;
  computedTitle: string | null;
  topic: string | null;
  program: string | null;
  status: SubmissionStatus;
  updatedAt: Date;
  playlist: { title: string } | null;
  createdBy: { name: string | null; email: string } | null;
  publication: { youtubeVideoId: string | null; youtubeUrl: string | null } | null;
}

interface ContentListProps {
  initialItems: Submission[];
  initialTab: string;
  initialSearch: string;
  initialMine: string;
  isReviewer: boolean;
}

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

export function ContentList({
  initialItems,
  initialTab,
  initialSearch,
  initialMine,
  isReviewer,
}: ContentListProps) {
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState(initialSearch);
  const [mine, setMine] = useState(initialMine);
  const [isPending, startTransition] = useTransition();

  // Filter items client-side for instant tab switching
  const activeTab = TABS.find((t) => t.key === tab);
  const statuses = activeTab?.statuses;
  
  const filteredItems = initialItems.filter((item) => {
    // Status filter
    if (statuses && !statuses.includes(item.status)) return false;
    
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      const searchFields = [
        item.computedTitle,
        item.program,
        item.topic,
        item.reference,
        item.publication?.youtubeVideoId,
      ].filter(Boolean).map((f) => f!.toLowerCase());
      
      if (!searchFields.some((f) => f.includes(searchLower))) return false;
    }
    
    return true;
  });

  const handleTabChange = (newTab: string) => {
    startTransition(() => {
      setTab(newTab);
      // Update URL without full page reload
      const url = new URL(window.location.href);
      url.searchParams.set("tab", newTab);
      if (search) url.searchParams.set("q", search);
      if (mine === "1") url.searchParams.set("mine", "1");
      window.history.replaceState({}, "", url.toString());
    });
  };

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newSearch = formData.get("q") as string;
    startTransition(() => {
      setSearch(newSearch || "");
      const url = new URL(window.location.href);
      if (newSearch) {
        url.searchParams.set("q", newSearch);
      } else {
        url.searchParams.delete("q");
      }
      window.history.replaceState({}, "", url.toString());
    });
  };

  const handleMineToggle = () => {
    const newMine = mine === "1" ? "" : "1";
    startTransition(() => {
      setMine(newMine);
      const url = new URL(window.location.href);
      if (newMine === "1") {
        url.searchParams.set("mine", "1");
      } else {
        url.searchParams.delete("mine");
      }
      window.history.replaceState({}, "", url.toString());
    });
  };

  return (
    <>
      <PageHeader
        title="Content"
        description={isReviewer ? "All content in your organisation." : "Your content."}
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
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={handleSearch}>
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search title, programme, speaker, reference or YouTube ID…"
            aria-label="Search content"
            className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-brand-600"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {isReviewer && (
          <Button
            onClick={handleMineToggle}
            variant={mine === "1" ? "primary" : "ghost"}
            size="md"
          >
            Only mine
          </Button>
        )}
      </form>

      {/* --- tabs --- */}
      <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              aria-current={active ? "page" : undefined}
              disabled={isPending}
              className={
                active
                  ? "shrink-0 rounded-full bg-brand-600 px-3.5 py-1.5 text-xs font-medium text-white"
                  : "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-muted"
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <Card>
        {filteredItems.length === 0 ? (
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
            {filteredItems.map((s) => (
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
                      {isReviewer && s.createdBy ? ` · ${s.createdBy.name ?? s.createdBy.email}` : ""}
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

      {initialItems.length === 30 && (
        <p className="mt-3 text-center text-xs text-ink-faint">
          Showing the 30 most recently updated. Use search to narrow it down.
        </p>
      )}
    </>
  );
}
