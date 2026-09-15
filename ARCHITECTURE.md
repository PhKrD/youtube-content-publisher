# Architecture

Why this is built the way it is. Read this before changing the publishing
engine or the upload path.

---

## The upload path

**Bytes never pass through this application.**

```
Browser ──PUT chunks──▶ Google Drive          (resumable session)
   ▲                         │
   │ session URI             │
   │                         ▼
Our server ◀──creates──  Drive API      Worker ──chunks──▶ YouTube
```

The server creates a *resumable upload session* using the organisation's OAuth
token and returns only the session URI to the browser. The browser then PUTs
chunks straight to Google.

### Why not proxy through the server?

It was considered and rejected:

| Option | Verdict |
|---|---|
| Browser → server → Drive | Vercel caps request bodies at 4.5 MB; serverless functions time out; doubles bandwidth cost. Unworkable for video. |
| Browser → temp storage → Drive | Extra hop, extra bill, extra failure mode, no benefit. |
| **Browser → Drive directly** | **Chosen.** No size limit, no egress cost, resumable, and the access token never reaches the browser. |

### Is handing the session URI to the browser safe?

The session URI is a capability: whoever holds it can write to that one file.
Acceptable because it is scoped to a single file in a folder we created,
expires in about a week, cannot read anything, and is only issued to a user
already authorised to edit that submission. It is treated as a secret — never
logged, and cleared from the database once the upload completes.

This is Google's documented pattern for client-side resumable uploads.

### Resumption

The resume offset is **always read from Google**, never from anything the
client remembered. A zero-length `PUT` with `Content-Range: bytes */total`
returns `308` plus the committed range. This is what makes recovery work after
a dropped connection, a refreshed tab or a closed browser.

---

## Drive → YouTube: the chunked relay

YouTube has no "import from Drive" endpoint, so bytes must physically move
through something.

Streaming a whole 5 GB file through one long-lived process cannot survive a
serverless time limit, a deploy, or a crash. Instead the worker moves a
**bounded, 256 KiB-aligned window** per pass and persists the committed offset
after each one:

```
loop:
  read  bytes [offset, offset+chunk)  from Drive   (ranged GET)
  write those bytes                   to YouTube   (Content-Range PUT)
  offset ← YouTube's own Range response header
  persist offset
  if out of time: return — another worker resumes here
```

Two consequences worth stating:

- The offset comes from **YouTube's response**, not from what we believe we
  sent. A partially-accepted chunk would otherwise desynchronise the stream and
  corrupt the video.
- Memory is bounded by the chunk size regardless of file size.

The same code therefore runs correctly under a 300-second cron *or* a
long-lived container.

---

## Idempotency: why publishing cannot duplicate

Three independent mechanisms, deliberately layered.

### 1. The database rejects a second active job

```sql
CREATE UNIQUE INDEX publishingjob_one_active_per_submission
  ON "PublishingJob" ("submissionId")
  WHERE "state" IN ('QUEUED', 'RUNNING', 'WAITING_RETRY');
```

A double-click, two admins clicking at once, or a retry racing the worker — the
second `INSERT` fails with a unique violation, which the application translates
into "this is already being published". Application-level checks lose races;
a unique index does not.

Terminal states are excluded so history is kept and a genuinely failed
submission can be re-queued.

### 2. Each step records its own completion

`YouTubePublication` is the durable evidence of what has irreversibly happened:

| Column | Set when |
|---|---|
| `youtubeVideoId` | the video exists on YouTube |
| `videoUploadedAt` | bytes finished |
| `thumbnailAppliedAt` | thumbnail set |
| `playlistAddedAt` | added to the playlist |
| `verifiedAt` | YouTube confirmed the final state |

Every step checks for its own evidence before acting. A retry after "video
uploaded but playlist failed" skips straight to the playlist. **It is not
possible for a retry to upload a second video**, because the recorded video ID
makes the upload step a no-op.

### 3. Remote state is checked before acting

The playlist step asks YouTube whether the video is *already* in the playlist
before inserting. If a previous attempt succeeded but crashed before recording
it, this prevents a duplicate playlist entry.

Plus `YouTubePublication.submissionId` and `.youtubeVideoId` are both unique,
so the database forbids two publications per submission and reusing a video ID.

---

## The job queue

PostgreSQL, not Redis:

```sql
UPDATE "PublishingJob" SET state='RUNNING', ...
 WHERE id = (
   SELECT id FROM "PublishingJob"
    WHERE state IN ('QUEUED','WAITING_RETRY') AND "runAfter" <= now()
    ORDER BY "runAfter" LIMIT 1
    FOR UPDATE SKIP LOCKED
 ) RETURNING id
```

- No extra infrastructure, no extra bill.
- Enqueueing the job and changing the submission's status happen in **one
  transaction**, so they can never disagree — the classic failure mode of a
  separate broker.
- `SKIP LOCKED` means N workers take N different jobs.

Jobs are **leased**, not merely marked running. A worker killed mid-upload
leaves an expired lease and the job returns to the queue. That is only safe
because every step is idempotent.

Retries use exponential backoff with jitter, so a Google outage does not
produce a synchronised stampede on recovery. Errors are classified
`retryable` vs `terminal` — retrying a revoked token wastes quota and delays
the human intervention actually required.

---

## Two Google flows, on purpose

| | Sign-in | Publishing |
|---|---|---|
| Who | every user | one administrator |
| Scopes | `openid email profile` | `drive.file`, `youtube.upload`, `youtube` |
| Stored | Auth.js session | `IntegrationAccount`, encrypted |
| Endpoint | `/api/auth/callback/google` | `/api/integrations/google/callback` |

Asking every student to grant upload access to the organisation's channel would
be both a consent-screen nightmare and a least-privilege violation. One admin
consents; everyone else just signs in.

The publishing flow adds **PKCE** and a **state cookie**. State prevents an
attacker completing consent inside an admin's session and silently repointing
the organisation at their own channel. PKCE prevents an intercepted
authorization code being redeemed elsewhere.

### Why `drive.file` and not `drive`

`drive.file` grants access **only to files this app created**. It cannot read
the administrator's existing documents or photos.

The cost is that the app must create its own root folder rather than adopting
an existing one. Letting an admin pick any folder would require full `drive`
scope — handing this application their entire Drive — which is not a reasonable
price for that convenience.

---

## Security

**Tokens encrypted at rest.** Google refresh tokens are long-lived credentials
for a third-party account. They are sealed with AES-256-GCM before being
written, with an AAD binding them to this application and purpose. A database
dump is not enough to publish to your channel. GCM authentication means tampering
is detected rather than silently decrypting to garbage.

**Redaction is mandatory, not conventional.** Every log call passes through a
scrubber that removes token shapes (`ya29.*`, `1//*`), `Bearer` headers, OAuth
codes, resumable-upload capability URLs and our own ciphertext envelope —
including inside error messages and stack traces, because Google's client
libraries habitually attach full request objects to errors.

**Authorisation is server-side.** All rules live in `src/lib/authz.ts` and are
evaluated on the server. The UI hides what you cannot do, but hiding a button
is cosmetic. `PATCH /api/submissions/[id]` deliberately refuses `status`,
`computedTitle` and `reference` — accepting them would let a contributor mark
their own work approved.

**Sessions in the database, not JWTs.** Disabling a user takes effect
immediately rather than whenever their token happens to expire; the disable
path also deletes their sessions.

**Locked template sections are enforced at render.** `resolveValue()` reads a
locked variable's value from the template definition and discards whatever the
client sent for that key. Disabling the input is the UI affordance; this is the
control.

---

## Publishing safety

Publishing to the wrong channel is the one unrecoverable mistake this system
can make, so there are four independent gates:

1. `PUBLISHING_ENABLED` — deployment level
2. `Organization.productionPublishingEnabled` — organisation level
3. `YouTubeChannel.confirmedAt` — an admin typed the channel name
4. The publish dialog — typing the channel name again, at the moment of publish

Two *independent* switches (1 and 2) mean a production `.env` copied to a
laptop cannot by itself publish. Typing rather than ticking (3 and 4) forces
the question "am I publishing to the right channel?" to actually be read.

Disabling is deliberately asymmetric — one click, no confirmation. An emergency
stop should never be gated.

---

## Rendering metadata

`renderSubmission()` is the single place a submission's final YouTube metadata
is derived, and it is called by:

- the live preview in the editor (via the PATCH response)
- `submit`, which freezes the result onto the row
- `publish`, which re-freezes it immediately before uploading

The preview is rendered by the **server**, not the browser. That costs a round
trip and removes any possibility of showing a description that differs from
what gets published — which would undermine the entire review workflow.

Freezing on submit means a later template edit cannot retroactively change an
already-approved description.

---

## Testing

| Suite | What it proves |
|---|---|
| `templates.test.ts` | Template rendering, locked values, tag budgets, hashtags |
| `validation.test.ts` | Every pre-publish rule, and submit-vs-publish thresholds |
| `crypto.test.ts` | Round-trip, tamper detection, key-mismatch handling |
| `logger.test.ts` | Credentials never survive redaction |
| `verify-migrations.ts` | Every constraint actually bites, on real PostgreSQL |

`verify-migrations.ts` is the unusual one: it applies the real migration SQL to
PGlite (PostgreSQL compiled to WebAssembly) and then *tries to violate* each
constraint. Hand-written DDL — partial unique indexes, CHECK constraints — is
not validated by Prisma, so without this a typo would only be discovered when
`migrate deploy` failed against production. It also proves the duplicate-publish
guard works, which is the single most important invariant in the system.

Tests found three real bugs during development: a template placeholder alone on
a line left a blank gap, hashtag matching truncated Indic scripts by omitting
combining marks, and log redaction missed `upload_id` when quoted in prose
outside a URL.

---

## Multi-organisation readiness

Every tenant-scoped table carries `organizationId`, and every query filters by
it. V1 seeds exactly one organisation, but growing into real multi-tenancy does
not require a migration of the core tables.

Deliberately **not** built yet: an organisation switcher, cross-org roles,
per-org billing, or subdomain routing. Those are real features, not a schema
change, and building them speculatively would be over-engineering.

Similarly, `YouTubeChannel` is a table with a `channelId` foreign key on
`Submission` rather than a single hard-coded channel, so multiple channels per
organisation is a UI change rather than a data migration.

---

## Known limitations

Stated plainly rather than papered over.

- **No email.** Invitations and notifications are in-app only. The admin must
  tell people to sign in. The data model supports email without change.
- **Drive root folder is app-created.** A consequence of `drive.file` scope.
  Adopting an existing folder would need full `drive` access.
- **Checksums are skipped above 256 MB.** Web Crypto has no incremental digest
  API, so hashing needs the whole file in memory; doing that to a 4 GB video
  would crash the tab. Drive's own md5 still verifies what arrived — only the
  duplicate-detection hint is lost.
- **Only `VIDEO` is implemented.** `SHORT`, `IMAGE` and `COMMUNITY_POST` exist
  in the enum and the UI is structured for them, but no publishing path is
  written. They are not offered in the interface.
- **No analytics.** Views, likes and comments are not fetched. The
  `YouTubePublication` table is where they would go.
- **Unverified External OAuth apps expire refresh tokens after 7 days**, which
  means a weekly reconnect. This is a Google policy, not a bug. Use Internal
  user type or complete verification.
- **YouTube quota allows about six uploads per day** on a default project.
  Requesting more requires an audit.
- **Live Google integration is unverified in this repository.** The code paths
  are real, not mocked, but exercising them needs credentials this repository
  does not and should not contain.
