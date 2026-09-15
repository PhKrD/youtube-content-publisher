import { db } from "./db";
import { logger } from "./logger";
import { NotificationType, Role } from "@/generated/prisma";

/**
 * In-app notifications (Section 33).
 *
 * Deliberately best-effort: a notification is a courtesy, never part of a
 * transaction that matters. Failing to insert one must not roll back a
 * publish or a review decision, so every function here swallows its errors
 * after logging them.
 *
 * Email is intentionally not implemented — see the roadmap. The data model
 * supports it without change.
 */

export interface NotifyInput {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  submissionId?: string;
  linkPath?: string;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    await db.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        submissionId: input.submissionId ?? null,
        linkPath: input.linkPath ?? null,
      },
    });
  } catch (e) {
    logger.warn("failed to create notification", {
      type: input.type,
      userId: input.userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Notifies everyone who can act on a review.
 * `excludeUserId` avoids telling the submitter about their own submission.
 */
export async function notifyReviewers(input: {
  organizationId: string;
  type: NotificationType;
  title: string;
  body?: string;
  submissionId?: string;
  linkPath?: string;
  excludeUserId?: string;
}): Promise<void> {
  try {
    const reviewers = await db.user.findMany({
      where: {
        organizationId: input.organizationId,
        role: { in: [Role.ADMIN, Role.REVIEWER] },
        disabledAt: null,
        ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
      },
      select: { id: true },
    });

    if (reviewers.length === 0) return;

    await db.notification.createMany({
      data: reviewers.map((r) => ({
        organizationId: input.organizationId,
        userId: r.id,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        submissionId: input.submissionId ?? null,
        linkPath: input.linkPath ?? null,
      })),
    });
  } catch (e) {
    logger.warn("failed to notify reviewers", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Alerts admins that the Google connection needs attention. */
export async function notifyAdminsIntegrationBroken(
  organizationId: string,
  message: string,
): Promise<void> {
  try {
    const admins = await db.user.findMany({
      where: { organizationId, role: Role.ADMIN, disabledAt: null },
      select: { id: true },
    });
    await db.notification.createMany({
      data: admins.map((a) => ({
        organizationId,
        userId: a.id,
        type: NotificationType.INTEGRATION_NEEDS_ATTENTION,
        title: "Google connection needs attention",
        body: message,
        linkPath: "/admin/integrations",
      })),
    });
  } catch (e) {
    logger.warn("failed to notify admins", { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, limit = 30) {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Scoped by userId so one user cannot mark another's notifications read. */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const res = await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return res.count;
}
