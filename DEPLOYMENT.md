# Deployment

## The one decision that matters

This application has two parts: the **web app** and the **publishing worker**.

The web app is ordinary Next.js and runs anywhere. The worker moves video bytes
from Google Drive to YouTube, and how you run it determines your hosting shape.

The worker is written so that **either** approach is correct — every step
persists its progress, so a worker killed mid-upload resumes at the right byte:

| Approach | Good for | Trade-off |
|---|---|---|
| **A. Long-running process** | Any host with a background container | Needs a second service |
| **B. Scheduled HTTP tick** | Vercel-only deployments | Uploads progress in 5-minute steps |

Start with **A** unless you are committed to Vercel.

---

## Recommended: Vercel + Supabase + a worker

Roughly £0–15/month at small scale.

| Component | Service | Cost |
|---|---|---|
| Web app | Vercel Hobby/Pro | Free – $20/mo |
| Database | Supabase | Free – $25/mo |
| Worker | Railway / Render / Fly.io | Free – $5/mo |
| Media storage | Google Drive | Free to 15 GB, then Google One |
| YouTube API | Google Cloud | Free (quota-limited) |

### 1. Database

Create a Supabase project. From **Project Settings → Database**, copy the
**Transaction pooler** string for `DATABASE_URL` and the **direct** string for
`DIRECT_URL`.

Run migrations from your machine, pointed at production:

```bash
DIRECT_URL="postgresql://…:5432/postgres" npm run db:deploy
DIRECT_URL="postgresql://…:5432/postgres" npm run db:seed
```

### 2. Web app on Vercel

```bash
npm i -g vercel
vercel link
vercel --prod
```

Set the environment variables in **Project Settings → Environment Variables**:

```
DATABASE_URL           (pooled, with ?pgbouncer=true&connection_limit=1)
DIRECT_URL             (direct)
AUTH_URL               https://your-domain.com
AUTH_SECRET            fresh value — NOT the one from development
TOKEN_ENCRYPTION_KEY   fresh value — NOT the one from development
GOOGLE_CLIENT_ID                 sign-in client
GOOGLE_CLIENT_SECRET             sign-in client
GOOGLE_PUBLISHING_CLIENT_ID      publishing client (YouTube + Drive)
GOOGLE_PUBLISHING_CLIENT_SECRET  publishing client
PUBLISHING_ENABLED     "false" for the first deploy
APP_ENV                "production"
WORKER_SECRET          openssl rand -hex 32
```

> Generate **new** `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` for production.
> Reusing development secrets means a leak in one environment compromises both.
> Store `TOKEN_ENCRYPTION_KEY` in a password manager — losing it forces a
> Google reconnect.

### 3. Update Google Cloud for the real domain

At [Credentials](https://console.cloud.google.com/apis/credentials), open
**both** OAuth clients and add the production redirect URI to each. They get
one URI each — the clients are not interchangeable:

**Sign-in client → Authorised redirect URIs**
```
https://your-domain.com/api/auth/callback/google
```

**Publishing client → Authorised redirect URIs**
```
https://your-domain.com/api/integrations/google/callback
```

Keep the localhost entries so local development still works.

`AUTH_URL` must match the host users actually visit, character for character —
the callback URL is derived from it. If you deploy to Vercel, use your stable
production domain, not a per-deployment URL like
`myapp-a1b2c3-team.vercel.app`, or every deploy invalidates the registered
redirect URI and sign-in fails with `redirect_uri_mismatch`.

### 4. The worker

#### Option A — long-running (recommended)

On Railway, Render or Fly.io, create a service from the same repository with:

- **Build**: `npm ci && npx prisma generate`
- **Start**: `npm run worker`
- **Environment**: `DATABASE_URL`, `DIRECT_URL`, `TOKEN_ENCRYPTION_KEY`,
  `GOOGLE_PUBLISHING_CLIENT_ID`, `GOOGLE_PUBLISHING_CLIENT_SECRET`,
  `PUBLISHING_ENABLED`, `APP_ENV`

The worker needs `TOKEN_ENCRYPTION_KEY` because it decrypts the Google tokens
itself. It does **not** need `AUTH_SECRET` or `AUTH_URL`.

One worker is enough for most organisations. Several can run safely — job
claiming uses `FOR UPDATE SKIP LOCKED`, so they take different jobs.

#### Option B — scheduled tick (Vercel only)

Add `vercel.json`:

```json
{
  "crons": [{ "path": "/api/jobs/tick", "schedule": "*/5 * * * *" }]
}
```

Vercel Cron sends no custom headers, so protect the endpoint by putting
`WORKER_SECRET` in the path via a rewrite, or call it from GitHub Actions
instead:

```yaml
name: Publishing worker
on:
  schedule: [{ cron: "*/5 * * * *" }]
  workflow_dispatch:
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "${{ secrets.APP_URL }}/api/jobs/tick" \
            -H "x-worker-secret: ${{ secrets.WORKER_SECRET }}"
```

**Understand the trade-off.** Each invocation moves what it can within its time
limit (300s on Vercel Pro, 60s on Hobby) and then yields. A 2 GB video may take
several ticks. It will complete — just not in one pass. Option A uploads it in
one go.

### 5. First production run

1. Sign in with `BOOTSTRAP_ADMIN_EMAIL` set, then clear that variable.
2. Work through `/setup`.
3. Publish one **Private** test video end to end.
4. Only then set `PUBLISHING_ENABLED="true"` and enable production publishing
   at `/admin/publishing`.

---

## Alternative hosts

### Single container

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
```

Run the worker as a second container from the same image with
`CMD ["npm", "run", "worker"]`.

### Self-hosted

Put Nginx or Caddy in front for TLS, run the app under a process manager, and
run the worker as a separate service. HTTPS is not optional — OAuth requires it
for any non-localhost redirect URI.

---

## Operations

### Backups

The database holds submissions, review history, the audit trail and the
**encrypted Google tokens**. Media lives in Google Drive and is not part of a
database backup.

- Supabase Pro takes daily backups automatically. On the free tier, schedule
  your own `pg_dump`.
- Back up `TOKEN_ENCRYPTION_KEY` separately, in a password manager. A database
  backup restored without it leaves every token unreadable.
- 🔒 Database dumps contain personal data and encrypted credentials. Store them
  as you would the database itself.

### Migrations on deploy

```bash
npm run db:deploy
```

Run it as a release step, not at container start — several instances starting
at once would race. Prisma takes an advisory lock, but a dedicated step is
clearer and fails loudly.

Verify migrations before deploying:

```bash
npm run test:migrations
```

This applies every migration to an in-process PostgreSQL and asserts the
constraints behave. No database needed.

### Monitoring

- **`/admin/health`** — database, config, Google, publishing gates, worker.
  The fastest check that a deployment is sound.
- Logs are structured JSON with `level`, `time`, `message` and a `code`.
  Credentials are redacted at source, so they are safe to ship to any log
  aggregator.

Worth alerting on:

| Signal | Meaning |
|---|---|
| `"publish job failed"` with `terminal: true` | Needs a human |
| `"reclaimed expired job leases"` repeatedly | Worker is crashing |
| `GOOGLE_REAUTH_REQUIRED` | Publishing is stopped until an admin reconnects |
| Health shows an expired lease | No worker is running |

### Scaling

The first limit you will hit is **YouTube API quota**, not infrastructure:
10,000 units/day by default, ~1,600 per upload, so roughly six videos a day.
Request an increase in the Google Cloud Console well before you need it —
approval requires an audit and takes time.

Because uploads go browser → Google directly, video volume costs you no
bandwidth and puts no load on the web tier.

---

## Cost summary

**Free** — Vercel Hobby, Supabase free tier, Google Drive to 15 GB, YouTube API
default quota, a free-tier worker. Enough for a small team publishing a few
videos a week.

**Low cost (~£25/month)** — Supabase Pro for daily backups, a paid worker
instance, Google One for storage beyond 15 GB.

**Paid at scale** — Vercel Pro for 300-second functions, increased YouTube
quota (free but requires audit), larger database, Google Workspace for Internal
OAuth without the 7-day refresh-token expiry.
