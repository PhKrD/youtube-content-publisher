import { ok, route } from "@/lib/api";
import {
  canSubmitForReview,
  loadSubmissionFor,
  requireOrganization,
  requirePrincipal,
} from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { notifyReviewers } from "@/lib/notifications";
import { buildValidationReport, persistRenderedMetadata, submissionInclude } from "@/lib/submissions";
import { ApprovalMode, NotificationType, SubmissionStatus } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Submits for review (Section 27, mode B) — or marks ready to publish when
 * the organisation is in direct-publish mode.
 *
 * The rendered title and description are frozen onto the row here, so a later
 * template change cannot silently alter what a reviewer approved.
 */
export const POST = route(async (request, { params }: Params) => {
  console.log(`[SUBMIT DEBUG] ========== SUBMIT REQUEST START ==========`);
  const { id } = await params;
  console.log(`[SUBMIT DEBUG] submissionId=${id}`);
  
  const principal = await requirePrincipal();
  console.log(`[SUBMIT DEBUG] currentUserId=${principal.id}`);
  console.log(`[SUBMIT DEBUG] currentUserRole=${principal.role}`);
  console.log(`[SUBMIT DEBUG] currentUserOrganizationId=${principal.organizationId}`);
  console.log(`[SUBMIT DEBUG] currentUserEmail=${principal.email}`);
  
  const loaded = await loadSubmissionFor(principal, id);
  console.log(`[SUBMIT DEBUG] submissionCreatorId=${loaded.createdById}`);
  console.log(`[SUBMIT DEBUG] submissionOrganizationId=${loaded.organizationId}`);
  console.log(`[SUBMIT DEBUG] submissionStatus=${loaded.status}`);
  console.log(`[SUBMIT DEBUG] isCreator=${principal.id === loaded.createdById}`);
  console.log(`[SUBMIT DEBUG] isAdmin=${principal.role === 'ADMIN'}`);
  console.log(`[SUBMIT DEBUG] organizationMatch=${principal.organizationId === loaded.organizationId}`);
  
  const canEdit = principal.role === 'ADMIN' || (principal.id === loaded.createdById && loaded.organizationId === principal.organizationId);
  console.log(`[SUBMIT DEBUG] canEdit=${canEdit}`);
  
  const statusAllowed = loaded.status === SubmissionStatus.READY || 
                        loaded.status === SubmissionStatus.DRAFT || 
                        loaded.status === SubmissionStatus.UPLOADED_TO_DRIVE || 
                        loaded.status === SubmissionStatus.CHANGES_REQUESTED;
  console.log(`[SUBMIT DEBUG] statusAllowed=${statusAllowed}`);
  
  // Special case: if status is UPLOADING but we have a completed Drive file, allow submission
  const hasCompletedDriveFile = loaded.mediaFiles.some(
    m => m.kind === 'VIDEO' && m.uploadState === 'COMPLETED' && m.driveFileId
  );
  const isUploadingWithCompletedFile = loaded.status === SubmissionStatus.UPLOADING && hasCompletedDriveFile;
  console.log(`[SUBMIT DEBUG] hasCompletedDriveFile=${hasCompletedDriveFile}, isUploadingWithCompletedFile=${isUploadingWithCompletedFile}`);
  
  if (!canSubmitForReview(principal, loaded) && !isUploadingWithCompletedFile) {
    console.error(`[SUBMIT DEBUG] canSubmitForReview returned false`);
    console.error(`[SUBMIT DEBUG] 403 REASON: canSubmitForReview check failed (status=${loaded.status}, user=${principal.role}, creator=${loaded.createdById})`);
    
    // Return a more specific error message for UPLOADING status
    if (loaded.status === SubmissionStatus.UPLOADING) {
      throw Errors.validation("Submission is still uploading. Please wait for the upload to complete before submitting.");
    }
    
    throw Errors.forbidden(`cannot submit a submission in status ${loaded.status} (user: ${principal.role}, creator: ${loaded.createdById})`);
  }
  
  // If we're in UPLOADING status but have a completed file, auto-update to UPLOADED_TO_DRIVE
  if (isUploadingWithCompletedFile) {
    console.log(`[SUBMIT DEBUG] Auto-updating status from UPLOADING to UPLOADED_TO_DRIVE`);
    await db.submission.update({
      where: { id },
      data: { status: SubmissionStatus.UPLOADED_TO_DRIVE },
    });
  }

  const submission = await db.submission.findUniqueOrThrow({
    where: { id },
    include: submissionInclude,
  });
  
  console.log(`[SUBMIT DEBUG] hasTitle=${!!submission.computedTitle}`);
  console.log(`[SUBMIT DEBUG] hasDescription=${!!submission.computedDescription}`);
  console.log(`[SUBMIT DEBUG] mediaFiles=${submission.mediaFiles.length}`);
  console.log(`[SUBMIT DEBUG] mediaFiles:`, submission.mediaFiles.map(m => ({ id: m.id, kind: m.kind, uploadState: m.uploadState, driveFileId: m.driveFileId })));
  
  const organization = await requireOrganization(principal);
  const { report } = await buildValidationReport(submission, organization, principal);

  console.log(`[SUBMIT DEBUG] Validation report: readyToSubmit=${report.readyToSubmit}`);
  console.log(`[SUBMIT DEBUG] Validation errors:`, report.errors);
  console.log(`[SUBMIT DEBUG] Validation warnings:`, report.warnings);

  if (!report.readyToSubmit) {
    console.error(`[SUBMIT DEBUG] Validation failed: ${report.errors[0]?.message}`);
    console.error(`[SUBMIT DEBUG] 403 REASON: Validation failed - ${report.errors[0]?.message}`);
    throw Errors.validation(
      report.errors[0]?.message ??
        "Some required information is still missing. Check the list on the page.",
      report.errors[0]?.field,
    );
  }

  await persistRenderedMetadata(submission);

  const directPublish = organization.approvalMode === ApprovalMode.DIRECT_PUBLISH;
  const nextStatus = directPublish ? SubmissionStatus.READY : SubmissionStatus.SUBMITTED;

  await db.$transaction([
    db.submission.update({
      where: { id },
      data: {
        status: nextStatus,
        submittedAt: new Date(),
      },
    }),
    db.submissionEvent.create({
      data: {
        submissionId: id,
        actorId: principal.id,
        type: directPublish ? "READY" : "SUBMITTED",
        message: directPublish ? "Marked ready to publish." : "Submitted for review.",
      },
    }),
  ]);

  if (!directPublish) {
    await notifyReviewers({
      organizationId: principal.organizationId,
      type: NotificationType.SUBMISSION_SUBMITTED,
      title: "New submission to review",
      body: submission.computedTitle ?? submission.reference,
      submissionId: id,
      linkPath: `/content/${id}`,
      excludeUserId: principal.id,
    });
  }

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SUBMISSION_SUBMITTED,
    entityType: "Submission",
    entityId: id,
    submissionId: id,
    newValue: { status: nextStatus },
    request,
  });

  return ok({ status: nextStatus, warnings: report.warnings });
});
