import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requirePrincipalPage } from "@/lib/authz";
import { listNotifications, markRead } from "@/lib/notifications";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const principal = await requirePrincipalPage();
  const items = await listNotifications(principal.id);

  // Opening the page is the acknowledgement; marking read here avoids an
  // extra click and a stale unread badge.
  await markRead(principal.id);

  return (
    <>
      <PageHeader title="Notifications" />
      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="You will be told here when your content is approved, published, or needs changes."
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const body = (
                <>
                  <div className="flex items-start gap-2.5">
                    {!n.readAt && (
                      <span
                        aria-label="Unread"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500"
                      />
                    )}
                    <div className={n.readAt ? "min-w-0 flex-1 pl-[18px]" : "min-w-0 flex-1"}>
                      <p className="text-sm font-medium text-ink">{n.title}</p>
                      {n.body && <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>}
                      <p className="mt-1 text-xs text-ink-faint">{relativeTime(n.createdAt)}</p>
                    </div>
                  </div>
                </>
              );

              return (
                <li key={n.id} className="px-4 py-3.5 sm:px-5">
                  {n.linkPath ? (
                    <Link href={n.linkPath} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
