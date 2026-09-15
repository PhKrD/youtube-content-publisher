import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, X } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { env, isPublishingEnabledGlobally } from "@/lib/env";
import { getIntegration } from "@/lib/google/client";
import { analyseScopes } from "@/lib/google/scopes";
import { getQueueStats } from "@/lib/publishing/queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, DetailRow, PageHeader } from "@/components/ui/misc";
import { ApprovalModeForm } from "./approval-mode-form";
import { ProductionSwitch } from "./production-switch";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Publishing" };

export default async function PublishingSettingsPage() {
  const principal = await requireAdminPage();

  const [org, integration, confirmedChannel, queue] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: principal.organizationId } }),
    getIntegration(principal.organizationId),
    db.youTubeChannel.findFirst({
      where: { organizationId: principal.organizationId, confirmedAt: { not: null } },
    }),
    getQueueStats(principal.organizationId),
  ]);

  const scopes = integration ? analyseScopes(integration.scopes) : null;

  /**
   * Both switches must be on. Showing them as two separate, individually
   * diagnosable gates is the point — an admin who sees only "publishing is
   * off" cannot tell which one to change.
   */
  const preconditions = [
    {
      ok: isPublishingEnabledGlobally(),
      label: 'Deployment allows publishing (PUBLISHING_ENABLED="true")',
      fix: "Set PUBLISHING_ENABLED to true in this environment and redeploy.",
    },
    {
      ok: Boolean(integration && integration.status === "CONNECTED"),
      label: "Google account connected",
      fix: "Connect a Google account on the Google connection page.",
    },
    {
      ok: Boolean(scopes?.ok),
      label: "All required Google permissions granted",
      fix: "Reconnect the Google account and accept every permission.",
    },
    {
      ok: Boolean(confirmedChannel),
      label: "YouTube channel confirmed by an administrator",
      fix: "Confirm the channel on the Google connection page.",
    },
  ];

  const canEnable = preconditions.every((p) => p.ok);

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
        title="Publishing"
        description="Who may publish, and whether anything reaches the real YouTube channel."
      />

      <div className="space-y-4">
        {/* ---------- production switch ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Production publishing</CardTitle>
            <p className="mt-1 text-xs text-ink-soft">
              The master safety switch. While this is off, content can be prepared, reviewed and
              approved, but nothing is ever sent to YouTube.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {org.productionPublishingEnabled ? (
              <Alert tone="danger" title="Production publishing is ON" icon={AlertTriangle}>
                Approved content will be uploaded to{" "}
                <strong>{confirmedChannel?.title ?? "the confirmed channel"}</strong> for real.
                {org.productionEnabledAt && ` Enabled ${formatDateTime(org.productionEnabledAt)}.`}
              </Alert>
            ) : (
              <Alert tone="info" title="Production publishing is OFF">
                Nothing will be uploaded to YouTube. This is the safe default.
              </Alert>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Requirements
              </p>
              <ul className="space-y-1.5">
                {preconditions.map((p) => (
                  <li key={p.label} className="flex items-start gap-2 text-sm">
                    {p.ok ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden="true" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden="true" />
                    )}
                    <span>
                      <span className={p.ok ? "text-ink" : "text-danger-700"}>{p.label}</span>
                      {!p.ok && <span className="block text-xs text-ink-soft">{p.fix}</span>}
                      <span className="sr-only">{p.ok ? " satisfied" : " not satisfied"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <ProductionSwitch
              enabled={org.productionPublishingEnabled}
              canEnable={canEnable}
              channelTitle={confirmedChannel?.title ?? null}
            />
          </CardContent>
        </Card>

        {/* ---------- approval mode (Section 27) ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Approval workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <ApprovalModeForm current={org.approvalMode} />
          </CardContent>
        </Card>

        {/* ---------- queue ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Publishing queue</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-line">
              <DetailRow label="Waiting">{queue.queued}</DetailRow>
              <DetailRow label="In progress">{queue.running}</DetailRow>
              <DetailRow label="Waiting to retry">{queue.waitingRetry}</DetailRow>
              <DetailRow label="Failed">{queue.failed}</DetailRow>
              <DetailRow label="Completed">{queue.succeeded}</DetailRow>
              <DetailRow label="Oldest still pending">
                {queue.oldestPendingAt ? formatDateTime(queue.oldestPendingAt) : "—"}
              </DetailRow>
            </dl>

            {queue.pending > 0 && (
              <Alert tone="info" className="mt-3">
                A worker must be running for the queue to drain — either{" "}
                <code className="font-mono text-xs">npm run worker</code> or a scheduler calling{" "}
                <code className="font-mono text-xs">/api/jobs/tick</code>. See DEPLOYMENT.md.
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* ---------- environment ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-line">
              <DetailRow label="APP_ENV">{env.APP_ENV}</DetailRow>
              <DetailRow label="PUBLISHING_ENABLED">
                {String(isPublishingEnabledGlobally())}
              </DetailRow>
              <DetailRow label="Timezone">{org.timezone}</DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
