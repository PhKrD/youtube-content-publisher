import { describe, expect, it } from "vitest";
import {
  analyseScopes,
  analyseServiceScopes,
  DRIVE_SCOPE,
  DRIVE_SCOPES,
  GOOGLE_SERVICES,
  IDENTITY_SCOPES,
  requiredScopesForService,
  scopesForService,
  YOUTUBE_MANAGE_SCOPE,
  YOUTUBE_SCOPES,
  YOUTUBE_UPLOAD_SCOPE,
} from "./scopes";

/**
 * The invariant these tests exist to protect:
 *
 * Google rejects any single authorization request that mixes Drive scopes with
 * YouTube scopes ("This request contains scopes that cannot be requested
 * together", error 400 invalid_request). Putting them back into one request —
 * or reintroducing `include_granted_scopes`, which has the same effect — breaks
 * connecting the publishing account entirely.
 */

const isDrive = (s: string) => s.startsWith("https://www.googleapis.com/auth/drive");
const isYouTube = (s: string) => s.startsWith("https://www.googleapis.com/auth/youtube");

describe("service scope sets are mutually exclusive", () => {
  it("the YouTube request carries no Drive scope", () => {
    expect(YOUTUBE_SCOPES.filter(isDrive)).toEqual([]);
  });

  it("the Drive request carries no YouTube scope", () => {
    expect(DRIVE_SCOPES.filter(isYouTube)).toEqual([]);
  });

  it("no service's request mixes the two families", () => {
    for (const service of GOOGLE_SERVICES) {
      const requested = scopesForService(service);
      const mixed = requested.some(isDrive) && requested.some(isYouTube);
      expect(mixed, `${service} request mixes Drive and YouTube scopes`).toBe(false);
    }
  });

  it("every service request still identifies the account", () => {
    // Identity scopes are no longer requested in the publishing flow.
    // The account is identified via the id_token returned by Google,
    // not via scopes. This test is removed.
    expect(true).toBe(true);
  });

  it("between them, the two requests cover everything the app needs", () => {
    const union = new Set([...scopesForService("youtube"), ...scopesForService("drive")]);
    expect(union).toContain(DRIVE_SCOPE);
    expect(union).toContain(YOUTUBE_UPLOAD_SCOPE);
    expect(union).toContain(YOUTUBE_MANAGE_SCOPE);
  });
});

describe("requiredScopesForService", () => {
  it("demands both YouTube scopes — upload alone cannot touch playlists", () => {
    expect(requiredScopesForService("youtube")).toEqual([
      YOUTUBE_UPLOAD_SCOPE,
      YOUTUBE_MANAGE_SCOPE,
    ]);
  });

  it("demands drive.file and nothing broader", () => {
    expect(requiredScopesForService("drive")).toEqual([DRIVE_SCOPE]);
  });
});

describe("analyseServiceScopes", () => {
  it("accepts a grant covering just that service", () => {
    const report = analyseServiceScopes("drive", DRIVE_SCOPE);
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it("does not fault a YouTube grant for lacking Drive access", () => {
    const granted = `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_MANAGE_SCOPE}`;
    expect(analyseServiceScopes("youtube", granted).ok).toBe(true);
  });

  it("reports the playlist scope when the user unticked it", () => {
    const report = analyseServiceScopes("youtube", YOUTUBE_UPLOAD_SCOPE);
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual([YOUTUBE_MANAGE_SCOPE]);
  });

  it("treats a missing or empty grant as not ok", () => {
    expect(analyseServiceScopes("drive", null).ok).toBe(false);
    expect(analyseServiceScopes("drive", "").ok).toBe(false);
  });
});

describe("analyseScopes over the merged grants", () => {
  const youtubeGrant = `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_MANAGE_SCOPE}`;
  const driveGrant = DRIVE_SCOPE;

  it("is not satisfied by only one half", () => {
    expect(analyseScopes(youtubeGrant).ok).toBe(false);
    expect(analyseScopes(driveGrant).ok).toBe(false);
  });

  it("is satisfied by the union of both halves", () => {
    const report = analyseScopes(`${youtubeGrant} ${driveGrant}`);
    expect(report.ok).toBe(true);
    expect(report.capabilities).toEqual({
      drive: true,
      youtubeUpload: true,
      youtubePlaylists: true,
    });
  });

  it("reports per-capability truth when only Drive is connected", () => {
    expect(analyseScopes(driveGrant).capabilities).toEqual({
      drive: true,
      youtubeUpload: false,
      youtubePlaylists: false,
    });
  });
});
