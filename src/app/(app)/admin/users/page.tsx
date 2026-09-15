import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/authz";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { formatDate, relativeTime } from "@/lib/utils";
import { InviteForm } from "./invite-form";
import { UserRow } from "./user-row";
import { PendingInvites } from "./pending-invites";

export const metadata: Metadata = { title: "Users and roles" };

export default async function UsersPage() {
  const principal = await requireAdminPage();

  const [users, invites] = await Promise.all([
    db.user.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        canPublishDirectly: true,
        disabledAt: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { submissions: true } },
      },
    }),
    db.invite.findMany({
      where: { organizationId: principal.organizationId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
    }),
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
        title="Users and roles"
        description="Access is by invitation — only invited email addresses can sign in."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
          </CardHeader>
          <div className="px-5 py-4">
            <InviteForm />
          </div>
        </Card>

        {invites.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
            </CardHeader>
            <PendingInvites
              invites={invites.map((i) => ({
                id: i.id,
                email: i.email,
                role: i.role,
                expiresAt: i.expiresAt.toISOString(),
              }))}
            />
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>People ({users.length})</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <UserRow
                key={u.id}
                isSelf={u.id === principal.id}
                user={{
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  image: u.image,
                  role: u.role,
                  canPublishDirectly: u.canPublishDirectly,
                  disabled: Boolean(u.disabledAt),
                  submissionCount: u._count.submissions,
                  lastLogin: u.lastLoginAt ? relativeTime(u.lastLoginAt) : "never",
                  joined: formatDate(u.createdAt),
                }}
              />
            ))}
          </ul>
        </Card>

        <Alert tone="info" title="What each role can do">
          <ul className="mt-1 space-y-1 text-[13px]">
            <li>
              <strong>Contributor</strong> — create content, upload files, edit their own drafts and
              submit for review. Can publish only if you grant it explicitly.
            </li>
            <li>
              <strong>Reviewer</strong> — everything a contributor can do, plus review, approve,
              request changes and reject. Cannot approve their own submissions.
            </li>
            <li>
              <strong>Administrator</strong> — everything, including the Google connection, the
              production publishing switch, templates and users.
            </li>
          </ul>
        </Alert>
      </div>
    </>
  );
}
