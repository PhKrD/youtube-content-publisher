import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

/**
 * Symmetric encryption for OAuth tokens at rest.
 *
 * Google refresh tokens are long-lived credentials for a third-party account.
 * A database dump must not be enough to publish to someone's YouTube channel,
 * so they are sealed with AES-256-GCM before they are ever written.
 *
 * Format:  v1.<iv-b64url>.<authTag-b64url>.<ciphertext-b64url>
 *
 * The version prefix exists so a future key rotation or algorithm change can
 * decrypt old rows while writing new ones.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;

/**
 * Additional authenticated data. Binds ciphertext to this application and
 * purpose, so a blob lifted from another column/system will not decrypt here.
 */
const AAD = Buffer.from("ycp:oauth-token:v1", "utf8");

function key(): Buffer {
  const k = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
  if (k.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes. Generate one with: openssl rand -base64 32",
    );
  }
  return k;
}

const b64u = (b: Buffer) => b.toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

/** Encrypts a UTF-8 string. Returns an opaque, self-describing token. */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSecret expects a string");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64u(iv), b64u(tag), b64u(ct)].join(".");
}

/**
 * Decrypts a token produced by `encryptSecret`.
 * Throws if the payload was tampered with, truncated, or encrypted under a
 * different key — GCM authentication makes silent corruption impossible.
 */
export function decryptSecret(payload: string): string {
  if (!payload || typeof payload !== "string") {
    throw new Error("decryptSecret: empty payload");
  }
  const parts = payload.split(".");
  if (parts.length !== 4) {
    throw new Error("decryptSecret: malformed payload");
  }
  const [version, ivS, tagS, ctS] = parts;
  if (version !== VERSION) {
    throw new Error(`decryptSecret: unsupported version "${version}"`);
  }

  const iv = unb64u(ivS);
  const tag = unb64u(tagS);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("decryptSecret: malformed payload");
  }

  const decipher = createDecipheriv(ALGORITHM, key(), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(unb64u(ctS)), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately opaque: do not leak whether the key or the data was wrong.
    throw new Error(
      "Stored credential could not be decrypted. TOKEN_ENCRYPTION_KEY may have changed; " +
        "the Google account must be reconnected.",
    );
  }
}

/** Encrypts only when a value is present, preserving null/undefined. */
export function encryptOptional(v: string | null | undefined): string | null {
  return v ? encryptSecret(v) : null;
}

export function decryptOptional(v: string | null | undefined): string | null {
  return v ? decryptSecret(v) : null;
}

/** True if `payload` looks like our envelope. Used to detect unmigrated rows. */
export function isEncrypted(payload: string | null | undefined): boolean {
  return typeof payload === "string" && payload.startsWith(`${VERSION}.`) && payload.split(".").length === 4;
}

// ---------------------------------------------------------------------------
// Hashing / comparison helpers
// ---------------------------------------------------------------------------

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Random URL-safe token, e.g. for invite links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Invite tokens are stored hashed, never raw — the same reasoning as password
 * storage. A leaked database cannot be used to accept invitations.
 */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Length-safe constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Compare digests so differing lengths do not short-circuit and leak length.
  const ah = createHash("sha256").update(ab).digest();
  const bh = createHash("sha256").update(bb).digest();
  return timingSafeEqual(ah, bh);
}
