import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { loadSubmissionFor, requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { descriptionFieldValues } from "@/lib/submissions";
import { extractPlaceholders, hasConditionals, lintTemplate, templatizeText } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** false = only show what would be saved; true = save it. */
  confirm: z.boolean(),
});

/**
 * Saves this video's hand-edited description as its template, so future
 * videos start from the new wording.
 *
 * The edited text contains this video's details (sponsor, date...). Those are
 * turned back into {{PLACEHOLDERS}} first, and the admin sees the result
 * before anything is saved — otherwise every future video would repeat this
 * one's sponsor name. Admin only: it changes the text for everyone.
 */
export const POST = route(async (request, { params }: Params) => {
  const { id } = await params;
  const principal = await requireAdmin();
  const submission = await loadSubmissionFor(principal, id, { forEdit: true });
  const body = await parseJson(request, schema);

  const template = submission.descriptionTemplate;
  if (!template) throw Errors.conflict("This content has no description template to update.");
  if (!submission.descriptionOverride) {
    throw Errors.conflict("Edit the full description first, then save it as the template.");
  }
  // One video's text holds only one branch; saving it would drop the others.
  if (hasConditionals(template.body)) {
    throw Errors.conflict(
      "This template has different wording for different cases (e.g. sponsored or not). Edit it in Settings → Templates instead.",
    );
  }

  const result = templatizeText(submission.descriptionOverride, descriptionFieldValues(submission));
  const labelOf = (key: string) => template.variables.find((v) => v.key === key)?.label ?? key;
  // Only a field the description actually used can have been removed from it.
  const usedBefore = new Set(extractPlaceholders(template.body));
  const summary = {
    templateName: template.name,
    body: result.body,
    notFound: result.notFound.filter((k) => usedBefore.has(k)).map(labelOf),
    repeated: result.repeated.map(labelOf),
  };

  if (!body.confirm) return ok(summary);

  await db.$transaction([
    db.descriptionTemplate.update({ where: { id: template.id }, data: { body: result.body } }),
    // The template now produces this text, so the fields drive it again.
    db.submission.update({ where: { id }, data: { descriptionOverride: null } }),
  ]);

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.TEMPLATE_UPDATED,
    entityType: "DescriptionTemplate",
    entityId: template.id,
    submissionId: id,
    oldValue: { body: template.body },
    newValue: { body: result.body, fromSubmission: submission.reference },
    request,
  });

  return ok({ ...summary, issues: lintTemplate(result.body, template.variables) });
});
