# Troubleshooting

Start at **`/admin/health`**. It checks the database, configuration, Google
connection, publishing gates and the worker, and usually names the problem
directly.

---

## Sign-in

### "That Google account is not allowed to sign in"

Access is invitation-only. Either:

- An administrator must invite that exact email address at `/admin/users`, or
- For the very first account, set `BOOTSTRAP_ADMIN_EMAIL` in `.env` to that
  address and restart.

The address must match exactly, including the domain. `you@gmail.com` and
`you@googlemail.com` are different accounts.

### `redirect_uri_mismatch`

The redirect URI in the request is not registered on your OAuth client.

Go to the [Credentials page](https://console.cloud.google.com/apis/credentials),
open your OAuth client, and confirm **both** of these are listed under
*Authorised redirect URIs*, matching your `AUTH_URL` exactly:

```
<AUTH_URL>/api/auth/callback/google
<AUTH_URL>/api/integrations/google/callback
```

Common causes:

- Only the first URI was added. Both are needed and they differ.
- `http` vs `https`.
- A trailing slash on `AUTH_URL`.
- Deployed to a new domain without updating Google.

Changes can take a minute to take effect.

### "This app isn't verified"

Expected for an **External** OAuth app that Google has not reviewed.

Click **Advanced** → **Go to … (unsafe)**. It is your own app on your own
Google Cloud project.

To remove the warning: use **Internal** user type (Google Workspace only), or
submit for verification.

### "Access blocked: … has not completed the Google verification process"

Your email is not on the test-user list. Add it at
[OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
→ **Test users** → **+ ADD USERS**.

### Signed in, but "your organisation is not set up"

Your user exists without an organisation — usually an invitation that was
created and then deleted. Fix it by setting `BOOTSTRAP_ADMIN_EMAIL` to your
address and signing in again, or by re-inviting yourself from another admin
account.

---

## Connecting Google

### "Google did not return a refresh token"

Google only issues a refresh token on a full consent, and omits it when
re-consenting silently. Without one the connection dies in an hour.

Fix:

1. Go to <https://myaccount.google.com/permissions>
2. Find your app and click **Remove access**
3. Connect again in the app

The app forces `prompt=consent`, so this should be rare — but a previously
authorised account can still hit it.

### "Connected, but some permissions were not granted"

A permission was unticked on the consent screen. All three are required:

- Google Drive — files created by this app
- YouTube — upload videos and set thumbnails
- YouTube — read and manage playlists

Click **Reconnect / change account** and accept everything.

### "The connected Google account has no YouTube channel"

The account can sign in but owns no channel. Go to
<https://www.youtube.com/create_channel> on that account, create it, then
reconnect.

If the channel is a **Brand Account**, make sure you pick it on Google's
account-chooser screen during the connect flow.

### The wrong channel was connected

If a Google account manages several channels, Google may pick one you did not
expect. This is exactly why confirmation requires typing the channel name.

Click **Reconnect / change account** and choose the correct channel on the
account-chooser screen.

### "The connection to Google has expired or was revoked"

`invalid_grant`. The refresh token is dead. Causes:

- Someone revoked access at myaccount.google.com/permissions
- The Google account password changed
- The token went unused for six months
- **An unverified External app** — these refresh tokens expire after 7 days
- `TOKEN_ENCRYPTION_KEY` changed, so the stored token cannot be decrypted

No content is lost. An admin reconnects at `/admin/integrations` and any failed
publish can be retried.

If this recurs weekly, it is the 7-day unverified-app expiry. Switch to
Internal user type, or submit for verification.

---

## Uploads

### Upload fails immediately

Check the message — validation runs before any bytes move, so it will be
specific: unsupported format, too large, or wrong image type.

Limits are configurable at `/admin/general`.

### Upload stalls or fails midway

The uploader retries transient failures automatically with backoff, and asks
Google for the committed byte offset before resuming, so no data is corrupted.

If it gives up, click **Try again** — it resumes rather than restarting.

### "This upload session expired"

Google discards resumable sessions after about a week. Choose the file again.
Nothing else about the submission is lost.

### CSP errors in the browser console about googleapis.com

The Content-Security-Policy must allow `connect-src` to Google. This is
configured in `next.config.ts`. If you have a proxy or CDN overriding response
headers, it may be stripping or replacing the CSP.

### Large uploads fail on a deployed site but work locally

Bytes go straight from the browser to Google, so this is almost never a body
limit. Check for a corporate proxy or firewall interfering with the upload, and
look at the browser's network tab for the failing `PUT`.

---

## Publishing

### Publish button is disabled

The checklist on the page lists every blocker. Click an item to jump to the
field. Common causes:

- Production publishing is off (`/admin/publishing`)
- The channel has not been confirmed (`/admin/integrations`)
- You do not have publishing rights — an admin grants these per user
- The organisation requires approval and this has not been approved

### "Publishing to YouTube is currently turned off for safety"

Both switches must be on:

1. `PUBLISHING_ENABLED="true"` in the environment, then restart
2. Production publishing enabled at `/admin/publishing`

`/admin/publishing` shows which of the two is blocking.

### Nothing happens after clicking Publish

The job is queued but nothing is running it. Start a worker:

```bash
npm run worker
```

or schedule `/api/jobs/tick`. `/admin/health` reports this as
*"Publishing worker"* with an expired lease.

### "Video uploaded but playlist failed"

Working as designed. Open the submission and click **Retry the remaining
steps** — it retries only the playlist. It cannot upload a second video,
because the recorded video ID makes the upload step skip itself.

### Thumbnail rejected with a 403

Custom thumbnails require a **verified** YouTube channel. Verify at
<https://www.youtube.com/verify>, then retry that step. The video is already
uploaded and is unaffected.

### "YouTube's daily API limit has been reached"

A default Google Cloud project gets 10,000 quota units per day, and a video
upload costs about 1,600 — roughly six uploads per day.

Options:

- Wait. Quota resets at midnight Pacific Time, and queued jobs retry
  automatically.
- Request more quota at
  [Quotas](https://console.cloud.google.com/iam-admin/quotas) → *YouTube Data
  API v3*. Approval takes time and requires an audit.

### The scheduled video published immediately

YouTube only honours `publishAt` on a video whose privacy is `private`.
Choosing *Schedule* forces privacy to Private, and the database enforces it
with a CHECK constraint, so this should be impossible. If you see it, check
whether the video's privacy was changed on YouTube after upload.

---

## Database

### `prepared statement "s0" already exists`

Migrations are running against the pooled connection. Set `DIRECT_URL` to the
direct (port 5432) connection string. See
[ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md).

### `Can't reach database server`

- Check `DATABASE_URL` host, port and password.
- On Supabase, confirm the project is not paused — free projects pause after
  inactivity.
- Check the password has no unescaped special characters. URL-encode them:
  `@` → `%40`, `#` → `%23`.

### `Too many connections`

Add `?pgbouncer=true&connection_limit=1` to `DATABASE_URL` and use the pooled
endpoint. Each serverless instance otherwise opens its own pool.

### `extension "pg_trgm" is not available`

The search indexes need `pg_trgm`. It ships with Supabase, Neon and standard
PostgreSQL. On a minimal install:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

as a superuser, then re-run `npm run db:deploy`.

---

## Build and development

### `npm run build` fails on a type error

Intentional — `ignoreBuildErrors` is false. Run `npm run typecheck` for the
full list.

### Stale type errors that will not go away

```bash
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit
```

TypeScript's incremental cache can survive a `tsconfig.json` change.

### Prisma client out of date after changing the schema

```bash
npm run db:generate
```

`npm run build` does this automatically.

### Hundreds of lint errors in `src/generated`

That directory is generated Prisma code and is excluded in
`eslint.config.mjs`. If you see them, the ignore entry has been removed.

---

## Still stuck

1. `/admin/health` — names most misconfigurations directly.
2. Server logs — structured JSON with a `code` and a technical `detail`.
   Credentials are redacted, so logs are safe to share.
3. `/admin/audit` — who did what, when, and what failed.
4. The submission's own **History** panel — the full timeline for that item.
