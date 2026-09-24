import { describe, expect, it } from "vitest";
import { renderPostText } from "./post-pack";
import { DEFAULT_CONTENT_FIELDS, DEFAULT_POST_TEMPLATE, resolveContentFields } from "./content-fields";

describe("renderPostText", () => {
  const values = { TOPIC: "Food For Life", PROGRAM_NAME: "Annadan", SPEAKER_NAME: "" };

  it("fills placeholders and keeps VIDEO_URL visible until the video exists", () => {
    expect(renderPostText(DEFAULT_POST_TEMPLATE, values)).toBe(
      "Food For Life\nAnnadan\n\nWatch the full video: {{VIDEO_URL}}",
    );
  });

  it("inserts the link once published", () => {
    const out = renderPostText(DEFAULT_POST_TEMPLATE, {
      ...values,
      VIDEO_URL: "https://youtu.be/abc",
    });
    expect(out).toContain("Watch the full video: https://youtu.be/abc");
  });

  it("closes up lines whose only content is an empty field", () => {
    expect(renderPostText("{{SPEAKER_NAME}}\n{{TOPIC}} #FoodForLife", values)).toBe(
      "Food For Life #FoodForLife",
    );
  });
});

describe("resolveContentFields", () => {
  it("falls back to defaults for missing or invalid entries", () => {
    const out = resolveContentFields({
      topic: { label: "Occasion", placeholder: "47th birthday", hidden: false },
      speaker: { label: "", placeholder: "", hidden: true },
    });
    expect(out.topic.label).toBe("Occasion");
    expect(out.speaker).toEqual(DEFAULT_CONTENT_FIELDS.speaker);
    expect(out.program).toEqual(DEFAULT_CONTENT_FIELDS.program);
    expect(resolveContentFields(null)).toEqual(DEFAULT_CONTENT_FIELDS);
  });
});
