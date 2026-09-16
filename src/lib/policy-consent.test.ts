import { describe, expect, it } from "vitest";
import { CURRENT_POLICY_VERSION, hasAcceptedCurrentPolicy } from "./policy-consent";

/**
 * YouTube Developer Policy III.A.2 makes consent a precondition for using the
 * app at all, so "no record" and "stale record" must both fail closed.
 */
describe("hasAcceptedCurrentPolicy", () => {
  it("rejects a user who has never accepted", () => {
    expect(
      hasAcceptedCurrentPolicy({ policyAcceptedAt: null, policyAcceptedVersion: null }),
    ).toBe(false);
  });

  it("accepts a user who accepted the current version", () => {
    expect(
      hasAcceptedCurrentPolicy({
        policyAcceptedAt: new Date(),
        policyAcceptedVersion: CURRENT_POLICY_VERSION,
      }),
    ).toBe(true);
  });

  it("re-prompts a user who accepted an older version", () => {
    expect(
      hasAcceptedCurrentPolicy({
        policyAcceptedAt: new Date(),
        policyAcceptedVersion: "1970-01-01",
      }),
    ).toBe(false);
  });

  it("rejects a version match with no timestamp, which should be impossible", () => {
    expect(
      hasAcceptedCurrentPolicy({
        policyAcceptedAt: null,
        policyAcceptedVersion: CURRENT_POLICY_VERSION,
      }),
    ).toBe(false);
  });
});
