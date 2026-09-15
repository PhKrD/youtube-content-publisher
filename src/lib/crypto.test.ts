import { describe, expect, it } from "vitest";
import {
  decryptOptional,
  decryptSecret,
  encryptOptional,
  encryptSecret,
  hashToken,
  isEncrypted,
  randomToken,
  safeEqual,
  sha256Hex,
} from "./crypto";

/**
 * These tests defend a specific threat model: an attacker who obtains a
 * database dump must not be able to recover a Google refresh token, and must
 * not be able to tamper with one undetectably.
 */

const REFRESH_TOKEN = "1//0gFakeRefreshTokenValueForTesting_abcdefghijklmnop";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    expect(decryptSecret(encryptSecret(REFRESH_TOKEN))).toBe(REFRESH_TOKEN);
  });

  it("never emits the plaintext", () => {
    const ct = encryptSecret(REFRESH_TOKEN);
    expect(ct).not.toContain(REFRESH_TOKEN);
    expect(ct).not.toContain("0gFakeRefresh");
  });

  it("produces different ciphertext each time (random nonce)", () => {
    // Deterministic ciphertext would leak that two orgs share a token.
    expect(encryptSecret(REFRESH_TOKEN)).not.toBe(encryptSecret(REFRESH_TOKEN));
  });

  it("uses a versioned envelope", () => {
    expect(encryptSecret("x").startsWith("v1.")).toBe(true);
    expect(encryptSecret("x").split(".")).toHaveLength(4);
  });

  it("handles unicode and empty strings", () => {
    expect(decryptSecret(encryptSecret("श्री कृष्ण 👍"))).toBe("श्री कृष्ण 👍");
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("handles a long value", () => {
    const long = "a".repeat(10_000);
    expect(decryptSecret(encryptSecret(long))).toBe(long);
  });

  it("rejects a tampered ciphertext (GCM authentication)", () => {
    const parts = encryptSecret(REFRESH_TOKEN).split(".");
    // Flip a character in the ciphertext segment.
    const ch = parts[3][0] === "A" ? "B" : "A";
    parts[3] = ch + parts[3].slice(1);
    expect(() => decryptSecret(parts.join("."))).toThrow(/could not be decrypted/i);
  });

  it("rejects a tampered auth tag", () => {
    const parts = encryptSecret(REFRESH_TOKEN).split(".");
    const ch = parts[2][0] === "A" ? "B" : "A";
    parts[2] = ch + parts[2].slice(1);
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a swapped nonce", () => {
    const a = encryptSecret("value-a").split(".");
    const b = encryptSecret("value-b").split(".");
    expect(() => decryptSecret([a[0], b[1], a[2], a[3]].join("."))).toThrow();
  });

  it("rejects malformed and unknown-version payloads", () => {
    expect(() => decryptSecret("")).toThrow(/empty payload/i);
    expect(() => decryptSecret("garbage")).toThrow(/malformed/i);
    expect(() => decryptSecret("v1.a.b")).toThrow(/malformed/i);
    expect(() => decryptSecret("v9.a.b.c")).toThrow(/unsupported version/i);
  });

  it("rejects a payload whose nonce is the wrong length", () => {
    const parts = encryptSecret("x").split(".");
    parts[1] = Buffer.alloc(8).toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow(/malformed/i);
  });
});

describe("optional helpers", () => {
  it("preserve null and undefined", () => {
    expect(encryptOptional(null)).toBeNull();
    expect(encryptOptional(undefined)).toBeNull();
    expect(encryptOptional("")).toBeNull();
    expect(decryptOptional(null)).toBeNull();
  });

  it("round-trip a present value", () => {
    expect(decryptOptional(encryptOptional("abc"))).toBe("abc");
  });
});

describe("isEncrypted", () => {
  it("recognises our envelope and rejects plaintext", () => {
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
    expect(isEncrypted("1//plain-refresh-token")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });
});

describe("hashing", () => {
  it("sha256Hex is stable and 64 hex chars", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("invite tokens are stored hashed, not raw", () => {
    const t = randomToken();
    const h = hashToken(t);
    expect(h).not.toBe(t);
    expect(h).toHaveLength(64);
    expect(hashToken(t)).toBe(h);
  });

  it("randomToken is url-safe and unique", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(randomToken());
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
  });

  it("rejects different strings, including differing lengths", () => {
    expect(safeEqual("secret", "secrew")).toBe(false);
    expect(safeEqual("short", "muchlongervalue")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
