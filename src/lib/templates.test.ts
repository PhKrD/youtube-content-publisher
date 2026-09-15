import { describe, expect, it } from "vitest";
import {
  extractHashtags,
  extractPlaceholders,
  findMissingHashtags,
  lintTemplate,
  renderDescription,
  renderTemplate,
  renderTitle,
  resolveTags,
  resolveValue,
  tidyWhitespace,
  YOUTUBE_LIMITS,
} from "./templates";

/** Minimal variable definition factory. */
function v(
  key: string,
  over: Partial<{
    label: string;
    required: boolean;
    isLocked: boolean;
    lockedValue: string | null;
    defaultValue: string | null;
    maxLength: number | null;
  }> = {},
) {
  return {
    key,
    label: over.label ?? key,
    required: over.required ?? true,
    isLocked: over.isLocked ?? false,
    lockedValue: over.lockedValue ?? null,
    defaultValue: over.defaultValue ?? null,
    maxLength: over.maxLength ?? null,
  };
}

describe("extractPlaceholders", () => {
  it("finds placeholders in order, de-duplicated", () => {
    expect(extractPlaceholders("{{A}} {{B}} {{A}}")).toEqual(["A", "B"]);
  });

  it("tolerates internal whitespace", () => {
    expect(extractPlaceholders("{{  SPEAKER_NAME  }}")).toEqual(["SPEAKER_NAME"]);
  });

  it("ignores lowercase and malformed placeholders", () => {
    expect(extractPlaceholders("{{lower}} {{ BAD-KEY }} {{OK}}")).toEqual(["OK"]);
  });
});

describe("resolveValue precedence", () => {
  it("prefers a locked value over anything submitted", () => {
    const r = resolveValue(v("CONTACT", { isLocked: true, lockedValue: "official@org" }), {
      CONTACT: "attacker@evil",
    });
    expect(r).toEqual({ value: "official@org", wasLocked: true });
  });

  it("uses the submitted value when not locked", () => {
    expect(resolveValue(v("TOPIC"), { TOPIC: "Who Am I?" }).value).toBe("Who Am I?");
  });

  it("falls back to the default when the submitted value is blank", () => {
    expect(resolveValue(v("LANG", { defaultValue: "English" }), { LANG: "   " }).value).toBe(
      "English",
    );
  });
});

describe("renderTemplate", () => {
  it("substitutes values", () => {
    const out = renderTemplate("Hello {{NAME}}!", [v("NAME")], { NAME: "World" });
    expect(out.text).toBe("Hello World!");
    expect(out.missing).toHaveLength(0);
  });

  it("reports required variables that are empty", () => {
    const out = renderTemplate("A {{X}} B", [v("X", { label: "Ex" })], {});
    expect(out.missing).toEqual([{ key: "X", label: "Ex", message: "Ex is required." }]);
  });

  it("silently removes optional empty variables", () => {
    const out = renderTemplate("Start\n{{OPT}}\nEnd", [v("OPT", { required: false })], {});
    expect(out.missing).toHaveLength(0);
    expect(out.text).toBe("Start\nEnd");
  });

  it("leaves unknown placeholders visible so misconfiguration is obvious", () => {
    const out = renderTemplate("Hi {{GHOST}}", [], {});
    expect(out.text).toBe("Hi {{GHOST}}");
    expect(out.unknownPlaceholders).toEqual(["GHOST"]);
  });

  it("reports declared-but-unused variables", () => {
    const out = renderTemplate("only {{A}}", [v("A"), v("B")], { A: "1", B: "2" });
    expect(out.unusedVariables).toEqual(["B"]);
  });

  it("ignores client input for a locked variable (Section 17)", () => {
    const out = renderTemplate(
      "Contact: {{CONTACT}}",
      [v("CONTACT", { isLocked: true, lockedValue: "temple@example.org" })],
      { CONTACT: "https://malicious.example" },
    );
    expect(out.text).toBe("Contact: temple@example.org");
    expect(out.text).not.toContain("malicious");
  });
});

describe("tidyWhitespace", () => {
  it("collapses the holes left by removed placeholders", () => {
    expect(tidyWhitespace("A\n\n\n\n\nB")).toBe("A\n\nB");
  });

  it("preserves a single intentional paragraph break", () => {
    expect(tidyWhitespace("A\n\nB")).toBe("A\n\nB");
  });

  it("strips trailing spaces and leading/trailing newlines", () => {
    expect(tidyWhitespace("\n\nA   \nB\n\n")).toBe("A\nB");
  });
});

describe("renderTitle", () => {
  const vars = [v("PROGRAM_NAME"), v("TOPIC"), v("SPEAKER_NAME")];

  it("builds the canonical title", () => {
    const out = renderTitle("{{PROGRAM_NAME}} | {{TOPIC}} | {{SPEAKER_NAME}}", vars, {
      PROGRAM_NAME: "Bhagavad Gita Workshop",
      TOPIC: "Who Am I?",
      SPEAKER_NAME: "XYZ",
    });
    expect(out.text).toBe("Bhagavad Gita Workshop | Who Am I? | XYZ");
    expect(out.tooLong).toBe(false);
  });

  it("flattens newlines pasted into a variable", () => {
    const out = renderTitle("{{TOPIC}}", [v("TOPIC")], { TOPIC: "Line one\nLine two" });
    expect(out.text).toBe("Line one Line two");
  });

  it("flags titles over the YouTube limit", () => {
    const out = renderTitle("{{TOPIC}}", [v("TOPIC")], { TOPIC: "x".repeat(101) });
    expect(out.length).toBe(101);
    expect(out.tooLong).toBe(true);
  });

  it("respects a stricter per-template maxLength", () => {
    const out = renderTitle("{{TOPIC}}", [v("TOPIC")], { TOPIC: "x".repeat(40) }, 30);
    expect(out.tooLong).toBe(true);
  });

  it("counts astral characters as single characters", () => {
    // Naive .length would report 4 for two emoji and wrongly reject.
    const out = renderTitle("{{T}}", [v("T")], { T: "👍👍" });
    expect(out.length).toBe(2);
  });

  it("detects characters YouTube rejects outright", () => {
    const out = renderTitle("{{T}}", [v("T")], { T: "a <b> c" });
    expect(out.forbiddenChars).toEqual(["<", ">"]);
  });
});

describe("renderDescription", () => {
  const body = [
    "Hare Krishna!",
    "",
    "Welcome to {{PROGRAM_NAME}}.",
    "",
    "Today's topic:",
    "{{TOPIC}}",
    "",
    "{{MAIN_DESCRIPTION}}",
    "",
    "{{SOCIAL_LINKS}}",
    "",
    "{{HASHTAGS}}",
  ].join("\n");

  const vars = [
    v("PROGRAM_NAME"),
    v("TOPIC"),
    v("MAIN_DESCRIPTION"),
    v("SOCIAL_LINKS", {
      required: false,
      isLocked: true,
      lockedValue: "Instagram: @example",
    }),
    v("HASHTAGS", { required: false, isLocked: true, lockedValue: "#BhagavadGita #Krishna" }),
  ];

  it("renders a complete description", () => {
    const out = renderDescription(body, vars, {
      PROGRAM_NAME: "Gita Workshop",
      TOPIC: "Who Am I?",
      MAIN_DESCRIPTION: "Today we discussed the self.",
    });
    expect(out.missing).toHaveLength(0);
    expect(out.text).toContain("Welcome to Gita Workshop.");
    expect(out.text).toContain("Instagram: @example");
    expect(out.text).toContain("#BhagavadGita");
    // No stray blank-line runs.
    expect(out.text).not.toMatch(/\n{3,}/);
  });

  it("reports each missing required field", () => {
    const out = renderDescription(body, vars, { PROGRAM_NAME: "X" });
    expect(out.missing.map((m) => m.key).sort()).toEqual(["MAIN_DESCRIPTION", "TOPIC"]);
  });

  it("flags descriptions over 5000 characters", () => {
    const out = renderDescription("{{M}}", [v("M")], { M: "x".repeat(5001) });
    expect(out.tooLong).toBe(true);
    expect(YOUTUBE_LIMITS.descriptionMaxChars).toBe(5000);
  });
});

describe("resolveTags", () => {
  it("re-adds mandatory tags the client removed", () => {
    const out = resolveTags(["Youth"], ["BhagavadGita", "Krishna"]);
    expect(out.tags).toEqual(["BhagavadGita", "Krishna", "Youth"]);
    expect(out.reAdded).toEqual(["BhagavadGita", "Krishna"]);
  });

  it("does not duplicate a mandatory tag the client already included", () => {
    const out = resolveTags(["krishna", "Youth"], ["Krishna"]);
    expect(out.tags).toEqual(["Krishna", "Youth"]);
    expect(out.reAdded).toEqual([]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(resolveTags(["Gita", "gita", "GITA"], []).tags).toEqual(["Gita"]);
  });

  it("trims and collapses internal whitespace", () => {
    expect(resolveTags(["  Bhagavad   Gita  "], []).tags).toEqual(["Bhagavad Gita"]);
  });

  it("drops tags over the per-tag character limit", () => {
    const out = resolveTags(["x".repeat(101)], []);
    expect(out.tags).toEqual([]);
    expect(out.dropped[0].reason).toContain("100 characters");
  });

  it("enforces the total character budget, keeping mandatory tags first", () => {
    // 10 selected tags of 60 chars each greatly exceeds the 500-char budget.
    const selected = Array.from({ length: 10 }, (_, i) => `${String(i)}${"y".repeat(59)}`);
    const out = resolveTags(selected, ["MUSTHAVE"]);
    expect(out.tags[0]).toBe("MUSTHAVE");
    expect(out.totalChars).toBeLessThanOrEqual(YOUTUBE_LIMITS.tagsMaxTotalChars);
    expect(out.dropped.length).toBeGreaterThan(0);
  });

  it("enforces the maximum tag count", () => {
    const many = Array.from({ length: 80 }, (_, i) => `t${i}`);
    const out = resolveTags(many, []);
    expect(out.tags.length).toBeLessThanOrEqual(YOUTUBE_LIMITS.maxTags);
  });

  it("ignores empty and whitespace-only tags", () => {
    expect(resolveTags(["", "   ", "Real"], []).tags).toEqual(["Real"]);
  });
});

describe("hashtags", () => {
  it("extracts hashtags, lower-cased and unique", () => {
    expect(extractHashtags("hello #Krishna and #krishna #Gita")).toEqual(["krishna", "gita"]);
  });

  it("does not treat a mid-word # as a hashtag", () => {
    expect(extractHashtags("colour#notatag")).toEqual([]);
  });

  it("supports non-ASCII hashtags", () => {
    expect(extractHashtags("#कृष्ण")).toEqual(["कृष्ण"]);
  });

  it("reports mandatory hashtags missing from the description", () => {
    const desc = "Some text #BhagavadGita";
    expect(findMissingHashtags(desc, ["#BhagavadGita", "#Krishna"])).toEqual(["krishna"]);
  });

  it("matches mandatory hashtags case-insensitively and without the hash", () => {
    expect(findMissingHashtags("text #krishna", ["Krishna"])).toEqual([]);
  });
});

describe("lintTemplate", () => {
  it("errors on a placeholder with no matching field", () => {
    const issues = lintTemplate("Hi {{GHOST}}", []);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("{{GHOST}}");
  });

  it("warns about a field that is never used", () => {
    const issues = lintTemplate("nothing", [v("UNUSED", { label: "Unused" })]);
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("Unused"))).toBe(true);
  });

  it("errors when a locked field has no locked value", () => {
    const issues = lintTemplate("{{L}}", [v("L", { isLocked: true, lockedValue: null })]);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("locked"))).toBe(true);
  });

  it("errors on a malformed placeholder", () => {
    const issues = lintTemplate("{{bad-key}}", []);
    expect(issues.some((i) => i.message.includes("not a valid placeholder"))).toBe(true);
  });

  it("passes a well-formed template", () => {
    expect(lintTemplate("{{A}} and {{B}}", [v("A"), v("B")])).toEqual([]);
  });
});
