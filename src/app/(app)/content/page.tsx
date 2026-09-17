import type { Metadata } from "next";
import { ExternalLink, LibraryBig, Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { canReview, requirePrincipalPage } from "@/lib/authz";
import { submissionListInclude } from "@/lib/submissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { relativeTime, truncate } from "@/lib/utils";
import { SubmissionStatus, type Prisma } from "@/generated/prisma";
import { ContentList } from "@/components/content/content-list";

export const metadata: Metadata = { title: "Content" };

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
  const statuses = statusesFromParam?.length ? statusesFromParam : undefined;

  const search = q?.trim();
  const where: Prisma.SubmissionWhereInput = {
    organizationId: principal.organizationId,
    ...ownership,
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...(search
      ? {
          OR: [
            { computedTitle: { contains: search, mode: "insensitive" } },
            { program: { contains: search, mode: "insensitive" } },
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
    take: 30, // Reduced from 60 for faster initial load
    select: {
      id: true,
      reference: true,
      computedTitle: true,
      topic: true,
      program: true,
      status: true,
      updatedAt: true,
      ...submissionListInclude,
    },
  });

  return (
    <ContentList
      initialItems={items}
      initialTab={tab}
      initialSearch={search ?? ""}
      initialMine={mine ?? ""}
      isReviewer={reviewer}
    />
  );
}
