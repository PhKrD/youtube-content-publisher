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
  console.log(`[Submit] POST request received`);
  const { id } = await params;
  console.log(`[Submit] Submission ID: ${id}`);
  const principal = await requirePrincipal();
  console.log(`[Submit] Principal loaded: ${principal.id}`);
  const loaded = await loadSubmissionFor(principal, id);
  console.log(`[Submit] Submission loaded: status=${loaded.status}, createdBy=${loaded.createdById}`);

  console.log(`[Submit] User ${principal.id} attempting to submit submission ${id}`);
  console.log(`[Submit] User role: ${principal.role}, is admin: ${principal.role === 'ADMIN'}`);
  console.log(`[Submit] Submission status: ${loaded.status}, created by: ${loaded.createdById}`);
  console.log(`[Submit] User is creator: ${principal.id === loaded.createdById}`);

  if (!canSubmitForReview(principal, loaded)) {
    console.error(`[Submit] canSubmitForReview returned false`);
    throw Errors.forbidden(`cannot submit a submission in status ${loaded.status}`);
  }

  const submission = await db.submission.findUniqueOrThrow({
    where: { id },
    include: submissionInclude,
  });
  const organization = await requireOrganization(principal);
  const { report } = await buildValidationReport(submission, organization, principal);

  console.log(`[Submit] Validation report: readyToSubmit=${report.readyToSubmit}, errors=${JSON.stringify(report.errors)}, warnings=${JSON.stringify(report.warnings)}`);

  if (!report.readyToSubmit) {
    console.error(`[Submit] Validation failed: ${report.errors[0]?.message}`);
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
