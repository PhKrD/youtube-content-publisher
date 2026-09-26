/**
 * The programmes content can belong to. Each may have its own title and
 * description templates; the programme picks which ones a submission uses.
 *
 * Pure module (no database) so the editor can import it in the browser.
 */
export type ProgramKey = "FFL" | "PITRU_PAKSHA" | "OTHERS";

export const PROGRAMS: { value: ProgramKey; label: string }[] = [
  { value: "FFL", label: "Food For Life" },
  { value: "PITRU_PAKSHA", label: "Pitru Paksha" },
  { value: "OTHERS", label: "Others" },
];

/**
 * The text {{PROGRAM_NAME}} renders to. "Others" has no fixed name, so the
 * contributor types one, stored as templateValues.PROGRAM_NAME.
 */
export function programDisplayName(
  program: ProgramKey | null | undefined,
  templateValues: Record<string, unknown>,
): string {
  if (program === "OTHERS" || !program) {
    const typed = templateValues.PROGRAM_NAME;
    return typeof typed === "string" ? typed : "";
  }
  return PROGRAMS.find((p) => p.value === program)!.label;
}
