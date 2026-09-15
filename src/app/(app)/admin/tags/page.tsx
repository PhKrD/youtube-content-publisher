import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { TagGroupList } from "./tag-group-list";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage() {
  const principal = await requireAdminPage();

  const groups = await db.tagGroup.findMany({
    where: { organizationId: principal.organizationId },
    orderBy: [{ isMandatory: "desc" }, { sortOrder: "asc" }],
  });

  return (
    <>
      <Link
        href="/admin"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>

      <PageHeader
        title="Tags"
        description="Reusable groups of YouTube tags contributors can apply with one click."
      />

      <Alert tone="info" title="Mandatory groups" className="mb-4">
        Tags in a mandatory group are added to every publication automatically and cannot be
        removed by a contributor. They are also placed first, so if YouTube&rsquo;s 500-character
        tag budget forces anything to be dropped, your required tags are the ones that survive.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <TagGroupList
          groups={groups.map((g) => ({
            id: g.id,
            name: g.name,
            tags: g.tags,
            isMandatory: g.isMandatory,
          }))}
        />
      </Card>
    </>
  );
}
