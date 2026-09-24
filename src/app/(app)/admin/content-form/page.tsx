import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/authz";
import { getEditorSettings } from "@/lib/org-settings";
import { PageHeader } from "@/components/ui/misc";
import { ContentFormSettings } from "./content-form-settings";

export const metadata: Metadata = { title: "Content form & post" };

export default async function ContentFormSettingsPage() {
  const principal = await requireAdminPage();
  const { contentFields, postTemplate } = await getEditorSettings(principal.organizationId);

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
        title="Content form & post"
        description="Name the fields people fill in, in your own words, and set the default text for the YouTube post."
      />

      <ContentFormSettings initialFields={contentFields} initialPostTemplate={postTemplate} />
    </>
  );
}
