import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "./db";
import { Errors } from "./errors";
import { Role, type Submission, SubmissionStatus } from "@/generated/prisma";

/**
 * Authorization (Section 29).
 *
 * Every rule lives here and is evaluated on the server. The UI hides buttons
 * a user may not press, but hiding a button is cosmetic — these functions are
 * what actually decide, and each mutating route calls one of them.
 */

export interface Principal {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  organizationId: string;
  canPublishDirectly: boolean;
}

const ROLE_RANK: Record<Role, number> = {
  [Role.CONTRIBUTOR]: 1,
  [Role.REVIEWER]: 2,
  [Role.ADMIN]: 3,
};

/** Current principal, or null when not signed in / not yet provisioned. */
export async function getPrincipal(): Promise<Principal | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.organizationId) return null;
  return {
    id: u.id,
    email: u.email ?? "",
    name: u.name ?? null,
    image: u.image ?? null,
    role: u.role,
    organizationId: u.organizationId,
    canPublishDirectly: u.canPublishDirectly,
  };
}

/**
 * For Server Components / pages: redirects instead of throwing, so an expired
 * session lands on the sign-in screen rather than an error boundary.
 */
export async function requirePrincipalPage(): Promise<Principal> {
  const p = await getPrincipal();
  if (!p) redirect("/signin");
  return p;
}

export async function requireAdminPage(): Promise<Principal> {
  const p = await requirePrincipalPage();
  if (p.role !== Role.ADMIN) redirect("/dashboard?denied=admin");
  return p;
}

/** For API route handlers: throws an AppError the handler converts to JSON. */
export async function requirePrincipal(): Promise<Principal> {
  const p = await getPrincipal();
  if (!p) throw Errors.unauthenticated();
  return p;
}

export async function requireRole(min: Role): Promise<Principal> {
  const p = await requirePrincipal();
  if (ROLE_RANK[p.role] < ROLE_RANK[min]) {
    throw Errors.forbidden(`requires role >= ${min}, has ${p.role}`);
  }
  return p;
}

export const requireAdmin = () => requireRole(Role.ADMIN);
export const requireReviewer = () => requireRole(Role.REVIEWER);

// ---------------------------------------------------------------------------
// Capability predicates
// ---------------------------------------------------------------------------

export const isAdmin = (p: Principal) => p.role === Role.ADMIN;
export const canReview = (p: Principal) => ROLE_RANK[p.role] >= ROLE_RANK[Role.REVIEWER];

/** Publishing requires an explicit grant; admins always have it. */
export const canPublish = (p: Principal) => isAdmin(p) || p.canPublishDirectly;

/** Statuses a contributor may still edit. */
const CONTRIBUTOR_EDITABLE = new Set<SubmissionStatus>([
  SubmissionStatus.DRAFT,
  SubmissionStatus.UPLOADING,
  SubmissionStatus.UPLOADED_TO_DRIVE,
  SubmissionStatus.READY,
  SubmissionStatus.CHANGES_REQUESTED,
]);

type SubmissionLike = Pick<Submission, "id" | "organizationId" | "createdById" | "status">;

/** Tenant isolation. The check nobody may skip. */
export function assertSameOrg(p: Principal, entity: { organizationId: string }): void {
  if (entity.organizationId !== p.organizationId) {
    // Deliberately reported as "not found": confirming existence across a
    // tenant boundary is itself an information leak.
    throw Errors.notFound("item");
  }
}

export function canViewSubmission(p: Principal, s: SubmissionLike): boolean {
  if (s.organizationId !== p.organizationId) return false;
  // Reviewers and admins see everything in their org; contributors see
  // only their own work.
  if (canReview(p)) return true;
  return s.createdById === p.id;
}

export function canEditSubmission(p: Principal, s: SubmissionLike): boolean {
  if (s.organizationId !== p.organizationId) return false;
  if (isAdmin(p)) return true;
  // A submission under review or already published is frozen for its author —
  // otherwise the thing a reviewer approved could change underneath them.
  return s.createdById === p.id && CONTRIBUTOR_EDITABLE.has(s.status);
}

export function canSubmitForReview(p: Principal, s: SubmissionLike): boolean {
  if (!canEditSubmission(p, s)) return false;
  return (
    s.status === SubmissionStatus.READY ||
    s.status === SubmissionStatus.DRAFT ||
    s.status === SubmissionStatus.UPLOADED_TO_DRIVE ||
    s.status === SubmissionStatus.CHANGES_REQUESTED
  );
}

/**
 * A reviewer may not approve their own submission — the whole point of the
 * workflow is a second pair of eyes. Admins are exempted so a one-person
 * organisation is not deadlocked.
 */
export function canReviewSubmission(p: Principal, s: SubmissionLike): boolean {
  if (s.organizationId !== p.organizationId) return false;
  if (!canReview(p)) return false;
  if (s.createdById === p.id && !isAdmin(p)) return false;
  return s.status === SubmissionStatus.SUBMITTED || s.status === SubmissionStatus.UNDER_REVIEW;
}

export function canPublishSubmission(
  p: Principal,
  s: SubmissionLike,
  approvalRequired: boolean,
): boolean {
  if (s.organizationId !== p.organizationId) return false;
  if (!canPublish(p)) return false;
  if (approvalRequired) {
    // Approval mode: only approved content may be published, by anyone with
    // the publish capability.
    return s.status === SubmissionStatus.APPROVED;
  }
  // Direct-publish mode: the author (or an admin) can go straight out.
  const ownOrAdmin = isAdmin(p) || s.createdById === p.id;
  return (
    ownOrAdmin &&
    (s.status === SubmissionStatus.READY ||
      s.status === SubmissionStatus.APPROVED ||
      s.status === SubmissionStatus.FAILED)
  );
}

/** Only an admin may retry, and only something that actually failed. */
export function canRetryPublish(p: Principal, s: SubmissionLike): boolean {
  if (s.organizationId !== p.organizationId) return false;
  if (!canPublish(p)) return false;
  return s.status === SubmissionStatus.FAILED || s.status === SubmissionStatus.PUBLISHING;
}

// ---------------------------------------------------------------------------
// Loaders that authorise as they fetch
// ---------------------------------------------------------------------------

/**
 * Loads a submission and enforces visibility in one step, so a caller cannot
 * forget the check. Returns the row plus the viewer's capabilities on it.
 */
export async function loadSubmissionFor(
  p: Principal,
  submissionId: string,
  opts: { forEdit?: boolean } = {},
) {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: {
      mediaFiles: true,
      playlist: true,
      channel: true,
      titleTemplate: { include: { variables: true } },
      descriptionTemplate: { include: { variables: true } },
      publication: true,
      createdBy: { select: { id: true, name: true, email: true, image: true } },
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true, email: true, image: true } } },
      },
    },
  });

  if (!submission) throw Errors.notFound("submission");
  if (!canViewSubmission(p, submission)) throw Errors.notFound("submission");
  if (opts.forEdit && !canEditSubmission(p, submission)) {
    throw Errors.forbidden("submission is not editable in its current state");
  }
  return submission;
}

/** The caller's organization, or a clear error if provisioning is incomplete. */
export async function requireOrganization(p: Principal) {
  const org = await db.organization.findUnique({ where: { id: p.organizationId } });
  if (!org) throw Errors.notFound("organization");
  return org;
}
