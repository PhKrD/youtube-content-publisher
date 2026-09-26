import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { requirePrincipalPage } from "@/lib/authz";
import { nextReference } from "@/lib/submissions";
import { audit, AuditAction } from "@/lib/audit";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Role, SubmissionStatus } from "@/generated/prisma";

export const metadata: Metadata = { title: "Create content" };

/**
 * Creates a draft and goes straight to the editor.
 *
 * There is no "new content" form: asking for a title before the file has even
 * been chosen is the wrong order for someone who has just recorded a video on
 * their phone. The draft is created immediately so the upload can begin while
 * the details are still being typed.
 */
export default async function NewContentPage() {
  const principal = await requirePrincipalPage();

  // The one precondition that cannot be worked around: with no templates,
  // there is nothing to generate a title or description from.
  // For now, default to OTHERS. In the future, this could be a URL param or user preference.
  const program = "OTHERS" as const;
  const [titleTemplate, descriptionTemplate] = await Promise.all([
    db.titleTemplate.findFirst({
      where: { 
        organizationId: principal.organizationId, 
        isActive: true,
        OR: [
          { program: program },
          { program: null },
        ],
      },
      orderBy: [{ program: "desc" }, { isDefault: "desc" }],
    }),
    db.descriptionTemplate.findFirst({
      where: { 
        organizationId: principal.organizationId, 
        isActive: true,
        OR: [
          { program: program },
          { program: null },
        ],
      },
      orderBy: [{ program: "desc" }, { isDefault: "desc" }],
    }),
  ]);

  if (!titleTemplate || !descriptionTemplate) {
    return (
      <>
        <PageHeader title="Create content" />
        <Alert tone="warn" title="Templates have not been set up yet" icon={AlertTriangle}>
          <p>
            An administrator needs to create a title template and a description template before
            content can be prepared. This is what lets you fill in a few fields instead of writing
            a whole YouTube description by hand.
          </p>
          {principal.role === Role.ADMIN && (
            <Button asChild size="sm" className="mt-3">
              <Link href="/setup">Open setup wizard</Link>
            </Button>
          )}
        </Alert>
      </>
    );
  }

  const [defaultPlaylist, channel] = await Promise.all([
    db.playlist.findFirst({
      where: { organizationId: principal.organizationId, isAllowed: true },
      orderBy: { isDefault: "desc" },
    }),
    db.youTubeChannel.findFirst({
      where: { organizationId: principal.organizationId },
      orderBy: { isDefault: "desc" },
    }),
  ]);

  const submission = await db.submission.create({
    data: {
      organizationId: principal.organizationId,
      createdById: principal.id,
      reference: await nextReference(),
      status: SubmissionStatus.DRAFT,
      program: "OTHERS",
      titleTemplateId: titleTemplate.id,
      descriptionTemplateId: descriptionTemplate.id,
      playlistId: defaultPlaylist?.id ?? null,
      channelId: channel?.id ?? null,
      tags: [],
      templateValues: {},
    },
  });

  await db.submissionEvent.create({
    data: {
      submissionId: submission.id,
      actorId: principal.id,
      type: "CREATED",
      message: "Draft created.",
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SUBMISSION_CREATED,
    entityType: "Submission",
    entityId: submission.id,
    submissionId: submission.id,
  });

  redirect(`/content/${submission.id}/edit`);
}
