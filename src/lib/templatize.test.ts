import { describe, expect, it } from "vitest";
import { templatizeText } from "./templates";

describe("templatizeText", () => {
  it("replaces this video's values with placeholders, keeping new wording", () => {
    const r = templatizeText(
      "Seva - 26 September 2026.\nSponsored by Prajyot Taur in loving memory of his friend Ratan Tata.",
      [
        { key: "DATE", value: "26 September 2026" },
        { key: "SPONSOR_NAME", value: "Prajyot Taur" },
        { key: "IN_MEMORY_OF", value: "friend Ratan Tata" },
      ],
    );
    expect(r.body).toBe(
      "Seva - {{DATE}}.\nSponsored by {{SPONSOR_NAME}} in loving memory of his {{IN_MEMORY_OF}}.",
    );
    expect(r.notFound).toEqual([]);
  });

  it("works on Hindi text, including the Devanagari date", () => {
    const r = templatizeText("सेवा - २६/०९/२०२६.\nकौशिक गुप्ता जी द्वारा", [
      { key: "DATE_HI", value: "२६/०९/२०२६" },
      { key: "SPONSOR_NAME", value: "कौशिक गुप्ता" },
    ]);
    expect(r.body).toBe("सेवा - {{DATE_HI}}.\n{{SPONSOR_NAME}} जी द्वारा");
  });

  it("does not replace a short value inside a longer word or number", () => {
    const r = templatizeText("Day 01. Call 9301012345. Code IND01.", [
      { key: "DAY_NUMBER", value: "01" },
    ]);
    expect(r.body).toBe("Day {{DAY_NUMBER}}. Call 9301012345. Code IND01.");
  });

  it("replaces longer values first so names containing names stay whole", () => {
    const r = templatizeText("Ratan Kumar Gupta, remembered by Ratan", [
      { key: "SPONSOR_NAME", value: "Ratan" },
      { key: "IN_MEMORY_OF", value: "Ratan Kumar Gupta" },
    ]);
    expect(r.body).toBe("{{IN_MEMORY_OF}}, remembered by {{SPONSOR_NAME}}");
  });

  it("reports values removed from the text and values that repeat", () => {
    const r = templatizeText("Prajyot and Prajyot", [
      { key: "SPONSOR_NAME", value: "Prajyot" },
      { key: "DATE", value: "26 September 2026" },
      { key: "EMPTY", value: "" },
    ]);
    expect(r.notFound).toEqual(["DATE"]);
    expect(r.repeated).toEqual(["SPONSOR_NAME"]);
  });

  it("leaves existing placeholders alone", () => {
    const r = templatizeText("{{VIDEO_URL}} by VIDEO", [{ key: "SPONSOR_NAME", value: "VIDEO" }]);
    expect(r.body).toBe("{{VIDEO_URL}} by {{SPONSOR_NAME}}");
  });
});
