/**
 * OAuth scopes requested for the publishing integration.
 *
 * Least privilege was a real design decision here, not a formality:
 *
 *  - `drive.file` grants access ONLY to files and folders this application
 *    itself created. It cannot read the administrator's existing documents,
 *    photos or spreadsheets. The trade-off is that the app must create its own
 *    root folder rather than adopting an arbitrary pre-existing one — see
 *    SETUP_GUIDE.md. Requesting full `drive` scope to allow picking any folder
 *    would mean handing this app the admin's entire Drive, which is not a
 *    reasonable price for that convenience.
 *
 *  - `youtube.upload` permits inserting videos and setting thumbnails on them.
 *
 *  - `youtube` is additionally required to read playlists and to insert a
 *    video into one. `youtube.upload` alone cannot touch playlists, which is
 *    the single most common cause of a "video uploaded but playlist failed"
 *    report.
 *
 * Note there is NO `youtube.force-ssl` and no `drive` — if a future feature
 * needs them, they must be added deliberately and the admin re-consents.
 *
 * TWO SEPARATE GRANTS, NOT ONE
 * ----------------------------
 * Google's authorization server refuses any single request that mixes Drive
 * scopes with YouTube scopes:
 *
 *     Error 400: invalid_request
 *     "This request contains scopes that cannot be requested together"
 *
 * So the publishing account is connected in two consecutive consent flows —
 * one for YouTube, one for Drive — and the two resulting grants are stored as
 * two separate IntegrationAccount rows (see google/client.ts). Everything
 * downstream asks for the grant belonging to the service it is about to call.
 */

export const IDENTITY_SCOPES = ["openid", "email", "profile"] as const;

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_MANAGE_SCOPE = "https://www.googleapis.com/auth/youtube";

/** Which half of the publishing integration a token belongs to. */
export type GoogleService = "youtube" | "drive";

export const GOOGLE_SERVICES: readonly GoogleService[] = ["youtube", "drive"] as const;

/** Requested when connecting the YouTube half. Must contain no Drive scope. */
export const YOUTUBE_SCOPES = [
  YOUTUBE_UPLOAD_SCOPE,
  YOUTUBE_MANAGE_SCOPE,
] as const;

/** Requested when connecting the Drive half. Must contain no YouTube scope. */
export const DRIVE_SCOPES = [DRIVE_SCOPE] as const;

/**
 * Every scope the integration uses, across both grants. For display only —
 * never request this set in one authorization call (see the note above).
 */
export const PUBLISHING_SCOPES = [
  DRIVE_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  YOUTUBE_MANAGE_SCOPE,
] as const;

/** Scopes without which the app genuinely cannot function. */
export const REQUIRED_SCOPES = [DRIVE_SCOPE, YOUTUBE_UPLOAD_SCOPE, YOUTUBE_MANAGE_SCOPE] as const;

/** The scopes to request when starting the consent flow for one service. */
export function scopesForService(service: GoogleService): string[] {
  return service === "youtube" ? [...YOUTUBE_SCOPES] : [...DRIVE_SCOPES];
}

/** The scopes a given service's grant must have come back with. */
export function requiredScopesForService(service: GoogleService): string[] {
  return service === "youtube" ? [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_MANAGE_SCOPE] : [DRIVE_SCOPE];
}

export const SERVICE_LABELS: Record<GoogleService, string> = {
  youtube: "YouTube",
  drive: "Google Drive",
};

export interface ScopeReport {
  granted: string[];
  missing: string[];
  ok: boolean;
  /** Human-readable capability summary for the settings page. */
  capabilities: {
    drive: boolean;
    youtubeUpload: boolean;
    youtubePlaylists: boolean;
  };
}

/**
 * Compares what Google actually granted against what we need.
 *
 * Google may silently grant fewer scopes than requested — for example when a
 * user unticks a permission on the consent screen. Detecting that here means
 * we can tell the admin "reconnect and accept everything" instead of failing
 * three steps into a publish with an opaque 403.
 */
export function analyseScopes(grantedScopeString: string | null | undefined): ScopeReport {
  const granted = (grantedScopeString ?? "").split(/\s+/).filter(Boolean);
  const set = new Set(granted);
  const missing = REQUIRED_SCOPES.filter((s) => !set.has(s));
  return {
    granted,
    missing,
    ok: missing.length === 0,
    capabilities: {
      drive: set.has(DRIVE_SCOPE),
      youtubeUpload: set.has(YOUTUBE_UPLOAD_SCOPE),
      youtubePlaylists: set.has(YOUTUBE_MANAGE_SCOPE),
    },
  };
}

/**
 * Same comparison as analyseScopes, but for one service's grant in isolation.
 * Used at connect time, when only that half has just been authorised.
 */
export function analyseServiceScopes(
  service: GoogleService,
  grantedScopeString: string | null | undefined,
): { granted: string[]; missing: string[]; ok: boolean } {
  const granted = (grantedScopeString ?? "").split(/\s+/).filter(Boolean);
  const set = new Set(granted);
  const missing = requiredScopesForService(service).filter((s) => !set.has(s));
  return { granted, missing, ok: missing.length === 0 };
}

/** Friendly label for the settings UI. */
export function describeScope(scope: string): string {
  switch (scope) {
    case DRIVE_SCOPE:
      return "Google Drive — files created by this app";
    case YOUTUBE_UPLOAD_SCOPE:
      return "YouTube — upload videos and set thumbnails";
    case YOUTUBE_MANAGE_SCOPE:
      return "YouTube — read and manage playlists";
    case "openid":
    case "https://www.googleapis.com/auth/userinfo.email":
    case "email":
      return "Your email address";
    case "https://www.googleapis.com/auth/userinfo.profile":
    case "profile":
      return "Your basic profile";
    default:
      return scope;
  }
}
