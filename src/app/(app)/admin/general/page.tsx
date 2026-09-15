import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { GeneralForm } from "./general-form";

export const metadata: Metadata = { title: "General" };

export default async function GeneralSettingsPage() {
  const principal = await requireAdminPage();
  const org = await db.organization.findUniqueOrThrow({
    where: { id: principal.organizationId },
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

      <PageHeader title="General" description="Organisation details and upload limits." />

      <Card>
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
        </CardHeader>
        <div className="px-5 py-4">
          <GeneralForm
            initial={{
              name: org.name,
              timezone: org.timezone,
              maxVideoMb: Math.round(Number(org.maxVideoBytes) / (1024 * 1024)),
              maxThumbnailKb: Math.round(Number(org.maxThumbnailBytes) / 1024),
            }}
          />
        </div>
      </Card>
    </>
  );
}
