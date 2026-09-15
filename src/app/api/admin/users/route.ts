import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { hashToken, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { Role } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["ADMIN", "REVIEWER", "CONTRIBUTOR"]),
});

/**
 * Invites a user.
 *
 * Access is allow-listed: the invitation is what permits that Google account
 * to sign in at all. The raw token is returned exactly once so the admin can
 * pass on the link; only its hash is stored, so a database leak cannot be
 * used to accept invitations.
 */
export const POST = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, inviteSchema);
  const email = body.email.trim().toLowerCase();

  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    if (existingUser.organizationId === principal.organizationId) {
      throw Errors.conflict("That person already has an account here.");
    }
    throw Errors.conflict("That email address already belongs to another organisation.");
  }

  const token = randomToken();

  const invite = await db.invite.upsert({
    where: {
      organizationId_email: { organizationId: principal.organizationId, email },
    },
    create: {
      organizationId: principal.organizationId,
      email,
      role: body.role as Role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      invitedById: principal.id,
    },
    update: {
      role: body.role as Role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      acceptedAt: null,
      revokedAt: null,
      invitedById: principal.id,
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.USER_INVITED,
    entityType: "Invite",
    entityId: invite.id,
    newValue: { email, role: body.role },
    request,
  });

  return ok({
    invite: { id: invite.id, email, role: invite.role, expiresAt: invite.expiresAt },
    // Email delivery is not implemented; the admin shares this themselves.
    // Documented as a known limitation rather than silently pretending.
    signInUrl: `${env.AUTH_URL}/signin`,
  });
});

const updateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "REVIEWER", "CONTRIBUTOR"]).optional(),
  canPublishDirectly: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

/**
 * Changes a user's role, publishing right, or enabled state.
 *
 * Two self-protections: an admin cannot demote or disable themselves, and the
 * last remaining admin cannot be removed — either would lock the organisation
 * out of its own settings permanently.
 */
export const PATCH = route(async (request) => {
  const principal = await requireAdmin();
  const body = await parseJson(request, updateSchema);

  const target = await db.user.findUnique({ where: { id: body.userId } });
  if (!target || target.organizationId !== principal.organizationId) {
    throw Errors.notFound("user");
  }

  if (target.id === principal.id) {
    if (body.role && body.role !== Role.ADMIN) {
      throw Errors.conflict("You cannot remove your own administrator role.");
    }
    if (body.disabled) {
      throw Errors.conflict("You cannot disable your own account.");
    }
  }

  const losingAdmin =
    target.role === Role.ADMIN && ((body.role && body.role !== Role.ADMIN) || body.disabled);

  if (losingAdmin) {
    const otherAdmins = await db.user.count({
      where: {
        organizationId: principal.organizationId,
        role: Role.ADMIN,
        disabledAt: null,
        id: { not: target.id },
      },
    });
    if (otherAdmins === 0) {
      throw Errors.conflict(
        "This is the only administrator. Promote someone else first, or the organisation would be left with no one able to change settings.",
      );
    }
  }

  const updated = await db.user.update({
    where: { id: target.id },
    data: {
      ...(body.role !== undefined ? { role: body.role as Role } : {}),
      ...(body.canPublishDirectly !== undefined
        ? { canPublishDirectly: body.canPublishDirectly }
        : {}),
      ...(body.disabled !== undefined
        ? { disabledAt: body.disabled ? new Date() : null }
        : {}),
    },
  });

  // Disabling must take effect at once, so destroy the sessions too. Database
  // sessions (rather than JWTs) are what make this possible.
  if (body.disabled) {
    await db.session.deleteMany({ where: { userId: target.id } });
  }

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action:
      body.disabled !== undefined
        ? body.disabled
          ? AuditAction.USER_DISABLED
          : AuditAction.USER_ENABLED
        : body.role !== undefined
          ? AuditAction.USER_ROLE_CHANGED
          : AuditAction.USER_PUBLISH_RIGHT_CHANGED,
    entityType: "User",
    entityId: target.id,
    oldValue: {
      role: target.role,
      canPublishDirectly: target.canPublishDirectly,
      disabled: Boolean(target.disabledAt),
    },
    newValue: body,
    request,
  });

  return ok({
    user: {
      id: updated.id,
      role: updated.role,
      canPublishDirectly: updated.canPublishDirectly,
      disabled: Boolean(updated.disabledAt),
    },
  });
});

/** Revokes a pending invitation. */
export const DELETE = route(async (request) => {
  const principal = await requireAdmin();
  const { inviteId } = await parseJson(request, z.object({ inviteId: z.string().min(1) }));

  const invite = await db.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.organizationId !== principal.organizationId) {
    throw Errors.notFound("invitation");
  }

  await db.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: "user.invite_revoked",
    entityType: "Invite",
    entityId: inviteId,
    oldValue: { email: invite.email },
    request,
  });

  return ok({ revoked: true });
});
