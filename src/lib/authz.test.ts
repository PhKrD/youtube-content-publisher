import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ auth: vi.fn() }));
vi.mock("./db", () => ({ db: {} }));

import { canPublishSubmission, type Principal } from "./authz";
import { Role, SubmissionStatus } from "@/generated/prisma";

const ORG = "org-1";
const user = (over: Partial<Principal> = {}): Principal => ({
  id: "u-1",
  email: "u@example.com",
  name: null,
  image: null,
  role: Role.CONTRIBUTOR,
  organizationId: ORG,
  canPublishDirectly: false,
  ...over,
});
const sub = (status: SubmissionStatus, createdById = "u-1") => ({
  id: "s-1",
  organizationId: ORG,
  createdById,
  status,
});

describe("canPublishSubmission", () => {
  const publisher = user({ canPublishDirectly: true });

  it("never lets someone without the grant publish", () => {
    for (const approval of [true, false]) {
      expect(canPublishSubmission(user(), sub(SubmissionStatus.APPROVED), approval)).toBe(false);
      expect(canPublishSubmission(user(), sub(SubmissionStatus.READY), approval)).toBe(false);
    }
  });

  it("lets a non-admin publisher publish their own work without review, even when approval is required", () => {
    for (const s of [SubmissionStatus.DRAFT, SubmissionStatus.UPLOADED_TO_DRIVE, SubmissionStatus.READY]) {
      expect(canPublishSubmission(publisher, sub(s), true)).toBe(true);
      expect(canPublishSubmission(publisher, sub(s), false)).toBe(true);
    }
  });

  it("still requires approval for other people's content in approval mode", () => {
    expect(canPublishSubmission(publisher, sub(SubmissionStatus.READY, "u-2"), true)).toBe(false);
    expect(canPublishSubmission(publisher, sub(SubmissionStatus.SUBMITTED, "u-2"), true)).toBe(false);
    expect(canPublishSubmission(publisher, sub(SubmissionStatus.APPROVED, "u-2"), true)).toBe(true);
  });

  it("does not bypass an in-flight review or re-publish", () => {
    for (const s of [
      SubmissionStatus.UPLOADING,
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.UNDER_REVIEW,
      SubmissionStatus.CHANGES_REQUESTED,
      SubmissionStatus.PUBLISHING,
      SubmissionStatus.PUBLISHED,
    ]) {
      expect(canPublishSubmission(publisher, sub(s), true)).toBe(false);
      expect(canPublishSubmission(publisher, sub(s), false)).toBe(false);
    }
  });

  it("keeps tenants isolated", () => {
    const other = { ...sub(SubmissionStatus.READY), organizationId: "org-2" };
    expect(canPublishSubmission(user({ role: Role.ADMIN }), other, false)).toBe(false);
  });

  it("lets admins publish anyone's ready content only in direct-publish mode", () => {
    const admin = user({ id: "admin", role: Role.ADMIN });
    expect(canPublishSubmission(admin, sub(SubmissionStatus.READY), false)).toBe(true);
    expect(canPublishSubmission(admin, sub(SubmissionStatus.READY), true)).toBe(false);
  });
});
