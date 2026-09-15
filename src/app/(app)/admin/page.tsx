import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ChevronRight,
  FileText,
  ListVideo,
  Plug,
  Rocket,
  ScrollText,
  Settings2,
  Tags,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { getIntegration } from "@/lib/google/client";
import { analyseScopes } from "@/lib/google/scopes";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminPage() {
  const principal = await requireAdminPage();

  const [org, integration, counts] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: principal.organizationId } }),
    getIntegration(principal.organizationId),
    Promise.all([
      db.user.count({ where: { organizationId: principal.organizationId, disabledAt: null } }),
      db.playlist.count({ where: { organizationId: principal.organizationId, isAllowed: true } }),
      db.descriptionTemplate.count({ where: { organizationId: principal.organizationId } }),
      db.tagGroup.count({ where: { organizationId: principal.organizationId } }),
      db.youTubeChannel.count({
        where: { organizationId: principal.organizationId, confirmedAt: { not: null } },
      }),
    ]),
  ]);

  const [userCount, playlistCount, templateCount, tagCount, confirmedChannels] = counts;
  const scopes = integration ? analyseScopes(integration.scopes) : null;

  const sections = [
    {
      href: "/admin/integrations",
      icon: Plug,
      title: "Google connection",
      description: integration
        ? `Connected as ${integration.email}`
        : "Not connected — required before publishing",
      status: integration && scopes?.ok ? "ok" : integration ? "warn" : "error",
      value: confirmedChannels > 0 ? "Channel confirmed" : "Channel not confirmed",
    },
    {
      href: "/admin/publishing",
      icon: Rocket,
      title: "Publishing",
      description:
        org.approvalMode === "APPROVAL_REQUIRED"
          ? "Approval required before publishing"
          : "Contributors publish directly",
      status: org.productionPublishingEnabled ? "ok" : "warn",
      value: org.productionPublishingEnabled ? "Production ON" : "Production OFF",
    },
    {
      href: "/admin/playlists",
      icon: ListVideo,
      title: "Playlists",
      description: "Choose which playlists contributors may use",
      status: playlistCount > 0 ? "ok" : "warn",
      value: `${playlistCount} available`,
    },
    {
      href: "/admin/templates",
      icon: FileText,
      title: "Templates",
      description: "Title and description templates, and locked sections",
      status: templateCount > 0 ? "ok" : "error",
      value: `${templateCount} description template${templateCount === 1 ? "" : "s"}`,
    },
    {
      href: "/admin/tags",
      icon: Tags,
      title: "Tags",
      description: "Reusable tag groups and mandatory tags",
      status: "neutral",
      value: `${tagCount} group${tagCount === 1 ? "" : "s"}`,
    },
    {
      href: "/admin/users",
      icon: Users,
      title: "Users and roles",
      description: "Invite people, set roles and publishing rights",
      status: "neutral",
      value: `${userCount} active`,
    },
    {
      href: "/admin/health",
      icon: Activity,
      title: "System health",
      description: "Database, Google, and the publishing queue",
      status: "neutral",
      value: "",
    },
    {
      href: "/admin/audit",
      icon: ScrollText,
      title: "Audit log",
      description: "Every action taken, and by whom",
      status: "neutral",
      value: "",
    },
    {
      href: "/admin/general",
      icon: Settings2,
      title: "General",
      description: "Organisation name, timezone and upload limits",
      status: "neutral",
      value: org.name,
    },
  ] as const;

  return (
    <>
      <PageHeader title="Settings" description={org.name} />

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.href} className="transition-shadow hover:shadow-[var(--shadow-raised)]">
            <Link href={s.href} className="flex items-start gap-3 px-4 py-4">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                <s.icon className="size-4.5 text-ink-soft" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{s.title}</p>
                  {s.status !== "neutral" && (
                    <>
                      <span
                        aria-hidden="true"
                        className={
                          s.status === "ok"
                            ? "size-2 rounded-full bg-success-600"
                            : s.status === "warn"
                              ? "size-2 rounded-full bg-warn-600"
                              : "size-2 rounded-full bg-danger-600"
                        }
                      />
                      <span className="sr-only">
                        {s.status === "ok" ? "healthy" : s.status === "warn" ? "warning" : "error"}
                      </span>
                    </>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{s.description}</p>
                {s.value && <p className="mt-1 text-xs font-medium text-ink">{s.value}</p>}
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
            </Link>
          </Card>
        ))}
      </div>
    </>
  );
}
