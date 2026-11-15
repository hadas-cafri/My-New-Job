const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
};

/** HTML → readable plain text (keeps line breaks and list bullets). */
export function stripHtml(input: string): string {
  return input
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Plain text with tidy whitespace; safe to store and display. */
export function cleanText(input: unknown): string {
  if (typeof input !== "string") return "";
  return stripHtml(input)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Comparison form: lowercase, no Hebrew vowel marks, no apostrophes/quotes
 * (Be'er → beer, בע"מ → בעמ, ראשל"צ → ראשלצ), all other punctuation → single space.
 */
export function foldForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/['’‘`׳"״”“]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when `phrase` appears in `text` as whole words (both already folded). */
export function containsPhrase(text: string, phrase: string): boolean {
  return phrase !== "" && ` ${text} `.includes(` ${phrase} `);
}

/** "מנהל/ת מוצר בכיר/ה" → "מנהל מוצר בכיר"; "(m/f/d)" style tags are removed too. */
export function stripGenderMarkers(input: string): string {
  return input
    .replace(/[/\\]\s*(ית|ת|ה)(?![\p{L}])/gu, "")
    .replace(/\(\s*(ית|ת|ה)\s*\)/gu, "")
    .replace(/\(\s*[mfdxw](\s*[/|]\s*[mfdxw])+\s*\)/gi, "");
}

/** Small deterministic (non-cryptographic) hash, used to build stable fallback IDs. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
