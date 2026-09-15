import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { extractPlaceholders, lintTemplate } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const titleSchema = z.object({
  kind: z.literal("title"),
  id: z.string().min(1),
  pattern: z.string().min(1).max(500),
  maxLength: z.number().int().min(10).max(100).optional(),
});

const descriptionSchema = z.object({
  kind: z.literal("description"),
  id: z.string().min(1),
  body: z.string().min(1).max(20000),
});

const variableSchema = z.object({
  kind: z.literal("variable"),
  id: z.string().min(1),
  label: z.string().min(1).max(120).optional(),
  helpText: z.string().max(500).nullish(),
  required: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  lockedValue: z.string().max(5000).nullish(),
});

const schema = z.discriminatedUnion("kind", [titleSchema, descriptionSchema, variableSchema]);

/**
 * Updates a template or one of its fields.
 *
 * The response includes lint results so the admin immediately sees problems
 * that would otherwise only surface as a broken published description — an
 * undefined placeholder rendering literally, or a locked field with no value.
 */
export const PATCH = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, schema);

  if (body.kind === "title") {
    const template = await db.titleTemplate.findUnique({
      where: { id: body.id },
      include: { variables: true },
    });
    if (!template || template.organizationId !== principal.organizationId) {
      throw Errors.notFound("template");
    }

    const updated = await db.titleTemplate.update({
      where: { id: body.id },
      data: {
        pattern: body.pattern,
        ...(body.maxLength !== undefined ? { maxLength: body.maxLength } : {}),
      },
      include: { variables: true },
    });

    await audit({
      organizationId: principal.organizationId,
      actorId: principal.id,
      action: AuditAction.TEMPLATE_UPDATED,
      entityType: "TitleTemplate",
      entityId: body.id,
      oldValue: { pattern: template.pattern },
      newValue: { pattern: body.pattern },
      request,
    });

    return ok({
      placeholders: extractPlaceholders(updated.pattern),
      issues: lintTemplate(updated.pattern, updated.variables),
    });
  }

  if (body.kind === "description") {
    const template = await db.descriptionTemplate.findUnique({
      where: { id: body.id },
      include: { variables: true },
    });
    if (!template || template.organizationId !== principal.organizationId) {
      throw Errors.notFound("template");
    }

    const updated = await db.descriptionTemplate.update({
      where: { id: body.id },
      data: { body: body.body },
      include: { variables: true },
    });

    await audit({
      organizationId: principal.organizationId,
      actorId: principal.id,
      action: AuditAction.TEMPLATE_UPDATED,
      entityType: "DescriptionTemplate",
      entityId: body.id,
      newValue: { length: body.body.length },
      request,
    });

    return ok({
      placeholders: extractPlaceholders(updated.body),
      issues: lintTemplate(updated.body, updated.variables),
    });
  }

  // --- variable ---
  const variable = await db.templateVariable.findUnique({
    where: { id: body.id },
    include: { titleTemplate: true, descriptionTemplate: true },
  });
  if (!variable) throw Errors.notFound("field");

  const owningOrg =
    variable.titleTemplate?.organizationId ?? variable.descriptionTemplate?.organizationId;
  if (owningOrg !== principal.organizationId) throw Errors.notFound("field");

  // A locked field with no value silently renders as nothing, which is almost
  // never what the admin intended.
  if (body.isLocked === true && !(body.lockedValue ?? variable.lockedValue)) {
    throw Errors.validation(
      "Provide the value this locked field should always use.",
      "lockedValue",
    );
  }

  await db.templateVariable.update({
    where: { id: body.id },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
      ...(body.required !== undefined ? { required: body.required } : {}),
      ...(body.isLocked !== undefined ? { isLocked: body.isLocked } : {}),
      ...(body.lockedValue !== undefined ? { lockedValue: body.lockedValue } : {}),
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.TEMPLATE_UPDATED,
    entityType: "TemplateVariable",
    entityId: body.id,
    oldValue: { isLocked: variable.isLocked, required: variable.required },
    newValue: body,
    request,
  });

  return ok({ updated: true });
});
