import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { canReviewSubmission, loadSubmissionFor, requireReviewer } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { NotificationType, ReviewDecision, SubmissionStatus } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z
  .object({
    decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
    comment: z.string().max(4000).optional(),
  })
  .refine((v) => v.decision === "APPROVED" || Boolean(v.comment?.trim()), {
    // Telling a student "changes required" with no explanation is useless,
    // so a comment is mandatory for anything but an approval.
    message: "Please explain what needs to change.",
    path: ["comment"],
  });

/** Records a review decision (Section 28). */
export const POST = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requireReviewer();
  const submission = await loadSubmissionFor(principal, id);
  const body = await parseJson(request, schema);

  if (!canReviewSubmission(principal, submission)) {
    if (submission.createdById === principal.id) {
      throw Errors.forbidden(
        "You cannot review your own submission — another reviewer must look at it.",
      );
    }
    throw Errors.conflict(
      `This submission is ${submission.status.toLowerCase().replace(/_/g, " ")} and is not awaiting review.`,
    );
  }

  const decision = body.decision as ReviewDecision;

  const nextStatus =
    decision === ReviewDecision.APPROVED
      ? SubmissionStatus.APPROVED
      : decision === ReviewDecision.CHANGES_REQUESTED
        ? SubmissionStatus.CHANGES_REQUESTED
        : SubmissionStatus.ARCHIVED;

  await db.$transaction([
    db.review.create({
      data: {
        submissionId: id,
        reviewerId: principal.id,
        decision,
        comment: body.comment?.trim() || null,
      },
    }),
    db.submission.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(decision === ReviewDecision.APPROVED
          ? { approvedAt: new Date(), approvedById: principal.id }
          : {}),
        ...(decision === ReviewDecision.REJECTED ? { archivedAt: new Date() } : {}),
      },
    }),
    db.submissionEvent.create({
      data: {
        submissionId: id,
        actorId: principal.id,
        type: `REVIEW_${decision}`,
        message:
          decision === ReviewDecision.APPROVED
            ? "Approved."
            : decision === ReviewDecision.CHANGES_REQUESTED
              ? "Changes requested."
              : "Rejected.",
        metadata: body.comment ? { comment: body.comment.trim() } : undefined,
      },
    }),
  ]);

  const notificationType =
    decision === ReviewDecision.APPROVED
      ? NotificationType.SUBMISSION_APPROVED
      : decision === ReviewDecision.CHANGES_REQUESTED
        ? NotificationType.SUBMISSION_CHANGES_REQUESTED
        : NotificationType.SUBMISSION_REJECTED;

  await notify({
    organizationId: principal.organizationId,
    userId: submission.createdById,
    type: notificationType,
    title:
      decision === ReviewDecision.APPROVED
        ? "Your submission was approved"
        : decision === ReviewDecision.CHANGES_REQUESTED
          ? "Your submission needs changes"
          : "Your submission was not accepted",
    body: body.comment?.trim() || submission.computedTitle || submission.reference,
    submissionId: id,
    linkPath: `/content/${id}`,
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action:
      decision === ReviewDecision.APPROVED
        ? AuditAction.SUBMISSION_APPROVED
        : decision === ReviewDecision.CHANGES_REQUESTED
          ? AuditAction.SUBMISSION_CHANGES_REQUESTED
          : AuditAction.SUBMISSION_REJECTED,
    entityType: "Submission",
    entityId: id,
    submissionId: id,
    oldValue: { status: submission.status },
    newValue: { status: nextStatus, comment: body.comment?.trim() },
    request,
  });

  return ok({ status: nextStatus, decision });
});

/** Claims a submission for review, so two reviewers do not duplicate work. */
export const PATCH = route(async (_request, { params }: Params) => {
  const { id } = await params;
  const principal = await requireReviewer();
  const submission = await loadSubmissionFor(principal, id);

  if (submission.status !== SubmissionStatus.SUBMITTED) {
    return ok({ status: submission.status });
  }

  await db.submission.update({
    where: { id },
    data: { status: SubmissionStatus.UNDER_REVIEW },
  });

  return ok({ status: SubmissionStatus.UNDER_REVIEW });
});
