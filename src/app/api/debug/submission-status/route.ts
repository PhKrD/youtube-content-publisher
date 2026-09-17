import { ok, route } from "@/lib/api";
import { requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { SubmissionStatus } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const principal = await requirePrincipal();
  const url = new URL(request.url);
  const submissionId = url.searchParams.get("id");
  
  if (!submissionId) {
    return ok({ error: "Missing id parameter" });
  }
  
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: {
      mediaFiles: true,
      createdBy: { select: { id: true, email: true, role: true } },
    },
  });
  
  if (!submission) {
    return ok({ error: "Submission not found" });
  }
  
  return ok({
    submission: {
      id: submission.id,
      status: submission.status,
      organizationId: submission.organizationId,
      createdById: submission.createdById,
      computedTitle: submission.computedTitle,
      computedDescription: submission.computedDescription,
    },
    mediaFiles: submission.mediaFiles.map(m => ({
      id: m.id,
      kind: m.kind,
      uploadState: m.uploadState,
      driveFileId: m.driveFileId,
      sizeBytes: m.sizeBytes?.toString(),
    })),
    createdBy: submission.createdBy,
    currentUser: {
      id: principal.id,
      email: principal.email,
      role: principal.role,
      organizationId: principal.organizationId,
    },
    checks: {
      isCreator: principal.id === submission.createdById,
      isAdmin: principal.role === "ADMIN",
      sameOrg: principal.organizationId === submission.organizationId,
      statusAllowed: [
        SubmissionStatus.DRAFT,
        SubmissionStatus.READY,
        SubmissionStatus.UPLOADED_TO_DRIVE,
        SubmissionStatus.CHANGES_REQUESTED,
      ].includes(submission.status as any),
    },
  });
});
