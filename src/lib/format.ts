/**
 * Job descriptions from the sources often arrive as one long block ("OverviewMicrosoft's mission...
 * ResponsibilitiesBecome a founding member..."): the line breaks were lost before we got them.
 * This restores readable structure for DISPLAY only; the stored text is never changed.
 */

/** Section titles that show up glued to the first word of their section. Longest first. */
const HEADINGS = [
  "Preferred Qualifications",
  "Minimum Qualifications",
  "Basic Qualifications",
  "Key Responsibilities",
  "Responsibilities",
  "Qualifications",
  "Requirements",
  "Job Requirements",
  "Overview",
  "What You[’']ll Do",
  "What You[’']ll Bring",
  "What You Bring",
  "What You Do",
  "About The Role",
  "About the Role",
  "About The Team",
  "About the Team",
  "About The Company",
  "About Us",
  "This Role Is Not For You If",
  "Nice to [Hh]ave",
  "Benefits",
  "How To Apply",
];

const HEADING_RE = new RegExp(`(${HEADINGS.join("|")})(?=[A-Z0-9#])`, "g");
const WHOLE_HEADING_RE = new RegExp(`^(${HEADINGS.join("|")}):?$`);

/** Text with readable paragraphs. Text that already has line breaks is left as it is. */
export function formatDescription(input: string): string {
  let text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const alreadyStructured = text.split("\n").length > Math.max(3, text.length / 400);
  if (!alreadyStructured) {
    text = text
      .replace(HEADING_RE, "\n\n$1\n") // "ResponsibilitiesBecome" → heading line, then the text
      .replace(/([a-z0-9)\]])\.(?=[A-Z][a-z])/g, "$1.\n"); // "culture.Shape" → a new line per sentence
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export type DescriptionBlock = { kind: "heading" | "text"; text: string };

/** The formatted description as blocks the page can render (headings bold, the rest paragraphs). */
export function descriptionBlocks(input: string): DescriptionBlock[] {
  return formatDescription(input)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => (WHOLE_HEADING_RE.test(line) ? { kind: "heading", text: line.replace(/:$/, "") } : { kind: "text", text: line }));
}
