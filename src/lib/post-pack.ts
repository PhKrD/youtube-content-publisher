import { renderTemplate } from "./templates";

/**
 * Renders companion-post text.
 *
 * Every key in `values` is an optional variable, so an empty field closes up
 * its line. Placeholders without a value are left visible — notably
 * {{VIDEO_URL}} before the video exists — so nothing is silently dropped.
 */
export function renderPostText(body: string, values: Record<string, string>): string {
  const variables = Object.keys(values).map((key) => ({
    key,
    label: key,
    required: false,
    isLocked: false,
    lockedValue: null,
    defaultValue: null,
    maxLength: null,
  }));
  return renderTemplate(body, variables, values).text;
}
