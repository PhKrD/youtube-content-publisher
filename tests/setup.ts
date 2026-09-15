/**
 * Test bootstrap.
 *
 * Deliberately sets fake-but-well-formed secrets so modules that read `env`
 * (crypto, logger) work without a real .env, while guaranteeing the suite can
 * never accidentally touch a real database or publish to a real channel:
 * PUBLISHING_ENABLED is forced off and the database URL points nowhere.
 */

process.env.APP_ENV = "development";
process.env.PUBLISHING_ENABLED = "false";
process.env.AUTH_URL = "http://localhost:3000";
process.env.AUTH_SECRET = "test-auth-secret-value-at-least-32-chars-long";
// 32 zero bytes, base64 — valid shape, obviously not a real key.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL ??= "postgresql://invalid:invalid@127.0.0.1:1/none";
process.env.LOG_LEVEL = "error";
