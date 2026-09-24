import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { canPublish, loadSubmissionFor, requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ posted: z.boolean() });

/**
 * Records that someone posted the companion post on YouTube by hand.
 *
 * The YouTube API cannot create or read posts, so this is the person's word,
 * not a verified fact — the timeline says who marked it.
 */
export const POST = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requirePrincipal();
  await loadSubmissionFor(principal, id);
  if (!canPublish(principal)) throw Errors.forbidden("only publishers can mark posts as posted");
  const { posted } = await parseJson(request, schema);

  await db.$transaction([
    db.submission.update({
      where: { id },
      data: posted
        ? { postPostedAt: new Date(), postPostedById: principal.id }
        : { postPostedAt: null, postPostedById: null },
    }),
    db.submissionEvent.create({
      data: {
        submissionId: id,
        actorId: principal.id,
        type: posted ? "POST_SHARED" : "POST_UNMARKED",
        message: posted ? "Marked the YouTube post as posted." : "Unmarked the YouTube post.",
      },
    }),
  ]);

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SUBMISSION_UPDATED,
    entityType: "Submission",
    entityId: id,
    submissionId: id,
    newValue: { postPosted: posted },
    request,
  });

  return ok({ posted });
});
