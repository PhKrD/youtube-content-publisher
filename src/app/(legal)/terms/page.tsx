import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of service" };

/**
 * Google's OAuth brand verification requires a reachable terms URL, and
 * YouTube's Developer Policies require API clients to bind their users to the
 * YouTube Terms of Service.
 */
export default function TermsOfServicePage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Terms of service</h1>
      <p className="mt-1.5 text-xs text-ink-faint">Last updated 16 September 2026</p>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-ink-soft">
        <p>
          By using this application you agree to these terms. If you do not agree,
          do not use it.
        </p>

        <section>
          <h2 className="text-sm font-semibold text-ink">What this app does</h2>
          <p className="mt-2">
            It lets invited contributors submit video content, lets administrators
            review it, and publishes approved videos to a YouTube channel that an
            administrator has connected. Google Drive is used to store the media.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Who may use it</h2>
          <p className="mt-2">
            Access is by invitation only, granted by an administrator, and may be
            withdrawn at any time. Your sign-in is personal to you — do not share it.
            Permission to publish is granted separately from permission to sign in.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">YouTube and Google terms</h2>
          <p className="mt-2">
            This app uses the YouTube API Services. By using it you are also agreeing
            to be bound by the{" "}
            <a
              className="underline"
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noreferrer"
            >
              YouTube Terms of Service
            </a>
            , and your data is handled by Google under the{" "}
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
          <h2 className="text-sm font-semibold text-ink">Your content</h2>
          <p className="mt-2">
            You keep ownership of what you submit. You confirm that you have the right
            to publish it — including any music, footage, images and appearances of
            other people in it — and you grant the channel&rsquo;s administrators
            permission to publish it to that channel. Anything published to YouTube is
            additionally subject to YouTube&rsquo;s own policies and may be removed by
            YouTube.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Acceptable use</h2>
          <p className="mt-2">Do not use this app to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>upload content you do not have the rights to, or that is unlawful;</li>
            <li>
              publish content that breaches YouTube&rsquo;s Community Guidelines or
              Terms of Service;
            </li>
            <li>
              attempt to gain access to accounts, data or channels other than those you
              have been granted;
            </li>
            <li>
              interfere with the service, or use it to send automated bulk uploads
              beyond its intended workflow.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Availability</h2>
          <p className="mt-2">
            This app is provided as-is, with no guarantee of availability, and without
            warranties of any kind. It depends on Google, YouTube, Drive and other
            third-party services, and can stop working if any of those change or become
            unavailable. To the extent the law allows, the operator is not liable for
            any loss arising from its use, including failed or delayed publishing or
            loss of content. Keep your own copies of anything important.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Ending access</h2>
          <p className="mt-2">
            You may stop using the app at any time and ask for your account to be
            removed. Administrators may suspend or remove access if these terms are
            broken, or if the app is retired.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Contact</h2>
          <p className="mt-2">
            Questions about these terms:{" "}
            <a className="underline" href="mailto:palanharkrsnadas@gmail.com">
              palanharkrsnadas@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </>
  );
}
