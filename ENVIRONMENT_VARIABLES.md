# Environment variables

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

🔒 marks a **secret**. Treat these like passwords: never in chat, screenshots,
tickets, logs or Git. Use different values in each environment.

---

## Required

### `DATABASE_URL` 🔒

PostgreSQL connection string used by the running application.

With Supabase, use the **Transaction pooler** string (port 6543) and keep the
pooler parameters:

```
postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

`connection_limit=1` matters on serverless: each function instance opens its
own pool, and without a limit you will exhaust the database's connections under
modest load.

Contains the database password, hence 🔒.

---

### `DIRECT_URL` 🔒

Direct (non-pooled) connection, port 5432. Used **only** by
`prisma migrate` / `db:deploy` / `db:seed`.

Migrations need session-level features — advisory locks, prepared statements —
that a transaction-mode pooler cannot proxy. Pointing migrations at the pooled
URL produces `prepared statement "s0" already exists`.

If your database has no separate pooler (local Postgres, Neon direct), set this
to the same value as `DATABASE_URL`.

---

### `AUTH_URL`

The public base URL of this application, with no trailing slash.

- Local: `http://localhost:3000`
- Production: `https://publisher.example.org`

Must exactly match what you registered in the Google Cloud Console. A mismatch
causes `redirect_uri_mismatch`.

---

### `AUTH_SECRET` 🔒

Signs and encrypts session cookies.

```bash
openssl rand -base64 32
```

Changing it signs everyone out. Must differ from `TOKEN_ENCRYPTION_KEY`.

---

### `TOKEN_ENCRYPTION_KEY` 🔒

Encrypts stored Google OAuth tokens at rest (AES-256-GCM). Must decode to
exactly 32 bytes.

```bash
openssl rand -base64 32
```

> ⚠️ **Back this up.** If it is lost or changed, every stored Google token
> becomes permanently undecryptable and an administrator must reconnect the
> Google account. The app detects this and says so, rather than failing
> mysteriously.

This is what makes a stolen database dump insufficient to publish to your
channel.

---

There are **two** OAuth clients, and therefore two pairs of credentials. They
are not interchangeable:

| Pair | Client | Scopes it requests | Redirect URI |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_*` | Sign-in | `openid email profile` | `/api/auth/callback/google` |
| `GOOGLE_PUBLISHING_CLIENT_*` | Publishing | YouTube + Drive | `/api/integrations/google/callback` |

Swapping them makes ordinary sign-in fail with `Error 400: invalid_request`
("scopes that cannot be requested together"), because Google will not issue
Drive and YouTube access in one approval.

### `GOOGLE_CLIENT_ID`

OAuth client ID of the **sign-in** client. Not secret — it is visible in the
browser during sign-in — but it is environment-specific.

Looks like `123456789-abcdefg.apps.googleusercontent.com`.

---

### `GOOGLE_CLIENT_SECRET` 🔒

The matching client secret. Looks like `GOCSPX-…`.

If it leaks, delete the OAuth client in the Google Cloud Console and create a
new one. Rotating it signs everyone out at most; it grants no access to your
channel or Drive.

---

### `GOOGLE_PUBLISHING_CLIENT_ID`

OAuth client ID of the **publishing** client — the one an admin uses to grant
YouTube and Drive access. Must be a *different* client from the sign-in one.

---

### `GOOGLE_PUBLISHING_CLIENT_SECRET` 🔒

The matching client secret.

This one is the sensitive half: it is the credential behind uploads to your
YouTube channel. If it leaks, delete that OAuth client in the Google Cloud
Console, create a new one, and have an admin reconnect both halves.

---

## Publishing safety

### `PUBLISHING_ENABLED`

`"true"` or `"false"` (default `"false"`).

The deployment-level kill switch. While this is false, the publishing engine
refuses every write to YouTube and records a clear reason.

This is only **half** the gate. An organisation must *also* have production
publishing enabled at `/admin/publishing`. Two independent switches mean a
production `.env` copied onto a laptop cannot by itself reach the live channel.

Keep it `"false"` in development.

---

### `APP_ENV`

`development` | `staging` | `production` (default `development`).

Anything other than `production` shows a persistent banner so nobody mistakes
one environment for another. Also controls Prisma client caching.

---

### `WORKER_SECRET` 🔒

Shared secret authenticating calls to `/api/jobs/tick`.

```bash
openssl rand -hex 32
```

Required if you drive the queue with a scheduler (Vercel Cron, GitHub Actions,
cron-job.org) rather than a long-running `npm run worker`. Without it that
endpoint refuses to run, and unauthenticated callers get a 404 rather than a
401 — the endpoint does not advertise itself.

---

## Optional

### `BOOTSTRAP_ADMIN_EMAIL`

During first-time setup, the first person signing in with this exact Google
address becomes the administrator of the seeded organisation.

Clear it once you have an admin account. Leaving it set means anyone who
gains control of that mailbox can claim admin.

---

### `SEED_ORG_NAME` / `SEED_ORG_SLUG`

Name and URL slug for the organisation created by `npm run db:seed`.
Defaults: `My Organization` / `default`.

---

### `RELAY_CHUNK_BYTES`

Bytes moved from Drive to YouTube per worker pass. Default `67108864` (64 MiB).

**Must be a multiple of 262144 (256 KiB)** — a Google requirement for
resumable upload chunks. The app validates this at startup and refuses to run
with a bad value.

- Larger: fewer round trips, more memory per worker, more lost on a failure.
- Smaller: more resilient, slower.

64 MiB comfortably completes inside a 300-second serverless invocation.

---

### `LOG_LEVEL`

`debug` | `info` | `warn` | `error` (default `info`).

`debug` is verbose but still redacts credentials — redaction is applied to
every log call regardless of level.

---

## Quick reference

| Variable | Required | Secret | Default |
|---|:---:|:---:|---|
| `DATABASE_URL` | ✅ | 🔒 | — |
| `DIRECT_URL` | ✅ | 🔒 | falls back to `DATABASE_URL` |
| `AUTH_URL` | ✅ | | — |
| `AUTH_SECRET` | ✅ | 🔒 | — |
| `TOKEN_ENCRYPTION_KEY` | ✅ | 🔒 | — |
| `GOOGLE_CLIENT_ID` | ✅ | | `""` |
| `GOOGLE_CLIENT_SECRET` | ✅ | 🔒 | `""` |
| `GOOGLE_PUBLISHING_CLIENT_ID` | ✅ | | `""` |
| `GOOGLE_PUBLISHING_CLIENT_SECRET` | ✅ | 🔒 | `""` |
| `PUBLISHING_ENABLED` | | | `false` |
| `APP_ENV` | | | `development` |
| `WORKER_SECRET` | for cron | 🔒 | `""` |
| `BOOTSTRAP_ADMIN_EMAIL` | first run | | `""` |
| `SEED_ORG_NAME` | | | `My Organization` |
| `SEED_ORG_SLUG` | | | `default` |
| `RELAY_CHUNK_BYTES` | | | `67108864` |
| `LOG_LEVEL` | | | `info` |

---

## How configuration is validated

Validation is **lazy**: importing the config never throws, because `next build`
legitimately runs without a database. A missing or malformed value throws a
precise error at the point it is first needed, naming the variable and how to
fix it.

`/admin/health` validates everything eagerly and shows the result, which is the
quickest way to check a deployment is configured correctly.
