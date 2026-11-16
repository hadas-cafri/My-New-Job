import { containsPhrase, foldForMatch } from "./text";
import type { ApprovedCity, OfficeRequirement } from "./types";

/**
 * Alternative spellings of the approved cities, keyed by the folded English name used in the
 * Airtable `Approved Cities` table. The table's own English + Hebrew names are always matched too.
 * Add a spelling here whenever a real job shows up with one we missed.
 */
const ALIASES: Record<string, string[]> = {
  "tel aviv yafo": ["tel aviv", "tel aviv jaffa", "tel aviv jafa", "telaviv", "tlv", "תל אביב", "תל אביב יפו"],
  "petah tikva": ["petah tikvah", "petach tikva", "petach tikvah", "petakh tikva", "פתח תקוה", "פתח תקווה"],
  "rishon lezion": ["rishon le zion", "rishon letzion", "rishon le tzion", "rishon lezyon", "ראשלצ"],
  "beer sheva": ["beersheba", "beer sheba", "beersheva", "באר שבע"],
  "kiryat gat": ["qiryat gat", "kiriat gat", "kiryat gath", "קרית גת", "קריית גת"],
  "kiryat malakhi": ["kiryat malachi", "kiriat malachi", "qiryat malakhi", "קרית מלאכי", "קריית מלאכי"],
  "kfar saba": ["kfar sava", "kefar sava", "kfar sabba"],
  "ness ziona": ["nes ziona", "ness tziona", "nes tziona"],
  netanya: ["natanya", "netania"],
  herzliya: ["herzlia", "herzeliya", "herzliyah"],
  raanana: ["ranana"],
  "bnei brak": ["bene brak", "benei brak"],
  givatayim: ["givatym"],
  yavne: ["yavneh"],
  ramla: ["ramle"],
  lod: ["lydda"],
  ashkelon: ["ashqelon"],
  rehovot: ["rehovoth"],
};

/** Words that make a place name a region rather than a city: "Tel Aviv District", "Greater Tel Aviv". */
const REGION_WORDS = new Set(["district", "area", "region", "metropolitan", "metro", "greater", "county", "מחוז", "אזור"]);

const stripRegionWords = (folded: string) =>
  folded.split(" ").filter((w) => !REGION_WORDS.has(w)).join(" ");

/** City part of a location: its first comma-separated segment ("Herzliya, Tel Aviv District, Israel" → Herzliya). */
function firstSegment(location: string): string {
  return location.split(/[,;|]/)[0] ?? "";
}

/**
 * Returns the approved city that the location points at, or null.
 * Only the FIRST segment counts, so "Rosh HaAyin, Tel Aviv District" is not treated as Tel Aviv.
 */
export function matchCity(location: string, cities: ApprovedCity[]): ApprovedCity | null {
  const segment = stripRegionWords(foldForMatch(firstSegment(location)));
  if (!segment) return null;
  for (const c of cities) {
    if (c.active === false) continue;
    const canonical = foldForMatch(c.city);
    const keys = [canonical, ...(ALIASES[canonical] ?? []).map(foldForMatch)];
    if (c.hebrewName) keys.push(foldForMatch(c.hebrewName));
    if (keys.some((k) => containsPhrase(segment, k))) return c;
  }
  return null;
}

const KNOWN_COUNTRIES = new Set([
  "united states", "usa", "us", "united kingdom", "uk", "england", "germany", "france", "canada", "india",
  "netherlands", "spain", "italy", "poland", "romania", "ireland", "switzerland", "sweden", "australia",
  "singapore", "ukraine", "czech republic", "portugal", "belgium", "austria", "denmark", "norway", "finland",
  "brazil", "mexico", "japan", "china", "united arab emirates", "uae", "cyprus", "greece", "turkey",
  "ארצות הברית", "בריטניה", "גרמניה", "צרפת", "קנדה", "הודו",
]);

/**
 * "Israel" / another country as written / null when the location names no country.
 * "Herzliya, Tel Aviv District, Israel" → Israel; "London, United Kingdom" → United Kingdom;
 * "Tel Aviv, Center" → null (we do not guess that "Center" is a country).
 */
export function detectCountry(location: string): string | null {
  const parts = location.split(/[,;|]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  const folded = foldForMatch(last);
  if (folded === "israel" || folded === "ישראל") return "Israel";
  if (KNOWN_COUNTRIES.has(folded)) return last;
  if (parts.length >= 3 && !REGION_WORDS.has(folded.split(" ").pop() ?? "")) return last; // City, State, Country
  return null;
}

// ---- office requirement ---------------------------------------------------------------------

function classifyWorkplace(text: string): OfficeRequirement | null {
  const f = foldForMatch(text);
  if (!f) return null;
  if (/\bhybrid\b/.test(f) || f.includes("היברידי")) return "Hybrid";
  if (/\bremote\b/.test(f) || f.includes("מרחוק") || f.includes("מהבית")) return "Fully remote";
  if (/\b(on site|onsite|in office|office)\b/.test(f) || f.includes("במשרד") || f.includes("מהמשרד")) {
    return "Daily office";
  }
  return null;
}

const HYBRID_RE = [
  /\bhybrid\b/,
  /\b\d\s*[-–]\s*\d\s*days?\s*(a\s*week\s*)?(in|at|from)\s*(the\s*)?office\b/,
  /\b\d\s*days?\s*(a|per)?\s*(week\s*)?(in|at|from)\s*(the\s*)?office\b/,
  /היברידי/,
  /\d\s*ימים\s*(בשבוע\s*)?(מ|ב)\s?משרד/,
];
const STRONG_REMOTE_RE = [
  /\b(fully|100%|completely|entirely|totally)[ -]remote\b/,
  /\bremote[- ]first\b/,
  /\bwork(ing)?\s*(from|at)\s*home\b/,
  /\bwork from anywhere\b/,
  /\bremote\s*(role|position|job|opportunity)\b/,
  /מרחוק\s*(לגמרי|מלא)/,
  /עבודה\s*(מלאה\s*)?(מרחוק|מהבית)/,
];
const ONSITE_RE = [
  /\b(on-?site|in-?office|office[- ]based)\b/,
  /\b5\s*days\s*(a\s*week\s*)?(in|at)\s*the\s*office\b/,
  /עבודה\s*מהמשרד|במשרדי\s*החברה|נוכחות\s*במשרד/,
];

/**
 * Daily office / Hybrid / Fully remote / Unknown.
 * Priority: the source's own structured field → title/location wording → description wording.
 * A bare mention of "remote" inside a description (e.g. "remote teams") is deliberately NOT enough.
 */
export function detectOfficeRequirement(input: {
  structured?: string;
  remoteFlag?: boolean;
  title: string;
  location: string;
  description: string;
}): OfficeRequirement {
  const fromField = input.structured ? classifyWorkplace(input.structured) : null;
  if (fromField) return fromField;
  if (input.remoteFlag === true) return "Fully remote";

  const head = classifyWorkplace(`${input.title} ${input.location}`);
  if (head) return head;

  const text = input.description.toLowerCase();
  if (HYBRID_RE.some((r) => r.test(text))) return "Hybrid";
  if (STRONG_REMOTE_RE.some((r) => r.test(text))) return "Fully remote";
  if (ONSITE_RE.some((r) => r.test(text))) return "Daily office";
  return "Unknown";
}

// ---- the location rule (spec §2א) -------------------------------------------------------------

/**
 * - Fully remote → always OK, wherever it is (including outside Israel).
 * - Office required (daily or hybrid) → the city must be an active approved city.
 * - Outside Israel and not fully remote → not OK.
 * - No location at all (empty, or just "Israel"), or only a region inside the approved area
 *   ("Center District") → OK: included and scored, not dropped.
 * - Unknown requirement → decided by the city: an approved city is OK either way, otherwise not.
 */
export function isLocationOk(
  officeRequirement: OfficeRequirement,
  location: string,
  cities: ApprovedCity[],
): boolean {
  if (officeRequirement === "Fully remote") return true;
  const country = detectCountry(location);
  if (country !== null && country !== "Israel") return false;
  if (hasNoPlace(location)) return true; // no location given: include it (the user's rule)
  if (matchCity(location, cities) !== null) return true;
  return isApprovedRegionOnly(location); // "Center District, Israel": no city, but inside the approved area
}

/**
 * Regions that lie inside the approved commuting area (spec §2א: south, center, Gush Dan, Sharon,
 * Shfela). A location that names only such a region ("Center District, Israel") has no city to
 * check, so it is included. North, Haifa and Jerusalem districts are NOT in this list.
 * (Region words like "district" are stripped before comparing.)
 */
const APPROVED_REGIONS = new Set(
  [
    "center", "central", "the center", "south", "southern", "the south", "sharon", "shfela", "gush dan", "gush dan area",
    "המרכז", "מרכז", "הדרום", "דרום", "השרון", "שרון", "השפלה", "שפלה", "גוש דן",
  ].map(foldForMatch),
);

/** True when the location is just a region inside the approved area, with no city named. */
export function isApprovedRegionOnly(location: string): boolean {
  return APPROVED_REGIONS.has(stripRegionWords(foldForMatch(firstSegment(location))));
}

/**
 * True when the location names no place at all: empty, or only the country ("Israel", "ישראל").
 * Such a job cannot be checked against the approved cities, so it is included rather than dropped.
 * A region alone is handled separately (isApprovedRegionOnly): it is a place, just not a city on the list.
 */
export function hasNoPlace(location: string): boolean {
  const first = foldForMatch(firstSegment(location));
  return first === "" || first === "israel" || first === "ישראל";
}
