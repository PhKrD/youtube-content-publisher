import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

/** Google's OAuth brand verification requires a reachable, specific privacy policy. */
export default function PrivacyPolicyPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Privacy policy</h1>
      <p className="mt-1.5 text-xs text-ink-faint">Last updated 16 September 2026</p>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-ink-soft">
        <p>
          This application prepares video content for review and publishes approved
          videos to a YouTube channel, using Google Drive to hold the media files.
          Access is by invitation only. This policy explains what it does with your
          information.
        </p>

        <section>
          <h2 className="text-sm font-semibold text-ink">Who runs this app</h2>
          <p className="mt-2">
            This app is operated privately by its administrator, who can be reached at{" "}
            <a className="underline" href="mailto:palanharkrsnadas@gmail.com">
              palanharkrsnadas@gmail.com
            </a>
            . It is not a commercial service, it carries no advertising, and there is
            no charge to use it.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">What we collect</h2>
          <p className="mt-2">When you sign in, Google tells us:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>your name, email address and profile picture, to identify your account.</li>
          </ul>
          <p className="mt-3">
            When an administrator connects the account that publishes to YouTube, that
            account additionally grants:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              permission to upload videos to, and manage playlists on, its YouTube
              channel;
            </li>
            <li>
              permission to create and access <em>only</em> the Google Drive files this
              app itself creates. It cannot see the rest of that Drive.
            </li>
          </ul>
          <p className="mt-3">
            We also store what you put into the app: video files you upload, titles,
            descriptions, tags, review comments, and a log of actions taken so
            administrators can see who published what.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">
            How we use Google user data
          </h2>
          <p className="mt-2">
            Google data is used only to provide the features you see: signing you in,
            storing media in Drive, and publishing to YouTube on the connected
            channel&rsquo;s behalf. We do not use it for advertising, we do not sell or
            transfer it, we do not use it to train machine-learning models, and no
            human reads it except the administrators of this installation acting on the
            app&rsquo;s own workflow.
          </p>
          <p className="mt-3">
            This app&rsquo;s use and transfer of information received from Google APIs
            adheres to the{" "}
            <a
              className="underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Where it is kept</h2>
          <p className="mt-2">
            Application data is held in a hosted PostgreSQL database (Supabase) and the
            app runs on Vercel. Media files live in the connected Google Drive account.
            Google access tokens are encrypted before they are written to the database.
            Nobody, including administrators, can read them from the database directly.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">
            How long it is kept, and how to remove it
          </h2>
          <p className="mt-2">
            Content and audit records are kept until an administrator deletes them, so
            that the publishing history stays accountable. You can revoke this
            app&rsquo;s access to your Google account at any time from{" "}
            <a
              className="underline"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
            >
              your Google account permissions
            </a>
            , which immediately stops it acting on your behalf. To have your account and
            personal data deleted from this app, email the address above and it will be
            removed.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Third parties</h2>
          <p className="mt-2">
            Your data is shared only with the services needed to run the app — Google,
            Supabase and Vercel — and where the law requires it. Google&rsquo;s own
            handling of your data is covered by the{" "}
            <a
              className="underline"
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
            >
              Google Privacy Policy
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Changes</h2>
          <p className="mt-2">
            If this policy changes materially, the date at the top will change and
            signed-in users will be told.
          </p>
        </section>
      </div>
    </>
  );
}
