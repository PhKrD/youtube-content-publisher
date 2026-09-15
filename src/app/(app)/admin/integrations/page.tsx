import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Plug, X } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { getIntegration } from "@/lib/google/client";
import { analyseScopes, describeScope, PUBLISHING_SCOPES } from "@/lib/google/scopes";
import { isGoogleOAuthConfigured } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, DetailRow, EmptyState, PageHeader } from "@/components/ui/misc";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { ChannelConfirmation } from "./channel-confirmation";
import { DisconnectButton } from "./disconnect-button";
import { SyncPlaylistsButton } from "./sync-playlists-button";

export const metadata: Metadata = { title: "Google connection" };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; warning?: string }>;
}) {
  const principal = await requireAdminPage();
  const { connected, error, warning } = await searchParams;

  const configured = isGoogleOAuthConfigured();
  const integration = await getIntegration(principal.organizationId);
  const scopes = integration ? analyseScopes(integration.scopes) : null;

  const [channels, playlistCount] = await Promise.all([
    db.youTubeChannel.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: { isDefault: "desc" },
    }),
    db.playlist.count({ where: { organizationId: principal.organizationId } }),
  ]);

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
        title="Google connection"
        description="One Google account is used to upload to YouTube and store files in Drive."
      />

      <div className="space-y-4">
        {error && (
          <Alert tone="danger" title="Connection problem" icon={AlertTriangle}>
            {error}
          </Alert>
        )}
        {warning && <Alert tone="warn" title="Connected with a warning">{warning}</Alert>}
        {connected === "1" && !error && !warning && (
          <Alert tone="success" title="Google connected">
            Next: confirm the YouTube channel below.
          </Alert>
        )}

        {!configured && (
          <Alert tone="warn" title="Google OAuth is not configured" icon={AlertTriangle}>
            <p>
              <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> must be set in the
              environment. Follow <span className="font-medium">SETUP_GUIDE.md</span> to create
              them in the Google Cloud Console, then restart the app.
            </p>
          </Alert>
        )}

        {/* ---------- account ---------- */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Publishing account</CardTitle>
            {integration && (
              <span
                className={
                  integration.status === "CONNECTED"
                    ? "text-xs font-medium text-success-700"
                    : "text-xs font-medium text-danger-700"
                }
              >
                {integration.status === "CONNECTED" ? "Connected" : "Needs attention"}
              </span>
            )}
          </CardHeader>

          {!integration ? (
            <EmptyState
              icon={Plug}
              title="No Google account connected"
              description="Connect the Google account that owns the YouTube channel you want to publish to. You will be taken to Google — this app never sees your password."
              action={
                <Button asChild disabled={!configured}>
                  <a href="/api/integrations/google/connect">Connect Google</a>
                </Button>
              }
            />
          ) : (
            <CardContent className="space-y-4">
              <dl className="divide-y divide-line">
                <DetailRow label="Account">{integration.email}</DetailRow>
                <DetailRow label="Connected">
                  {formatDateTime(integration.connectedAt)}
                </DetailRow>
                <DetailRow label="Token refreshed">
                  {integration.lastRefreshAt ? relativeTime(integration.lastRefreshAt) : "—"}
                </DetailRow>
                <DetailRow label="Can refresh without you">
                  {integration.refreshTokenEnc ? "Yes" : "No — reconnect needed"}
                </DetailRow>
              </dl>

              {integration.lastError && (
                <Alert tone="danger" title="Last error" icon={AlertTriangle}>
                  {integration.lastError}
                </Alert>
              )}

              {/* ---------- granted permissions ---------- */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Permissions
                </p>
                <ul className="space-y-1.5">
                  {PUBLISHING_SCOPES.filter((s) => !["openid", "email", "profile"].includes(s)).map(
                    (scope) => {
                      const granted = scopes?.granted.includes(scope) ?? false;
                      return (
                        <li key={scope} className="flex items-start gap-2 text-sm">
                          {granted ? (
                            <Check
                              className="mt-0.5 size-4 shrink-0 text-success-600"
                              aria-hidden="true"
                            />
                          ) : (
                            <X
                              className="mt-0.5 size-4 shrink-0 text-danger-600"
                              aria-hidden="true"
                            />
                          )}
                          <span className={granted ? "text-ink" : "text-danger-700"}>
                            {describeScope(scope)}
                            <span className="sr-only">
                              {granted ? " granted" : " not granted"}
                            </span>
                          </span>
                        </li>
                      );
                    },
                  )}
                </ul>

                {scopes && !scopes.ok && (
                  <Alert tone="danger" className="mt-3" icon={AlertTriangle}>
                    Some permissions were not granted, so publishing will fail. Reconnect and
                    accept every permission Google asks for.
                  </Alert>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                <Button asChild variant="secondary" size="sm">
                  <a href="/api/integrations/google/connect">Reconnect / change account</a>
                </Button>
                <DisconnectButton email={integration.email} />
              </div>
            </CardContent>
          )}
        </Card>

        {/* ---------- channel confirmation (Section 9) ---------- */}
        {integration && (
          <Card>
            <CardHeader>
              <CardTitle>YouTube channel</CardTitle>
              <p className="mt-1 text-xs text-ink-soft">
                Nothing can be published until you confirm this is the right channel.
              </p>
            </CardHeader>

            {channels.length === 0 ? (
              <EmptyState
                title="No channel found"
                description="The connected Google account does not appear to have a YouTube channel. Create one on that account, then reconnect."
                className="py-10"
              />
            ) : (
              <CardContent className="space-y-4">
                {channels.map((c) => (
                  <ChannelConfirmation
                    key={c.id}
                    channel={{
                      id: c.id,
                      title: c.title,
                      youtubeChannelId: c.youtubeChannelId,
                      customUrl: c.customUrl,
                      thumbnailUrl: c.thumbnailUrl,
                      subscriberCount: c.subscriberCount ? Number(c.subscriberCount) : null,
                      videoCount: c.videoCount ? Number(c.videoCount) : null,
                      confirmedAt: c.confirmedAt?.toISOString() ?? null,
                    }}
                  />
                ))}
              </CardContent>
            )}
          </Card>
        )}

        {/* ---------- playlists ---------- */}
        {integration && (
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle>Playlists</CardTitle>
                <p className="mt-1 text-xs text-ink-soft">
                  {playlistCount} cached. Refreshing uses YouTube API quota, so it is manual.
                </p>
              </div>
              <SyncPlaylistsButton />
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" size="sm">
                <Link href="/admin/playlists">
                  Manage which playlists are available
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
