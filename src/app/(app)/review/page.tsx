import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { canReview, requirePrincipalPage } from "@/lib/authz";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { relativeTime, truncate } from "@/lib/utils";
import { SubmissionStatus } from "@/generated/prisma";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueuePage() {
  const principal = await requirePrincipalPage();
  if (!canReview(principal)) redirect("/dashboard?denied=review");

  const items = await db.submission.findMany({
    where: {
      organizationId: principal.organizationId,
      status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
    },
    // Oldest first: a review queue should be fair, not a stack.
    orderBy: { submittedAt: "asc" },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      playlist: { select: { title: true } },
      mediaFiles: { select: { kind: true, uploadState: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Submissions waiting for a decision, oldest first."
      />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Nothing waiting for review"
            description="When a contributor submits content, it will appear here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((s) => {
              // Reviewers cannot approve their own work; say so up front
              // rather than letting them open it and hit an error.
              const isOwn = s.createdById === principal.id;
              return (
                <li key={s.id}>
                  <Link
                    href={`/content/${s.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {s.computedTitle ? truncate(s.computedTitle, 80) : s.topic || s.reference}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-soft">
                        {s.reference} · {s.createdBy.name ?? s.createdBy.email}
                        {s.playlist ? ` · ${s.playlist.title}` : ""}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-faint">
                        <Clock className="size-3" aria-hidden="true" />
                        submitted {relativeTime(s.submittedAt ?? s.updatedAt)}
                        {isOwn && (
                          <span className="ml-1 text-warn-700">
                            · your own submission — another reviewer must approve it
                          </span>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={s.status} className="shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
