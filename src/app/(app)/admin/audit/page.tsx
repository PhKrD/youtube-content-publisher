import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { requireAdminPage } from "@/lib/authz";
import { listAuditLogs } from "@/lib/audit";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const principal = await requireAdminPage();
  const { action } = await searchParams;

  const logs = await listAuditLogs({
    organizationId: principal.organizationId,
    action,
    limit: 100,
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
        title="Audit log"
        description="Every significant action, who took it, and what changed."
      />

      <Card>
        {logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="Nothing recorded yet"
            description="Actions such as uploads, approvals and publications will appear here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {logs.slice(0, 100).map((log) => (
              <li key={log.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-xs font-medium text-ink">{log.action}</p>
                  <p className="text-xs text-ink-faint">{formatDateTime(log.createdAt)}</p>
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {log.actor?.name ?? log.actor?.email ?? "system"}
                  {log.entityType ? ` · ${log.entityType}` : ""}
                  {log.entityId ? ` ${log.entityId.slice(0, 10)}…` : ""}
                </p>

                <div className="mt-1 flex flex-wrap gap-1.5">
                  {log.result !== "SUCCESS" && <Badge tone="danger">{log.result}</Badge>}
                  {log.youtubeVideoId && (
                    <Badge tone="info">video {log.youtubeVideoId}</Badge>
                  )}
                  {log.driveFileId && <Badge tone="neutral">drive file</Badge>}
                  {log.ipAddress && <Badge tone="neutral">{log.ipAddress}</Badge>}
                </div>

                {log.errorMessage && (
                  <p className="mt-1 text-xs text-danger-700">{log.errorMessage}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-3 text-center text-xs text-ink-faint">
        Showing the 100 most recent entries.
      </p>
    </>
  );
}
