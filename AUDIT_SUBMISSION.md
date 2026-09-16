# YouTube API Services — Audit submission

Draft answers for the [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form).
Only you can submit it: it asks for your identity and a demo login.

**Why you are doing this:** videos inserted through the Data API by an
unaudited project are forced to private with no appeal. Passing the audit is
the only way to publish public videos through this app. A quota increase (from
the default ~6 uploads/day) comes through the same form.

Before submitting, work through **Blockers** at the bottom. Submitting with
those outstanding wastes weeks.

---

## Request type

> All requests for additional quota must go through a compliance audit.

Choose **API Compliance Audit and quota extension**.

## Applicant and organisation

| Field | Answer |
|---|---|
| Contact name | *your full legal name* |
| Contact email | `palanharkrsnadas@gmail.com` |
| Organisation | *your legal entity, or your own name if there isn't one* |
| Website | `https://youtube-content-publisher.vercel.app` |
| Google Cloud project number | find it on the [dashboard](https://console.cloud.google.com/home/dashboard) — the **Project number**, not the ID |

Use the same email as the Google Cloud project owner. A mismatch stalls review.

## API Client

| Field | Answer |
|---|---|
| Name | *the new app name — see Blockers* |
| Type | Web application |
| URL | `https://youtube-content-publisher.vercel.app` |
| Publicly available? | No — access is by invitation only |
| Platforms | Web (desktop and mobile browser) |
| Monetised? | No. No advertising, no charge, no resale of API data |

### What it does

> A private, invitation-only workflow tool for a single YouTube channel that we
> own and operate. Contributors submit a video file with a proposed title,
> description and tags. A reviewer with administrator rights then approves or
> rejects it. Only on approval does the application upload the video to our own
> channel and optionally add it to one of our playlists.
>
> Its purpose is review and accountability: it ensures no video reaches the
> channel without a named human approving it, and it records who submitted,
> who approved and what was published. It is not a publishing service for third
> parties, it does not aggregate or display other people's YouTube content, and
> it has no public-facing pages beyond sign-in and our legal policies.
>
> Media files are held in a Google Drive folder owned by the same account, using
> the `drive.file` scope, so the application can only access files it created.

### How it uses YouTube API Services

Every call is made with OAuth credentials of the channel owner, who granted
consent explicitly. There is no use of API keys for user data and no access to
any channel other than our own.

| Method | Why |
|---|---|
| `channels.list` (`mine=true`) | Confirm which channel the connected account owns, and show it to the administrator before publishing is enabled |
| `videos.insert` | Upload an approved video (resumable upload) |
| `thumbnails/set` | Set a custom thumbnail supplied with the submission |
| `videos.list` | Poll the processing status of a video we just uploaded |
| `playlists.list` | List our own playlists so an administrator can choose a destination |
| `playlistItems.insert` | Add a published video to one of our own playlists |
| `playlistItems.list` | Check whether the video is already in the playlist, to avoid duplicates |
| `videoCategories.list` | Populate the category selector with valid values |

### Scopes requested, and why

| Scope | Why |
|---|---|
| `youtube.upload` | Upload videos to our own channel |
| `youtube` | Read our own channel and manage our own playlists |
| `openid`, `userinfo.email`, `userinfo.profile` | Identify which Google account was connected, so the administrator can confirm it is the right one |
| `drive.file` | Store and read back only the media files this app itself creates |

YouTube and Drive consent are requested as **two separate authorisations**,
because Google does not permit those scope families in one request.

## Users and volume

| Field | Answer |
|---|---|
| Current users | 1 |
| Expected users (12 months) | Fewer than 20, all invited members of our own organisation |
| Channels accessed | 1 — our own |
| Current daily uploads | 0–2 |
| Requested quota | *see note* |

On quota: the default 10,000 units allows about six `videos.insert` calls a
day. Ask for what you actually need and justify it arithmetically, e.g.
*"50,000 units/day: up to 20 uploads a day at 1,600 units each, plus roughly
2,000 units of playlist and status reads."* Inflated requests get refused.

## Demo account for review

> Provide credentials with FULL access to all features. The account should have
> sample data.

Reviewers will sign in and click around, so this must actually work:

1. Create a throwaway Google account, or use a second one you control.
2. Invite it from **/admin/users** and give it the **ADMIN** role, so every
   feature is reachable.
3. Sign in as it once and accept the privacy policy.
4. Leave realistic sample data in place — at least one submission in review and
   one published video.
5. Put the email and password in the form, and note that sign-in is via Google.

Do not give them your own admin account, and remove the demo account's access
once the audit closes.

## Screenshots to attach

They ask for screenshots of how the client uses the API. Capture:

1. Sign-in page, showing the privacy policy and terms links.
2. The consent gate at `/accept-terms`.
3. The Google consent screen for the YouTube grant, showing the scopes.
4. **/admin/integrations**, showing the two connected grants.
5. A submission awaiting review.
6. The approve-and-publish dialogue, showing a human makes the decision.
7. A published video with its YouTube link.
8. **/admin/audit**, showing the audit trail.
9. The app footer, showing the YouTube Terms of Service link.

Number 6 matters most. The reviewer is looking for a human authorising each
publish rather than automated bulk upload.

## Compliance points worth stating explicitly

- Users must agree to the privacy policy before any feature is reachable
  (III.A.2). Consent is recorded per user against the policy version shown.
- The privacy policy states the app uses YouTube API Services, links the Google
  Privacy Policy, describes what is collected and shared, discloses the session
  cookie, states there is no advertising or third-party content, explains
  revocation via `security.google.com/settings/security/permissions`, and gives
  a contact for privacy complaints.
- The terms link YouTube's Terms of Service and state that users are bound by
  them (III.A.1).
- OAuth tokens are encrypted (AES-256-GCM) before storage and are never sent to
  the browser or written to logs.
- The app never asks for or stores Google or YouTube passwords.
- No API data is sold, transferred, or used for advertising or model training.
- Publishing is behind an explicit organisation-level switch plus per-user
  permission, so it cannot happen accidentally.
- No YouTube content from other channels is displayed, aggregated or searched.

---

## Blockers — fix before submitting

### 1. The app name breaks the Branding Guidelines

> You must never use "YouTube", "YT", "You-Tube", or any derivative in your
> app's name.
> — [YouTube API Services Branding Guidelines](https://developers.google.com/youtube/terms/branding-guidelines)

"YouTube Content Publisher" cannot be the name. Rename it, and use the new name
consistently in the OAuth consent screen, this form and the app UI. You may
still say it "works with YouTube" in prose.

### 2. The consent screen must be complete and consistent

The name, support email, home page, privacy policy and terms on the
[Branding page](https://console.cloud.google.com/auth/branding) must match what
you put in this form.

### 3. Consider a custom domain

Brand verification on `*.vercel.app` is a known failure path — Google rejects
the home page as "not registered to you" even after Search Console
verification, because `vercel.app` is a public suffix you cannot own. A cheap
domain pointed at Vercel avoids it.

---

## After submitting

- Expect a reply in days to weeks. They often come back with questions; answer
  quickly, as slow replies restart the queue.
- Watch `palanharkrsnadas@gmail.com`, including spam.
- Until approval lands, every API upload stays private. For anything that must
  be public, download from YouTube Studio and upload it by hand.
- Approval is limited to the use case you describe. If the app's purpose changes
  materially, you must re-submit.
