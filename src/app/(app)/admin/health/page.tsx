import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db, pingDatabase } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { assertEnv, env, isGoogleOAuthConfigured, isPublishingEnabledGlobally } from "@/lib/env";
import { checkIntegrationHealth } from "@/lib/google/client";
import { getQueueStats } from "@/lib/publishing/queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { JobState } from "@/generated/prisma";

export const metadata: Metadata = { title: "System health" };

// Always measured fresh; a cached health page is worse than none.
export const dynamic = "force-dynamic";

type Level = "ok" | "warn" | "error";

interface Check {
  name: string;
  level: Level;
  detail: string;
  hint?: string;
}

export default async function HealthPage() {
  const principal = await requireAdminPage();

  const [dbPing, envCheck, integrationHealth, queue, staleJobs, org] = await Promise.all([
    pingDatabase(),
    Promise.resolve(assertEnv()),
    checkIntegrationHealth(principal.organizationId),
    getQueueStats(principal.organizationId),
    // A job that has been RUNNING past its lease means no worker is alive.
    db.publishingJob.count({
      where: {
        organizationId: principal.organizationId,
        state: JobState.RUNNING,
        leaseExpiresAt: { lt: new Date() },
      },
    }),
    db.organization.findUniqueOrThrow({ where: { id: principal.organizationId } }),
  ]);

  const checks: Check[] = [
    {
      name: "Database",
      level: dbPing.ok ? (dbPing.latencyMs > 500 ? "warn" : "ok") : "error",
      detail: dbPing.ok
        ? `Responding in ${dbPing.latencyMs} ms`
        : (dbPing.error ?? "Not reachable"),
      hint: dbPing.ok ? undefined : "Check DATABASE_URL and that the database is running.",
    },
    {
      name: "Configuration",
      level: envCheck.ok ? "ok" : "error",
      detail: envCheck.ok
        ? "All required environment variables are present and valid"
        : "Invalid environment configuration",
      hint: envCheck.ok ? undefined : envCheck.error,
    },
    {
      name: "Google OAuth credentials",
      level: isGoogleOAuthConfigured() ? "ok" : "error",
      detail: isGoogleOAuthConfigured()
        ? "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set"
        : "Not configured",
      hint: isGoogleOAuthConfigured() ? undefined : "See SETUP_GUIDE.md.",
    },
    {
      name: "Google account",
      level: integrationHealth.ok ? "ok" : "error",
      detail: integrationHealth.message,
      hint: integrationHealth.ok ? undefined : "Reconnect on the Google connection page.",
    },
    {
      name: "Publishing gate",
      level: isPublishingEnabledGlobally() && org.productionPublishingEnabled ? "ok" : "warn",
      detail: `Deployment: ${isPublishingEnabledGlobally() ? "enabled" : "disabled"} · Organisation: ${
        org.productionPublishingEnabled ? "enabled" : "disabled"
      }`,
      hint:
        isPublishingEnabledGlobally() && org.productionPublishingEnabled
          ? undefined
          : "Both must be on for content to reach YouTube. This is intentional.",
    },
    {
      name: "Publishing worker",
      level: staleJobs > 0 ? "error" : queue.pending > 0 ? "warn" : "ok",
      detail:
        staleJobs > 0
          ? `${staleJobs} job(s) have an expired lease — no worker appears to be running`
          : queue.pending > 0
            ? `${queue.pending} job(s) pending`
            : "Queue empty",
      hint:
        staleJobs > 0
          ? "Start a worker (npm run worker) or schedule /api/jobs/tick. Stalled jobs are reclaimed automatically once a worker runs."
          : undefined,
    },
    {
      name: "Failed publications",
      level: queue.failed > 0 ? "warn" : "ok",
      detail:
        queue.failed > 0
          ? `${queue.failed} failed job(s) need attention`
          : "No failed publications",
      hint: queue.failed > 0 ? "Open each submission to see the reason and retry." : undefined,
    },
  ];

  const worst: Level = checks.some((c) => c.level === "error")
    ? "error"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";

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
        title="System health"
        description={`Checked ${formatDateTime(new Date())}`}
      />

      <Card className="mb-4">
        <CardContent className="flex items-center gap-3">
          <Indicator level={worst} />
          <div>
            <p className="text-sm font-semibold text-ink">
              {worst === "ok"
                ? "Everything is healthy"
                : worst === "warn"
                  ? "Working, with warnings"
                  : "Action needed"}
            </p>
            <p className="text-xs text-ink-soft">
              {checks.filter((c) => c.level === "ok").length} of {checks.length} checks passing
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-line">
          {checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3 px-5 py-3.5">
              <span className="mt-0.5">
                <Indicator level={c.level} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{c.name}</p>
                <p className="mt-0.5 text-sm text-ink-soft">{c.detail}</p>
                {c.hint && <p className="mt-1 text-xs text-ink-faint">{c.hint}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Deployment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <Row label="Environment" value={env.APP_ENV} />
          <Row label="Log level" value={env.LOG_LEVEL} />
          <Row
            label="Relay chunk size"
            value={`${(env.RELAY_CHUNK_BYTES / (1024 * 1024)).toFixed(0)} MiB`}
          />
          <Row
            label="Oldest pending job"
            value={queue.oldestPendingAt ? relativeTime(queue.oldestPendingAt) : "—"}
          />
        </CardContent>
      </Card>
    </>
  );
}

function Indicator({ level }: { level: Level }) {
  const cls =
    level === "ok"
      ? "bg-success-600"
      : level === "warn"
        ? "bg-warn-600"
        : "bg-danger-600";
  const label = level === "ok" ? "Healthy" : level === "warn" ? "Warning" : "Error";
  return (
    <>
      <span aria-hidden="true" className={`block size-2.5 rounded-full ${cls}`} />
      <span className="sr-only">{label}</span>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-soft">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
