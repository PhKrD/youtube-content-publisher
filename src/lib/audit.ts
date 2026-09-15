import { db } from "./db";
import { logger } from "./logger";

/**
 * Audit trail (Section 34).
 *
 * Distinct from SubmissionEvent, which is the friendly timeline shown to
 * contributors. This table is the security/compliance record: it keeps IP
 * addresses, user agents, before/after values and internal error text, and is
 * only ever exposed to admins.
 *
 * Writes are best-effort so an audit failure cannot break a user action —
 * but they are logged loudly, because a silently broken audit trail is worse
 * than a noisy one.
 */

export interface AuditInput {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  submissionId?: string | null;
  driveFileId?: string | null;
  youtubeVideoId?: string | null;
  youtubePlaylistId?: string | null;
  publishingJobId?: string | null;
  result?: "SUCCESS" | "FAILURE" | "DENIED";
  errorMessage?: string | null;
  request?: Request;
}

/**
 * Extracts the caller's IP.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that sets it (Vercel
 * does). The left-most entry is the client; anything after is the proxy chain.
 */
function clientIp(req?: Request): string | null {
  if (!req) return null;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? null;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        oldValue: (input.oldValue ?? null) as never,
        newValue: (input.newValue ?? null) as never,
        submissionId: input.submissionId ?? null,
        driveFileId: input.driveFileId ?? null,
        youtubeVideoId: input.youtubeVideoId ?? null,
        youtubePlaylistId: input.youtubePlaylistId ?? null,
        publishingJobId: input.publishingJobId ?? null,
        result: input.result ?? "SUCCESS",
        errorMessage: input.errorMessage ?? null,
        ipAddress: clientIp(input.request),
        userAgent: input.request?.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    });
  } catch (e) {
    logger.error("AUDIT WRITE FAILED", {
      action: input.action,
      entityType: input.entityType,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Common action names, kept as constants so queries stay reliable. */
export const AuditAction = {
  SUBMISSION_CREATED: "submission.created",
  SUBMISSION_UPDATED: "submission.updated",
  SUBMISSION_DELETED: "submission.deleted",
  SUBMISSION_SUBMITTED: "submission.submitted",
  SUBMISSION_APPROVED: "submission.approved",
  SUBMISSION_REJECTED: "submission.rejected",
  SUBMISSION_CHANGES_REQUESTED: "submission.changes_requested",
  SUBMISSION_ARCHIVED: "submission.archived",

  MEDIA_UPLOAD_STARTED: "media.upload_started",
  MEDIA_UPLOAD_COMPLETED: "media.upload_completed",
  MEDIA_DELETED: "media.deleted",

  PUBLISH_REQUESTED: "publish.requested",
  PUBLISH_SUCCEEDED: "publish.succeeded",
  PUBLISH_FAILED: "publish.failed",
  PUBLISH_RETRIED: "publish.retried",
  PUBLISH_CANCELLED: "publish.cancelled",

  INTEGRATION_CONNECTED: "integration.connected",
  INTEGRATION_DISCONNECTED: "integration.disconnected",
  CHANNEL_CONFIRMED: "channel.confirmed",
  PLAYLISTS_SYNCED: "playlists.synced",

  SETTINGS_UPDATED: "settings.updated",
  PRODUCTION_PUBLISHING_ENABLED: "settings.production_publishing_enabled",
  PRODUCTION_PUBLISHING_DISABLED: "settings.production_publishing_disabled",

  USER_INVITED: "user.invited",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_DISABLED: "user.disabled",
  USER_ENABLED: "user.enabled",
  USER_PUBLISH_RIGHT_CHANGED: "user.publish_right_changed",

  TEMPLATE_CREATED: "template.created",
  TEMPLATE_UPDATED: "template.updated",
  TEMPLATE_DELETED: "template.deleted",
} as const;

export async function listAuditLogs(params: {
  organizationId: string;
  action?: string;
  actorId?: string;
  submissionId?: string;
  limit?: number;
  cursor?: string;
}) {
  const { organizationId, action, actorId, submissionId, limit = 50, cursor } = params;
  return db.auditLog.findMany({
    where: {
      organizationId,
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
      ...(submissionId ? { submissionId } : {}),
    },
    include: { actor: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}
