import { describe, expect, it } from "vitest";
import { programDisplayName } from "./programs";

describe("programDisplayName", () => {
  it("uses the fixed name for named programmes, ignoring stale typed text", () => {
    expect(programDisplayName("FFL", { PROGRAM_NAME: "old" })).toBe("Food For Life");
    expect(programDisplayName("PITRU_PAKSHA", {})).toBe("Pitru Paksha");
  });

  it("uses the typed name for Others, never the code 'OTHERS'", () => {
    expect(programDisplayName("OTHERS", { PROGRAM_NAME: "Bhagavad Gita Workshop" })).toBe(
      "Bhagavad Gita Workshop",
    );
    expect(programDisplayName("OTHERS", {})).toBe("");
  });
});

describe("Devanagari date", () => {
  it("formats a date-picker value as २६/०९/२०२६", () => {
    const f = new Intl.DateTimeFormat("hi-IN-u-nu-deva", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    });
    expect(f.format(new Date("2026-09-26"))).toBe("२६/०९/२०२६");
  });
});
