import type { Metadata } from "next";
import Link from "next/link";
import { Check, Circle, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { isGoogleOAuthConfigured, isPublishingEnabledGlobally } from "@/lib/env";
import { getIntegration } from "@/lib/google/client";
import { analyseScopes } from "@/lib/google/scopes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, PageHeader, Progress } from "@/components/ui/misc";
import { CompleteSetupButton } from "./complete-setup-button";
import { DriveFolderKind } from "@/generated/prisma";

export const metadata: Metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

/**
 * Setup wizard (Section 38).
 *
 * Each step reports its own real state from the database or environment —
 * nothing is a checkbox the admin ticks to say they did it. The wizard is
 * therefore resumable and honest: if someone disconnects Google later, this
 * page goes back to showing that step as incomplete.
 */
export default async function SetupPage() {
  const principal = await requireAdminPage();

  const [org, integration, channel, playlistCount, folderCount, templates, userCount] =
    await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: principal.organizationId } }),
      getIntegration(principal.organizationId),
      db.youTubeChannel.findFirst({
        where: { organizationId: principal.organizationId },
        orderBy: { isDefault: "desc" },
      }),
      db.playlist.count({ where: { organizationId: principal.organizationId } }),
      db.driveFolder.count({
        where: { organizationId: principal.organizationId, kind: DriveFolderKind.ROOT },
      }),
      Promise.all([
        db.titleTemplate.count({ where: { organizationId: principal.organizationId } }),
        db.descriptionTemplate.count({ where: { organizationId: principal.organizationId } }),
      ]),
      db.user.count({ where: { organizationId: principal.organizationId } }),
    ]);

  const [titleCount, descriptionCount] = templates;
  const scopes = integration ? analyseScopes(integration.scopes) : null;

  const steps = [
    {
      title: "Create Google Cloud credentials",
      done: isGoogleOAuthConfigured(),
      body: "Create a Google Cloud project, enable the YouTube Data API v3 and the Google Drive API, then create an OAuth client. Put the client ID and secret in your environment file.",
      action: null,
      doc: "SETUP_GUIDE.md — steps 1 to 6",
    },
    {
      title: "Connect the Google account",
      done: Boolean(integration && integration.status === "CONNECTED"),
      body: "Sign in with the Google account that owns the YouTube channel. This app never sees your password.",
      action: isGoogleOAuthConfigured()
        ? { href: "/api/integrations/google/connect?returnTo=/setup", label: "Connect Google", external: true }
        : null,
    },
    {
      title: "Grant all permissions",
      done: Boolean(scopes?.ok),
      body: "Google Drive (files created by this app), YouTube upload, and YouTube playlist management are all required.",
      action:
        integration && !scopes?.ok
          ? { href: "/api/integrations/google/connect?returnTo=/setup", label: "Reconnect", external: true }
          : null,
    },
    {
      title: "Confirm the YouTube channel",
      done: Boolean(channel?.confirmedAt),
      body: channel
        ? `Found "${channel.title}". Confirm it is the channel you want to publish to — this cannot be undone once content is live.`
        : "Connect Google first so the channel can be read.",
      action: integration ? { href: "/admin/integrations", label: "Review and confirm" } : null,
    },
    {
      title: "Create the Drive folder structure",
      done: folderCount > 0,
      body: "Folders for drafts, review, published and thumbnails are created automatically inside a folder this app owns.",
      action: null,
    },
    {
      title: "Load playlists",
      done: playlistCount > 0,
      body: "Playlists are cached so contributors can choose one without spending YouTube API quota on every page view.",
      action: integration ? { href: "/admin/playlists", label: "Manage playlists" } : null,
    },
    {
      title: "Set up templates",
      done: titleCount > 0 && descriptionCount > 0,
      body: "The title pattern and description skeleton. Lock the sections contributors must not change — official links, contact details, mandatory hashtags.",
      action: { href: "/admin/templates", label: "Edit templates" },
      doc: titleCount === 0 ? "Run `npm run db:seed` to create working defaults." : undefined,
    },
    {
      title: "Choose the approval workflow",
      done: true,
      body:
        org.approvalMode === "APPROVAL_REQUIRED"
          ? "Approval required — contributors submit, a reviewer approves, then someone publishes."
          : "Direct publish — anyone with publishing rights publishes their own content.",
      action: { href: "/admin/publishing", label: "Change workflow" },
    },
    {
      title: "Invite your team",
      done: userCount > 1,
      body: "Only invited email addresses can sign in. Publishing rights are granted separately from the contributor role.",
      action: { href: "/admin/users", label: "Invite people" },
    },
    {
      title: "Do a test run",
      done: Boolean(org.setupCompletedAt),
      body: "With production publishing still OFF, create a piece of content end to end. Nothing will reach YouTube, so it is safe to try.",
      action: { href: "/content/new", label: "Create test content" },
    },
    {
      title: "Enable production publishing",
      done: org.productionPublishingEnabled,
      body: isPublishingEnabledGlobally()
        ? "The final switch. Until this is on, nothing is ever uploaded to YouTube."
        : 'This deployment also needs PUBLISHING_ENABLED="true" in its environment.',
      action: { href: "/admin/publishing", label: "Open publishing settings" },
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <>
      <PageHeader
        title="Set up this application"
        description="Each step checks itself. You can leave and come back at any time."
      />

      <Card className="mb-5">
        <div className="px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm font-medium text-ink">
              {doneCount} of {steps.length} complete
            </p>
            {allDone && <span className="text-xs font-medium text-success-700">All done</span>}
          </div>
          <Progress
            value={doneCount}
            total={steps.length}
            label="Setup progress"
            tone={allDone ? "success" : "brand"}
          />
        </div>
      </Card>

      {!isGoogleOAuthConfigured() && (
        <Alert tone="warn" title="Start with the documentation" className="mb-5">
          Step 1 happens outside this app, in the Google Cloud Console. Open{" "}
          <span className="font-medium">SETUP_GUIDE.md</span> in the project folder — it lists every
          button to click and exactly which two values to copy into your{" "}
          <code className="font-mono text-xs">.env</code> file.
        </Alert>
      )}

      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.title}>
            <Card className={step.done ? "border-success-200 bg-success-50/30" : undefined}>
              <div className="flex items-start gap-3.5 px-5 py-4">
                <span className="mt-0.5 shrink-0">
                  {step.done ? (
                    <span className="flex size-6 items-center justify-center rounded-full bg-success-600">
                      <Check className="size-3.5 text-white" aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="flex size-6 items-center justify-center rounded-full border border-line-strong bg-surface text-xs font-semibold text-ink-soft">
                      {i + 1}
                    </span>
                  )}
                  <span className="sr-only">{step.done ? "Complete" : "Not complete"}</span>
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">{step.body}</p>
                  {step.doc && (
                    <p className="mt-1.5 text-xs text-ink-faint">{step.doc}</p>
                  )}

                  {step.action && !step.done && (
                    <div className="mt-3">
                      {step.action.external ? (
                        <Button asChild size="sm">
                          <a href={step.action.href}>
                            {step.action.label}
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </a>
                        </Button>
                      ) : (
                        <Button asChild size="sm">
                          <Link href={step.action.href}>{step.action.label}</Link>
                        </Button>
                      )}
                    </div>
                  )}

                  {step.action && step.done && (
                    <div className="mt-2.5">
                      {step.action.external ? (
                        <a
                          href={step.action.href}
                          className="text-xs font-medium text-brand-600 hover:underline"
                        >
                          {step.action.label}
                        </a>
                      ) : (
                        <Link
                          href={step.action.href}
                          className="text-xs font-medium text-brand-600 hover:underline"
                        >
                          {step.action.label}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      {!org.setupCompletedAt && (
        <Card className="mt-5">
          <div className="px-5 py-4">
            <p className="text-sm font-medium text-ink">Finished the walkthrough?</p>
            <p className="mt-1 text-sm text-ink-soft">
              Marking setup complete only removes the reminder from the dashboard. It does not
              enable publishing.
            </p>
            <div className="mt-3">
              <CompleteSetupButton />
            </div>
          </div>
        </Card>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Circle className="size-3 text-ink-faint" aria-hidden="true" />
        <p className="text-xs text-ink-faint">
          Stuck on a step? TROUBLESHOOTING.md covers the common Google Cloud and OAuth errors.
        </p>
      </div>
    </>
  );
}
