import { describe, expect, it } from "vitest";
import { __testing } from "./logger";

const { redact, scrubString } = __testing;

/**
 * Section 54 forbids logging credentials. Redaction is applied to every log
 * call, so these tests are the thing standing between a Gaxios error object
 * and an access token in a log aggregator.
 */

describe("scrubString", () => {
  it("redacts the upload_id capability in a resumable session URI", () => {
    const uri =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=ABC123secret";
    const out = scrubString(uri);
    expect(out).not.toContain("ABC123secret");
    expect(out).toContain("upload_id=[redacted]");
  });

  it("redacts OAuth authorization codes and tokens in URLs", () => {
    const out = scrubString("GET /callback?code=4/0AXsecretcode&state=xyz");
    expect(out).not.toContain("4/0AXsecretcode");
    expect(out).not.toContain("xyz");
  });

  it("redacts Google access and refresh token shapes", () => {
    expect(scrubString("token ya29.a0AfH6SMBxxxxxxxxxxxx")).not.toContain("ya29.a0");
    expect(scrubString("refresh 1//0gABCDEFGHIJKLMNOPQRSTUV")).not.toContain("1//0gABCDEF");
  });

  it("redacts Bearer headers", () => {
    expect(scrubString("Authorization: Bearer abcdef123456")).not.toContain("abcdef123456");
  });

  it("redacts our own encryption envelope", () => {
    const envelope = "v1.aaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbb.cccccccccccc";
    expect(scrubString(`stored ${envelope}`)).not.toContain("aaaaaaaaaaaaaaaaaa");
  });

  it("leaves ordinary text untouched", () => {
    expect(scrubString("Published video for Bhagavad Gita Session 01")).toBe(
      "Published video for Bhagavad Gita Session 01",
    );
  });
});

describe("redact", () => {
  it("replaces values of sensitive keys", () => {
    const out = redact({
      accessToken: "ya29.secret",
      refreshTokenEnc: "v1.a.b.c",
      client_secret: "GOCSPX-xyz",
      password: "hunter2",
      cookie: "session=abc",
      title: "Gita Session",
    }) as Record<string, unknown>;

    expect(out.accessToken).toBe("[redacted]");
    expect(out.refreshTokenEnc).toBe("[redacted]");
    expect(out.client_secret).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    // Non-sensitive fields must survive, or logs become useless.
    expect(out.title).toBe("Gita Session");
  });

  it("redacts nested sensitive keys", () => {
    const out = redact({
      integration: { email: "a@b.com", accessTokenEnc: "v1.x.y.z" },
    }) as { integration: Record<string, unknown> };
    expect(out.integration.accessTokenEnc).toBe("[redacted]");
    expect(out.integration.email).toBe("a@b.com");
  });

  it("keeps explicitly allow-listed diagnostic keys", () => {
    const out = redact({ hasRefreshToken: true, tokenExpiresAt: "2026-01-01" }) as Record<
      string,
      unknown
    >;
    expect(out.hasRefreshToken).toBe(true);
    expect(out.tokenExpiresAt).toBe("2026-01-01");
  });

  it("scrubs token shapes inside an Error message and stack", () => {
    const err = new Error("failed for ya29.leakedtoken at upload_id=xyzsecret");
    const out = redact({ error: err }) as { error: { message: string } };
    expect(out.error.message).not.toContain("ya29.leakedtoken");
    expect(out.error.message).not.toContain("xyzsecret");
  });

  it("scrubs a nested error cause", () => {
    const inner = new Error("bearer leak: Bearer abcdef123456");
    const outer = new Error("wrapper", { cause: inner });
    const out = redact({ error: outer }) as { error: { cause: { message: string } } };
    expect(out.error.cause.message).not.toContain("abcdef123456");
  });

  it("survives circular references", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain("[circular]");
  });

  it("serialises BigInt (Prisma returns these for byte counts)", () => {
    // JSON.stringify throws on BigInt, which would break every log line
    // that mentions a file size.
    const out = redact({ sizeBytes: 123n }) as Record<string, unknown>;
    expect(out.sizeBytes).toBe("123");
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("summarises Buffers rather than dumping them", () => {
    const out = redact({ chunk: Buffer.alloc(1024) }) as Record<string, unknown>;
    expect(out.chunk).toBe("[buffer 1024b]");
  });

  it("caps array length and recursion depth", () => {
    const big = Array.from({ length: 500 }, (_, i) => i);
    expect((redact({ big }) as { big: unknown[] }).big).toHaveLength(50);

    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain("[depth-limit]");
  });

  it("converts Dates to ISO strings", () => {
    const out = redact({ at: new Date("2026-09-15T00:00:00Z") }) as Record<string, unknown>;
    expect(out.at).toBe("2026-09-15T00:00:00.000Z");
  });
});
