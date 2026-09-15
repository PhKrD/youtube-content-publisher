import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { lintTemplate } from "@/lib/templates";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader } from "@/components/ui/misc";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const principal = await requireAdminPage();

  const [titleTemplates, descriptionTemplates] = await Promise.all([
    db.titleTemplate.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: { isDefault: "desc" },
      include: { variables: { orderBy: { sortOrder: "asc" } } },
    }),
    db.descriptionTemplate.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: { isDefault: "desc" },
      include: { variables: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);

  const empty = titleTemplates.length === 0 && descriptionTemplates.length === 0;

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
        title="Templates"
        description="What contributors fill in, and what is fixed by you."
      />

      {empty ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Run `npm run db:seed` to create a working title and description template, then customise them here."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Alert tone="info" title="How templates work">
            Write <code className="font-mono text-xs">{"{{PLACEHOLDER}}"}</code> anywhere in the
            text. Each placeholder becomes a field a contributor fills in — unless you{" "}
            <strong>lock</strong> it, in which case your value is always used and contributors
            cannot change or remove it. Locking is enforced on the server, not just hidden in the
            form.
          </Alert>

          {titleTemplates.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle>Title template — {t.name}</CardTitle>
              </CardHeader>
              <div className="px-5 py-4">
                <TemplateEditor
                  kind="title"
                  id={t.id}
                  value={t.pattern}
                  maxLength={t.maxLength}
                  variables={t.variables.map((v) => ({
                    id: v.id,
                    key: v.key,
                    label: v.label,
                    required: v.required,
                    isLocked: v.isLocked,
                    lockedValue: v.lockedValue,
                    helpText: v.helpText,
                  }))}
                  initialIssues={lintTemplate(t.pattern, t.variables)}
                />
              </div>
            </Card>
          ))}

          {descriptionTemplates.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle>Description template — {t.name}</CardTitle>
              </CardHeader>
              <div className="px-5 py-4">
                <TemplateEditor
                  kind="description"
                  id={t.id}
                  value={t.body}
                  variables={t.variables.map((v) => ({
                    id: v.id,
                    key: v.key,
                    label: v.label,
                    required: v.required,
                    isLocked: v.isLocked,
                    lockedValue: v.lockedValue,
                    helpText: v.helpText,
                  }))}
                  initialIssues={lintTemplate(t.body, t.variables)}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
