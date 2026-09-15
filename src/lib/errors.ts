/**
 * Error taxonomy (Sections 25, 50, 61).
 *
 * Two rules drive this file:
 *
 *  1. Users never see `invalid_grant`, `ECONNRESET` or a stack trace. Every
 *     error carries a `userMessage` written for a student, which always says
 *     whether their content is safe and what to do next.
 *  2. The publishing engine must know whether retrying is worthwhile.
 *     `retryable` drives automatic backoff; `terminal` stops the job and asks
 *     a human to intervene. Guessing wrong either wastes quota or strands a
 *     recoverable job.
 */

export type ErrorCode =
  // --- client / validation ---
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  // --- configuration ---
  | "NOT_CONFIGURED"
  | "PUBLISHING_DISABLED"
  | "CHANNEL_NOT_CONFIRMED"
  // --- google auth ---
  | "GOOGLE_NOT_CONNECTED"
  | "GOOGLE_REAUTH_REQUIRED"
  | "GOOGLE_INSUFFICIENT_SCOPE"
  // --- google services ---
  | "DRIVE_UNAVAILABLE"
  | "YOUTUBE_UNAVAILABLE"
  | "YOUTUBE_QUOTA_EXCEEDED"
  | "YOUTUBE_UPLOAD_LIMIT"
  | "YOUTUBE_REJECTED"
  | "PLAYLIST_UNAVAILABLE"
  | "UPLOAD_SESSION_EXPIRED"
  // --- internal ---
  | "DATABASE_ERROR"
  | "INTERNAL";

interface AppErrorOptions {
  code: ErrorCode;
  /** Message for the end user. Must be safe to display verbatim. */
  userMessage: string;
  /** Technical detail for logs. Never rendered in the UI. */
  detail?: string;
  status?: number;
  /** Worth attempting again automatically? */
  retryable?: boolean;
  /** Permanently failed — stop retrying and surface to a human. */
  terminal?: boolean;
  /** Field path, for form-level error placement. */
  field?: string;
  cause?: unknown;
  /** Seconds to wait before the next attempt, when the API tells us. */
  retryAfterSeconds?: number;
}

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  NOT_CONFIGURED: 503,
  PUBLISHING_DISABLED: 409,
  CHANNEL_NOT_CONFIRMED: 409,
  GOOGLE_NOT_CONNECTED: 409,
  GOOGLE_REAUTH_REQUIRED: 409,
  GOOGLE_INSUFFICIENT_SCOPE: 403,
  DRIVE_UNAVAILABLE: 502,
  YOUTUBE_UNAVAILABLE: 502,
  YOUTUBE_QUOTA_EXCEEDED: 429,
  YOUTUBE_UPLOAD_LIMIT: 429,
  YOUTUBE_REJECTED: 422,
  PLAYLIST_UNAVAILABLE: 409,
  UPLOAD_SESSION_EXPIRED: 410,
  DATABASE_ERROR: 500,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly detail?: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly terminal: boolean;
  readonly field?: string;
  readonly retryAfterSeconds?: number;

  constructor(opts: AppErrorOptions) {
    super(opts.detail ?? opts.userMessage);
    this.name = "AppError";
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.detail = opts.detail;
    this.status = opts.status ?? DEFAULT_STATUS[opts.code] ?? 500;
    this.retryable = opts.retryable ?? false;
    this.terminal = opts.terminal ?? false;
    this.field = opts.field;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }

  /** Shape returned to the browser. Deliberately excludes `detail`. */
  toResponseBody() {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
        ...(this.field ? { field: this.field } : {}),
        ...(this.retryable ? { retryable: true } : {}),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Constructors for the common cases
// ---------------------------------------------------------------------------

export const Errors = {
  validation: (userMessage: string, field?: string, detail?: string) =>
    new AppError({ code: "VALIDATION_FAILED", userMessage, field, detail }),

  notFound: (what = "item") =>
    new AppError({
      code: "NOT_FOUND",
      userMessage: `That ${what} could not be found. It may have been deleted.`,
    }),

  unauthenticated: () =>
    new AppError({
      code: "UNAUTHENTICATED",
      userMessage: "Your session has expired. Please sign in again.",
    }),

  forbidden: (detail?: string) =>
    new AppError({
      code: "FORBIDDEN",
      userMessage: "You do not have permission to do that.",
      detail,
    }),

  conflict: (userMessage: string, detail?: string) =>
    new AppError({ code: "CONFLICT", userMessage, detail }),

  notConfigured: (what: string) =>
    new AppError({
      code: "NOT_CONFIGURED",
      userMessage: `${what} has not been set up yet. Ask an administrator to finish configuration.`,
      detail: `${what} not configured`,
    }),

  publishingDisabled: () =>
    new AppError({
      code: "PUBLISHING_DISABLED",
      userMessage:
        "Publishing to YouTube is currently turned off for safety. An administrator must enable production publishing before content can go live.",
      terminal: true,
    }),

  channelNotConfirmed: () =>
    new AppError({
      code: "CHANNEL_NOT_CONFIRMED",
      userMessage:
        "The YouTube channel has not been confirmed by an administrator yet. This safeguard prevents publishing to the wrong channel.",
      terminal: true,
    }),

  googleNotConnected: () =>
    new AppError({
      code: "GOOGLE_NOT_CONNECTED",
      userMessage:
        "No Google account is connected. An administrator needs to connect the publishing account in Settings.",
      terminal: true,
    }),

  googleReauthRequired: (detail?: string) =>
    new AppError({
      code: "GOOGLE_REAUTH_REQUIRED",
      userMessage:
        "The connection to Google has expired or was revoked. Your content is safe. An administrator needs to reconnect the Google account, then this can be retried.",
      detail,
      terminal: true,
    }),

  insufficientScope: (detail?: string) =>
    new AppError({
      code: "GOOGLE_INSUFFICIENT_SCOPE",
      userMessage:
        "The connected Google account did not grant all the permissions this app needs. An administrator should reconnect it and accept every requested permission.",
      detail,
      terminal: true,
    }),

  uploadSessionExpired: () =>
    new AppError({
      code: "UPLOAD_SESSION_EXPIRED",
      userMessage:
        "This upload session has expired. Please select the file again — nothing else about your submission was lost.",
    }),

  payloadTooLarge: (userMessage: string) =>
    new AppError({ code: "PAYLOAD_TOO_LARGE", userMessage }),

  unsupportedMedia: (userMessage: string, field?: string) =>
    new AppError({ code: "UNSUPPORTED_MEDIA", userMessage, field }),

  internal: (detail?: string, cause?: unknown) =>
    new AppError({
      code: "INTERNAL",
      userMessage:
        "Something went wrong on our side. Your content has not been lost. Please try again in a moment.",
      detail,
      cause,
      retryable: true,
    }),
};

// ---------------------------------------------------------------------------
// Google API error mapping
// ---------------------------------------------------------------------------

/** Loose shape of a googleapis / GaxiosError. */
interface GoogleishError {
  message?: string;
  code?: string | number;
  status?: number;
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
    data?: {
      error?:
        | string
        | {
            code?: number;
            message?: string;
            status?: string;
            errors?: Array<{ reason?: string; message?: string; domain?: string }>;
          };
      error_description?: string;
    };
  };
  errors?: Array<{ reason?: string; message?: string }>;
}

function firstReason(e: GoogleishError): string | undefined {
  const data = e.response?.data;
  if (data && typeof data.error === "object" && data.error?.errors?.length) {
    return data.error.errors[0]?.reason;
  }
  if (e.errors?.length) return e.errors[0]?.reason;
  return undefined;
}

function oauthErrorString(e: GoogleishError): string | undefined {
  const data = e.response?.data;
  if (data && typeof data.error === "string") return data.error;
  return undefined;
}

function retryAfter(e: GoogleishError): number | undefined {
  const h = e.response?.headers?.["retry-after"];
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const TRANSIENT_NETWORK = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * Translates an error from googleapis into an AppError with a correct
 * retryable/terminal classification.
 *
 * @param service which API produced it, so the message names the right system
 */
export function mapGoogleError(err: unknown, service: "drive" | "youtube" | "oauth"): AppError {
  if (err instanceof AppError) return err;

  const e = (err ?? {}) as GoogleishError;
  const status = e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
  const reason = firstReason(e);
  const oauthErr = oauthErrorString(e);
  const detail = `${service}: status=${status ?? "?"} reason=${reason ?? oauthErr ?? e.code ?? "?"} message=${e.message ?? "?"}`;
  const wait = retryAfter(e);

  // --- transport-level failures: always worth retrying ---
  if (typeof e.code === "string" && TRANSIENT_NETWORK.has(e.code)) {
    return new AppError({
      code: service === "drive" ? "DRIVE_UNAVAILABLE" : "YOUTUBE_UNAVAILABLE",
      userMessage:
        "We could not reach Google just now. Your content is safe — this will be retried automatically.",
      detail,
      retryable: true,
      cause: err,
    });
  }

  // --- refresh token dead: the single most important case to get right ---
  // `invalid_grant` means the user revoked access, changed their password, or
  // the token went unused for 6 months. No amount of retrying fixes it.
  if (oauthErr === "invalid_grant" || reason === "authError") {
    return Errors.googleReauthRequired(detail);
  }
  if (oauthErr === "unauthorized_client" || oauthErr === "invalid_client") {
    return new AppError({
      code: "NOT_CONFIGURED",
      userMessage:
        "This application's Google credentials are not valid. An administrator should re-check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      detail,
      terminal: true,
      cause: err,
    });
  }

  if (status === 401) {
    // Token expired mid-flight. Our client refreshes proactively, so a 401
    // here means the refresh itself is no longer working.
    return Errors.googleReauthRequired(detail);
  }

  if (status === 403) {
    switch (reason) {
      case "quotaExceeded":
        return new AppError({
          code: "YOUTUBE_QUOTA_EXCEEDED",
          userMessage:
            "YouTube's daily API limit for this application has been reached. Your content is saved and will be published automatically after the quota resets (midnight Pacific Time).",
          detail,
          // Retryable, but only after a long wait — the engine uses a long floor.
          retryable: true,
          retryAfterSeconds: wait ?? 3600,
          cause: err,
        });
      case "rateLimitExceeded":
      case "userRateLimitExceeded":
        return new AppError({
          code: "RATE_LIMITED",
          userMessage: "Google asked us to slow down. This will be retried automatically in a moment.",
          detail,
          retryable: true,
          retryAfterSeconds: wait ?? 60,
          cause: err,
        });
      case "uploadLimitExceeded":
        return new AppError({
          code: "YOUTUBE_UPLOAD_LIMIT",
          userMessage:
            "This YouTube channel has reached its upload limit for now. Your content is saved; publishing will be retried later.",
          detail,
          retryable: true,
          retryAfterSeconds: wait ?? 7200,
          cause: err,
        });
      case "youtubeSignupRequired":
        return new AppError({
          code: "YOUTUBE_REJECTED",
          userMessage:
            "The connected Google account does not have a YouTube channel. Create a channel on that account, then reconnect.",
          detail,
          terminal: true,
          cause: err,
        });
      case "insufficientPermissions":
      case "forbidden":
      case "insufficientFilePermissions":
        return Errors.insufficientScope(detail);
      default:
        return new AppError({
          code: service === "drive" ? "DRIVE_UNAVAILABLE" : "YOUTUBE_UNAVAILABLE",
          userMessage:
            "Google refused this request. This usually means the connected account lacks a required permission. An administrator should reconnect the Google account.",
          detail,
          terminal: true,
          cause: err,
        });
    }
  }

  // 410 Gone — a resumable session Google has forgotten. Checked before 404
  // so it is not swallowed by the generic not-found handling below.
  if (status === 410) {
    return Errors.uploadSessionExpired();
  }

  if (status === 404) {
    if (service === "youtube") {
      return new AppError({
        code: "PLAYLIST_UNAVAILABLE",
        userMessage:
          "The selected playlist or video no longer exists on YouTube. Refresh the playlist list in Settings, then retry.",
        detail,
        terminal: true,
        cause: err,
      });
    }
    return new AppError({
      code: "DRIVE_UNAVAILABLE",
      userMessage:
        "The file could not be found in Google Drive. It may have been moved or deleted outside this app.",
      detail,
      terminal: true,
      cause: err,
    });
  }

  if (status === 400) {
    return new AppError({
      code: "YOUTUBE_REJECTED",
      userMessage:
        "Google rejected the details of this upload. Please check the title, description and tags, then try again.",
      detail,
      terminal: true,
      cause: err,
    });
  }

  if (status === 429) {
    return new AppError({
      code: "RATE_LIMITED",
      userMessage: "Google asked us to slow down. This will be retried automatically.",
      detail,
      retryable: true,
      retryAfterSeconds: wait ?? 60,
      cause: err,
    });
  }

  if (status !== undefined && status >= 500) {
    return new AppError({
      code: service === "drive" ? "DRIVE_UNAVAILABLE" : "YOUTUBE_UNAVAILABLE",
      userMessage:
        "Google is having trouble right now. Your content is safe — this will be retried automatically.",
      detail,
      retryable: true,
      retryAfterSeconds: wait,
      cause: err,
    });
  }

  return Errors.internal(detail, err);
}

/** Normalises anything thrown into an AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return Errors.internal(err.message, err);
  return Errors.internal(String(err), err);
}
