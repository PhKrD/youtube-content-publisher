# Channel Publisher

A web application for preparing, reviewing and publishing video content to
YouTube, with Google Drive as the media store.

Built so that a student can record something on their phone and get it onto an
organisation's YouTube channel — correctly titled, described, tagged and filed
into the right playlist — without writing a YouTube description by hand or
being able to publish to the wrong place by accident.

```
Student → upload → fill in a few fields → preview → submit
                                                      ↓
                                          Reviewer approves
                                                      ↓
                          Upload to YouTube → thumbnail → playlist → verify
```

---

## What it does

**For contributors**
- Upload large videos straight from a phone or laptop. Uploads resume after a
  dropped connection or a closed browser.
- Fill in Programme / Topic / Speaker and a short summary. The full YouTube
  title and description are generated from templates.
- See a live preview of exactly what YouTube will receive, and a checklist of
  anything still missing.

**For reviewers**
- A queue of submissions, oldest first, with the video, thumbnail and final
  metadata in one place.
- Approve, request changes, or reject with a comment. Nobody can approve their
  own submission.

**For administrators**
- Connect one Google account for the whole organisation; contributors never
  consent to YouTube access.
- Templates with **locked sections** — official links, contact details and
  mandatory hashtags that contributors cannot edit or remove.
- A confirmed-channel requirement and a production publishing switch, so
  nothing reaches YouTube until you say so.
- Audit log, system health, per-user roles and publishing rights.

---

## Quick start

```bash
npm install
cp .env.example .env     # then fill it in — see SETUP_GUIDE.md
npm run db:deploy        # create the tables
npm run db:seed          # starter templates and tag groups
npm run dev              # http://localhost:3000
npm run worker           # in a second terminal
```

**Read [SETUP_GUIDE.md](./SETUP_GUIDE.md) first.** It walks through the Google
Cloud configuration step by step. You will never be asked for a Google
password.

---

## Documentation

| Document | What it covers |
|---|---|
| [SETUP_GUIDE.md](./SETUP_GUIDE.md) | Google Cloud, environment, first run, going live |
| [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) | Every variable, what it does, which are secret |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production hosting, the worker, backups, costs |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Specific errors and what to do about them |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How it works and why it is built this way |

---

## Technology

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, Radix UI primitives |
| Database | PostgreSQL via Prisma 7 (`pg` driver adapter) |
| Auth | Auth.js v5, Google sign-in, database sessions |
| Storage | Google Drive (`drive.file` scope only) |
| Publishing | YouTube Data API v3 |
| Queue | PostgreSQL (`FOR UPDATE SKIP LOCKED`) — no Redis |

---

## Three decisions worth knowing

**Uploads bypass the server.** The browser sends bytes directly to Google using
a resumable session the server creates on its behalf. No video ever passes
through this application, so there is no request-size limit to hit and no
bandwidth bill. The access token is never exposed to the browser.

**Publishing cannot duplicate.** A partial unique index in PostgreSQL permits
at most one active publish job per submission, so a double-click loses the race
in the database rather than in application logic. Each step records its own
completion, so a retry after "video uploaded but playlist failed" retries only
the playlist — it can never upload a second video.

**Two switches guard the real channel.** A deployment-level environment flag
*and* a per-organisation setting must both be on, and an administrator must
have confirmed the channel by typing its name. A production `.env` copied onto
a laptop cannot, by itself, publish anything.

---

## Development

```bash
npm run dev            # dev server
npm run build          # production build (fails on type errors)
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # unit tests + migration verification
npm run db:studio      # browse the database
npm run worker         # background publishing worker
```

### Tests

```bash
npm run test:unit        # 111 unit tests (vitest)
npm run test:migrations  # applies every migration to an in-process Postgres
```

`test:migrations` runs the real SQL against PGlite (PostgreSQL compiled to
WebAssembly) and asserts that each constraint actually behaves — that a second
active publish job is rejected, that a scheduled video cannot be public, and so
on. No Docker or database required.

---

## Status

Working and tested end to end against the real Google APIs is **not** something
this repository can prove on its own — that requires your credentials. What is
verified here:

- ✅ Production build, type check and lint all clean
- ✅ 111 unit tests covering the template engine, validation, token encryption
  and log redaction
- ✅ 19 database integrity checks against real PostgreSQL
- ⚠️ Live Google Drive and YouTube calls require the setup in SETUP_GUIDE.md

Known limitations are listed in [ARCHITECTURE.md](./ARCHITECTURE.md#known-limitations).

---

## Security

- OAuth tokens are encrypted with AES-256-GCM before being written to the
  database.
- Tokens, authorization codes and upload capability URLs are redacted from
  every log line.
- Access is invitation-only; sessions live in the database so disabling a user
  takes effect immediately.
- All authorisation is enforced server-side. The UI hides what you cannot do,
  but hiding a button is not the control.

Please report security issues privately rather than opening a public issue.
