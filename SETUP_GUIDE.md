# Setup guide

This walks you through everything, from nothing to a working installation.

**You will never be asked for your Google password.** This application uses
Google's official sign-in. You approve access on Google's own website, and the
app receives a revocable token — never your password.

Two values you create here are **secrets**. Keep them out of chat messages,
screenshots, tickets and Git. They are marked clearly.

Allow about 30 minutes.

---

## Before you start

You need:

- A **Google account that owns the YouTube channel** you want to publish to.
  If the channel is a Brand Account, use the account that manages it.
- That channel must already exist. This app cannot create one.
- A **PostgreSQL database**. The free tier of [Supabase](https://supabase.com)
  is enough to start.
- **Node.js 20 or newer** on the machine you will run this on.
  Check with `node --version`.

---

# Part 1 — Google Cloud

This is the only part that happens outside the application. Everything here is
free.

## Step 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/projectcreate>
2. Sign in with the Google account that owns your YouTube channel.
3. **Project name**: `YouTube Content Publisher`
4. Leave *Location* as **No organisation** unless your workplace requires otherwise.
5. Click **CREATE**.
6. Wait for the notification, then make sure the new project is selected in the
   dropdown at the top of the page. Everything below must happen inside this
   project.

## Step 2. Enable the YouTube Data API v3

1. Go to <https://console.cloud.google.com/apis/library/youtube.googleapis.com>
2. Confirm your project name is in the dropdown at the top.
3. Click **ENABLE**.

## Step 3. Enable the Google Drive API

1. Go to <https://console.cloud.google.com/apis/library/drive.googleapis.com>
2. Click **ENABLE**.

> Both must be enabled. Missing the Drive API is the most common cause of
> "connected, but uploads fail".

## Step 4. Configure the OAuth consent screen

This is the permission screen your users will see.

1. Go to <https://console.cloud.google.com/apis/credentials/consent>
2. **User type**:
   - Choose **Internal** if you have Google Workspace and everyone using this
     app has an email address on your domain. This is simpler — skip the
     verification warnings and the test-user list.
   - Otherwise choose **External**.
3. Click **CREATE**.
4. Fill in:
   - **App name**: `YouTube Content Publisher` (users will see this)
   - **User support email**: your email
   - **Developer contact information**: your email
5. Click **SAVE AND CONTINUE**.
6. On the **Scopes** screen, click **SAVE AND CONTINUE** without adding
   anything. The application requests its scopes at runtime; adding them here
   is not required and only affects the verification review.
7. On **Test users** (External only), click **+ ADD USERS** and add the email
   address of every person who will sign in, **including your own**. Then
   **SAVE AND CONTINUE**.
8. Click **BACK TO DASHBOARD**.

### About the "unverified app" warning (External only)

Until Google verifies your app, users see a warning screen. To proceed:
click **Advanced** → **Go to YouTube Content Publisher (unsafe)**.

This is expected and safe — it is *your* app, on *your* Google Cloud project.
The warning simply means Google has not reviewed it.

Two things to know:

- An unverified External app is limited to **100 test users**.
- Refresh tokens for unverified apps can expire after **7 days**, which means
  an admin has to reconnect weekly. If that becomes annoying, either switch to
  **Internal** (Workspace only) or submit for verification.

## Step 5. Create the OAuth client

1. Go to <https://console.cloud.google.com/apis/credentials>
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**.
3. **Application type**: **Web application**.
4. **Name**: `YouTube Content Publisher Web`
5. Under **Authorised JavaScript origins**, click **+ ADD URI**:
   ```
   http://localhost:3000
   ```
6. Under **Authorised redirect URIs**, add **both** of these, exactly:
   ```
   http://localhost:3000/api/auth/callback/google
   http://localhost:3000/api/integrations/google/callback
   ```

   > Both are required and they are different. The first signs users in. The
   > second connects the publishing account. A missing second URI produces
   > `redirect_uri_mismatch` when an admin clicks "Connect Google".

7. Click **CREATE**.
8. A dialog shows **Your Client ID** and **Your Client Secret**.
   Copy both now — you need them in Part 2.

   🔒 **The client secret is a secret.** Do not paste it into a chat, a
   screenshot, or a file that gets committed. If you lose it you can create a
   new one; if you leak it, delete the client and make another.

When you deploy to a real domain later, come back and add the production URLs
here too. See [DEPLOYMENT.md](./DEPLOYMENT.md).

---

# Part 2 — The application

## Step 6. Install

```bash
npm install
```

## Step 7. Create your configuration file

```bash
cp .env.example .env
```

`.env` is gitignored and will never be committed.

## Step 8. Generate two secret keys

Run this twice and keep the two different results:

```bash
openssl rand -base64 32
```

On Windows without `openssl`, use:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open `.env` and set:

```ini
AUTH_SECRET="<first value>"
TOKEN_ENCRYPTION_KEY="<second value>"
```

> ⚠️ **`TOKEN_ENCRYPTION_KEY` encrypts the stored Google tokens.** If you lose
> or change it, those tokens become permanently unreadable and an administrator
> must reconnect Google. Back it up somewhere safe, and use a *different* value
> in each environment.

## Step 9. Add your Google credentials

Still in `.env`, paste the two values from Step 5:

```ini
GOOGLE_CLIENT_ID="123456789-abcdefg.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxxxxxxxxxxxxxxx"
```

## Step 10. Set up the database

### Using Supabase (recommended to start)

1. Create a project at <https://supabase.com/dashboard>. Save the database
   password it gives you — 🔒 it is a secret.
2. In your project, go to **Project Settings → Database → Connection string**.
3. Copy the **Transaction pooler** string into `DATABASE_URL`, and the
   **Session/direct** string into `DIRECT_URL`:

```ini
DATABASE_URL="postgresql://postgres.abcxyz:PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.abcxyz:PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
```

Replace `PASSWORD` with your database password.

> Why two URLs? The app uses the pooled connection (port 6543) at runtime.
> Database migrations need features the pooler cannot proxy, so they use the
> direct connection (port 5432). Using only the pooled URL causes confusing
> "prepared statement already exists" errors during migration.

### Using a local PostgreSQL

Set both variables to the same URL:

```ini
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ycp"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/ycp"
```

## Step 11. Create the tables

```bash
npm run db:deploy
```

You should see the two migrations applied. Then load the starter templates:

```bash
npm run db:seed
```

This creates a title template, a description template with three locked
sections, and three tag groups — all editable later in the app.

## Step 12. Make yourself the administrator

In `.env`, set this to the Google address you will sign in with:

```ini
BOOTSTRAP_ADMIN_EMAIL="you@example.com"
```

The first person to sign in with this exact address becomes the administrator.
Clear it afterwards — from then on, access is by invitation.

## Step 13. Start the app

```bash
npm run dev
```

Open <http://localhost:3000> and click **Continue with Google**.

You should land on the dashboard with a yellow **Development mode** banner and
a prompt to finish setup.

---

# Part 3 — Connect Google (inside the app)

Open **/setup**. Each step checks itself, so you can stop and resume.

## Step 14. Connect the publishing account

Click **Connect Google**. You will be taken to Google and asked to allow:

| Permission | Why |
|---|---|
| See, edit, create and delete **only the files you use with this app** in Drive | Stores the uploaded videos and thumbnails |
| Manage your **YouTube videos** | Uploads the video and sets its thumbnail |
| Manage your **YouTube account** | Reads playlists and adds the video to one |

**Tick everything.** If you decline any of them, publishing will fail later
with a permissions error, and the app will tell you to reconnect.

Note the Drive permission is deliberately narrow: this app can only touch files
**it created**. It cannot read your existing documents or photos. The trade-off
is that it makes its own `YouTube Content` folder rather than using one you
already have.

## Step 15. Confirm the channel

The app reads the channel from the connected account and shows its name, ID,
image and video count.

**Check this carefully.** If the account manages several channels, Google may
have connected one you did not expect.

Click the link to open the channel on YouTube and verify. Then **type the
channel name exactly** to confirm.

Typing rather than ticking is intentional — publishing to the wrong channel
cannot be undone from this app.

## Step 16. Review templates and playlists

- **Templates** (`/admin/templates`) — adjust the title pattern and the
  description body. Replace the placeholder contact details and social links in
  the locked fields with your real ones.
- **Playlists** (`/admin/playlists`) — click **Refresh from YouTube**, then
  choose which playlists contributors may use and which is the default.

## Step 17. Invite your team

At `/admin/users`, invite people by email address and give each a role:

| Role | Can do |
|---|---|
| **Contributor** | Create, upload, edit own drafts, submit for review. Publishes **only** if you grant it explicitly. |
| **Reviewer** | All of the above, plus approve / request changes / reject. Cannot approve their own work. |
| **Administrator** | Everything, including Google, publishing and users. |

> The app does not send emails yet. Tell people to visit the app and sign in
> with Google using the exact address you invited.

Only invited addresses can sign in. Everyone else is refused.

## Step 18. Do a test run — with publishing OFF

Leave production publishing **off** and go through the whole flow:

1. **Create content**
2. Upload a short video and a thumbnail
3. Fill in Programme / Topic / Speaker and the description fields
4. Watch the preview build the real title and description
5. Submit for review, then approve it as an admin

Nothing reaches YouTube. This is the point of the switch — you can rehearse the
entire workflow safely.

## Step 19. Go live

Two independent switches must both be on:

1. In `.env`, set `PUBLISHING_ENABLED="true"` and restart the app.
2. At `/admin/publishing`, satisfy every requirement in the checklist, then
   type `ENABLE`.

Two switches means a copy of your production configuration on someone's laptop
cannot, on its own, publish to your real channel.

## Step 20. Run the worker

Publishing happens in a background worker. In a second terminal:

```bash
npm run worker
```

Leave it running. Without it, publish jobs queue up and never run — the health
page at `/admin/health` will tell you so.

For production, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## You are done

Publish one real video — ideally set to **Private** — and confirm it appears on
the channel, in the right playlist, with your thumbnail.

If something goes wrong, your content is never lost: the video stays in Google
Drive and the submission page explains what failed and lets you retry only the
step that did not finish.

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for specific errors.
