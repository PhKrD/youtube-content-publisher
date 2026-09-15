import { z } from "zod";

/**
 * Validated server-side configuration.
 *
 * IMPORTANT: this module must never be imported from a Client Component — it
 * reads process.env and would leak secrets into the browser bundle. Anything
 * the browser legitimately needs is exposed through explicit `NEXT_PUBLIC_*`
 * values or returned from an API route.
 *
 * Validation is *lazy*. Importing this file never throws, because `next build`
 * legitimately runs without a database or OAuth client configured. Reading a
 * missing or malformed variable throws a precise, actionable error at the
 * moment it is actually needed.
 */

/** Accepts "true"/"1"/"yes"/"on" (case-insensitive) as true. */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    return ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
  });

/** Base64-encoded 32-byte key, as produced by `openssl rand -base64 32`. */
const base64Key32 = z.string().refine(
  (v) => {
    try {
      return Buffer.from(v, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "must be a base64-encoded 32-byte value (openssl rand -base64 32)" },
);

const envSchema = z.object({
  // --- database ---
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),

  // --- app auth ---
  AUTH_URL: z.string().url("AUTH_URL must be an absolute URL, e.g. http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
  TOKEN_ENCRYPTION_KEY: base64Key32,

  // --- google oauth (identity only) ---
  // Default to "" so the app boots and can render the setup wizard, which is
  // what tells the admin to go and create these.
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),

  // --- google oauth (publishing integration) ---
  // Separate OAuth client with youtube.upload and drive.file scopes
  GOOGLE_PUBLISHING_CLIENT_ID: z.string().default(""),
  GOOGLE_PUBLISHING_CLIENT_SECRET: z.string().default(""),

  // --- publishing safety ---
  PUBLISHING_ENABLED: booleanish.default(false),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  WORKER_SECRET: z.string().default(""),

  // --- optional ---
  BOOTSTRAP_ADMIN_EMAIL: z.string().default(""),
  SEED_ORG_NAME: z.string().default("My Organization"),
  SEED_ORG_SLUG: z.string().default("default"),
  RELAY_CHUNK_BYTES: z.coerce
    .number()
    .int()
    .positive()
    // Google requires resumable chunks to be a multiple of 256 KiB.
    .refine((n) => n % 262144 === 0, {
      message: "RELAY_CHUNK_BYTES must be a multiple of 262144 (256 KiB)",
    })
    .default(67108864),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;
let cachedError: Error | null = null;

function load(): Env {
  if (cached) return cached;
  if (cachedError) throw cachedError;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    cachedError = new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        `Copy .env.example to .env and fill in the values. ` +
        `See ENVIRONMENT_VARIABLES.md for details.`,
    );
    throw cachedError;
  }
  cached = parsed.data;
  return cached;
}

/**
 * Lazily-validated environment. Property access triggers validation, so the
 * error surfaces where the value is used rather than at import time.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return load()[prop as keyof Env];
  },
  has(_target, prop: string) {
    return prop in load();
  },
  ownKeys() {
    return Reflect.ownKeys(load());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return { ...Reflect.getOwnPropertyDescriptor(load(), prop), configurable: true };
  },
});

/**
 * Eagerly validate. Call from health checks and from the worker on startup so
 * misconfiguration is reported immediately rather than on first request.
 */
export function assertEnv(): { ok: true } | { ok: false; error: string } {
  try {
    load();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** True when Google OAuth credentials have been configured at all. */
export function isGoogleOAuthConfigured(): boolean {
  try {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  } catch {
    return false;
  }
}

/** True when Google Publishing OAuth credentials have been configured at all. */
export function isGooglePublishingOAuthConfigured(): boolean {
  try {
    return Boolean(env.GOOGLE_PUBLISHING_CLIENT_ID && env.GOOGLE_PUBLISHING_CLIENT_SECRET);
  } catch {
    return false;
  }
}

export function isProduction(): boolean {
  try {
    return env.APP_ENV === "production";
  } catch {
    return false;
  }
}

/**
 * The deployment-wide publishing kill-switch (Section 40).
 *
 * This is only HALF of the gate: an organization must ALSO have
 * `productionPublishingEnabled` set. Both are checked in
 * `assertPublishingAllowed()`. Two independent switches mean a copied
 * production .env alone cannot cause a dev machine to publish for real.
 */
export function isPublishingEnabledGlobally(): boolean {
  try {
    return env.PUBLISHING_ENABLED === true;
  } catch {
    return false;
  }
}

/** OAuth redirect URI for user sign-in (handled by Auth.js). */
export function authCallbackUrl(): string {
  return `${env.AUTH_URL.replace(/\/$/, "")}/api/auth/callback/google`;
}

/** OAuth redirect URI for the separate publishing-account connection. */
export function integrationCallbackUrl(): string {
  return `${env.AUTH_URL.replace(/\/$/, "")}/api/integrations/google/callback`;
}
