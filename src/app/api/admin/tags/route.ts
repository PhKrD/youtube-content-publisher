import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { resolveTags } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  /** Comma or newline separated on the client; normalised here. */
  tags: z.array(z.string().max(100)).max(60),
  isMandatory: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const PUT = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, upsertSchema);

  // Run the tags through the same resolver the publish path uses, so the
  // admin is told now if a tag is too long to ever be usable.
  const resolved = resolveTags(body.tags, []);

  if (body.id) {
    const existing = await db.tagGroup.findUnique({ where: { id: body.id } });
    if (!existing || existing.organizationId !== principal.organizationId) {
      throw Errors.notFound("tag group");
    }
    const updated = await db.tagGroup.update({
      where: { id: body.id },
      data: {
        name: body.name,
        tags: resolved.tags,
        ...(body.isMandatory !== undefined ? { isMandatory: body.isMandatory } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await audit({
      organizationId: principal.organizationId,
      actorId: principal.id,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: "TagGroup",
      entityId: updated.id,
      oldValue: { tags: existing.tags, isMandatory: existing.isMandatory },
      newValue: { tags: resolved.tags, isMandatory: updated.isMandatory },
      request,
    });

    return ok({ id: updated.id, tags: updated.tags, dropped: resolved.dropped });
  }

  const created = await db.tagGroup.create({
    data: {
      organizationId: principal.organizationId,
      name: body.name,
      tags: resolved.tags,
      isMandatory: body.isMandatory ?? false,
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SETTINGS_UPDATED,
    entityType: "TagGroup",
    entityId: created.id,
    newValue: { name: created.name, tags: created.tags },
    request,
  });

  return ok({ id: created.id, tags: created.tags, dropped: resolved.dropped }, { status: 201 });
});

export const DELETE = route(async (request) => {
  const principal = await requireAdmin();
  const { id } = await parseJson(request, z.object({ id: z.string().min(1) }));

  const group = await db.tagGroup.findUnique({ where: { id } });
  if (!group || group.organizationId !== principal.organizationId) {
    throw Errors.notFound("tag group");
  }

  await db.tagGroup.delete({ where: { id } });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SETTINGS_UPDATED,
    entityType: "TagGroup",
    entityId: id,
    oldValue: { name: group.name, tags: group.tags },
    request,
  });

  return ok({ deleted: true });
});
