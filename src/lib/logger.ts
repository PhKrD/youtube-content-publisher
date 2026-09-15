import { env } from "./env";

/**
 * Minimal structured logger with mandatory redaction (Section 54).
 *
 * The redaction pass is not advisory — every log call runs through it. Google
 * client libraries habitually attach full request/response objects to errors,
 * which is exactly how access tokens end up in log aggregators.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  try {
    return LEVEL_ORDER[env.LOG_LEVEL];
  } catch {
    return LEVEL_ORDER.info;
  }
}

/** Keys whose values are replaced wholesale, matched case-insensitively. */
const SENSITIVE_KEY = /(pass(word|phrase)?|secret|token|credential|authorization|auth|cookie|session|apikey|api_key|private_key|client_secret|refresh|bearer|signature)/i;

/** Keys that are safe despite matching above (avoid over-redacting). */
const ALLOWED_KEY = /^(tokenCount|hasRefreshToken|tokenExpiresAt|authMode|sessionCount|refreshedAt|needsReconsent)$/;

const REDACTED = "[redacted]";

/**
 * Google resumable-upload session URIs are bearer capabilities: anyone holding
 * one can write to the target file. They must not be logged in full.
 */
function scrubString(s: string): string {
  let out = s;
  // Resumable session URIs (Drive & YouTube) carry an `upload_id` capability.
  out = out.replace(/([?&](upload_id|upload_protocol)=)[^&\s"']+/gi, `$1${REDACTED}`);
  // OAuth authorization codes and tokens appearing in URLs or messages.
  out = out.replace(/([?&](code|access_token|refresh_token|id_token|client_secret|state)=)[^&\s"']+/gi, `$1${REDACTED}`);
  // Bearer headers.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g, `$1${REDACTED}`);
  // Google token shapes (ya29.* access tokens, 1//* refresh tokens).
  out = out.replace(/\bya29\.[A-Za-z0-9._-]+/g, REDACTED);
  out = out.replace(/\b1\/\/[A-Za-z0-9._-]{20,}/g, REDACTED);
  // Our own encryption envelope.
  out = out.replace(/\bv1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+/g, REDACTED);
  return out;
}

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      // Stack traces can embed URLs with tokens; scrub before emitting.
      stack: value.stack ? scrubString(value.stack) : undefined,
      ...(value.cause ? { cause: redact(value.cause, depth + 1, seen) } : {}),
    };
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((v) => redact(v, depth + 1, seen));
    }
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[buffer ${value.length}b]`;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k) && !ALLOWED_KEY.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redact(v, depth + 1, seen);
      }
    }
    return out;
  }
  return "[unknown]";
}

export type LogContext = Record<string, unknown>;

function emit(level: Level, message: string, context?: LogContext) {
  if (LEVEL_ORDER[level] < threshold()) return;

  const record = {
    level,
    time: new Date().toISOString(),
    message: scrubString(message),
    ...(context ? (redact(context) as LogContext) : {}),
  };

  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),

  /** Returns a logger that merges `base` into every call. */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit("debug", m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit("info", m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit("warn", m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit("error", m, { ...base, ...c }),
    };
  },
};

/** Exported for unit tests. */
export const __testing = { redact, scrubString };
