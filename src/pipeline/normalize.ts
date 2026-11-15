import { parsePostedDate } from "./dates";
import { detectCountry, detectOfficeRequirement, isLocationOk, matchCity } from "./location";
import { cleanText, foldForMatch, shortHash } from "./text";
import type { ApprovedCity, NormalizedJob, RawJob, Source } from "./types";

export type NormalizeContext = {
  source: Source;
  cities: ApprovedCity[];
  /** Company names from the Airtable `Companies` table where Favorite is ticked (add Hebrew spellings too). */
  favoriteCompanies?: string[];
  now?: Date;
};

/**
 * Field names each Apify actor uses, checked against real output (trial of 2026-11-15):
 *  - curious_coder/linkedin-jobs-scraper: companyName, location, postedAt, descriptionText, link (applyUrl is always empty)
 *  - valig/linkedin-jobs-scraper:         companyName, location, postedDate, description, url (applyUrl empty; `workType` is the INDUSTRY, not remote/hybrid)
 *  - blackfalcondata/drushim-scraper:     company, location(+English), isRemote/isHybrid, scopes, requirements, portalUrl, applyUrl, isExpired
 *  - swerve/drushim-scraper:              jobTitle, companyName, addresses[] (several cities), scopes[], requirements, url, postedAt, isExpired
 */
const KEYS = {
  title: ["title", "jobTitle", "position", "name"],
  company: ["company", "companyName", "employer", "hiringOrganization"],
  location: ["location", "jobLocation", "formattedLocation", "addresses", "locationEnglish", "city"],
  description: ["descriptionText", "description", "descriptionMarkdown", "descriptionHtml", "jobDescription", "details"],
  requirements: ["requirements", "requirementsText"],
  applyUrl: ["applyUrl", "applyLink", "externalApplyLink", "applicationUrl"],
  jobUrl: ["link", "url", "jobUrl", "portalUrl", "postingUrl", "jobLink"],
  id: ["id", "jobId", "job_id", "jobCode", "postingId"],
  postedDate: ["postedAt", "postedDate", "publishedAt", "datePosted", "listedAt", "postedTime", "displayDate", "date"],
  // NOT "workType": valig uses it for the industry ("Software Development").
  workplace: ["workplaceType", "remoteType", "work_type", "workplace", "employmentLocation", "scopes"],
  remote: ["remote", "isRemote", "is_remote"],
  hybrid: ["isHybrid", "is_hybrid"],
  expired: ["isExpired", "expired"],
};

/** A readable string from a raw value: strings, numbers, `{name}` / `{text}` objects, arrays. */
function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asText(o.name ?? o.text ?? o.value ?? o.label ?? "");
  }
  return "";
}

function pick(raw: RawJob, keys: string[]): string {
  for (const k of keys) {
    const s = asText(raw[k]);
    if (s) return s;
  }
  return "";
}

/** The location as a list: a job can name several cities (Drushim `addresses`). */
function pickLocations(raw: RawJob): string[] {
  for (const k of KEYS.location) {
    const v = raw[k];
    const list = (Array.isArray(v) ? v : [v]).map(asText).filter(Boolean);
    if (list.length) return list;
  }
  return [];
}

const flag = (raw: RawJob, keys: string[]) =>
  keys.some((k) => raw[k] === true || (typeof raw[k] === "string" && (raw[k] as string).toLowerCase() === "true"));

const TRACKING_PARAMS = /^(utm_.*|trk|trackingid|refid|ref|ebp|lipi|midtoken|midsig|otptoken|recommendedflavor|original_referer|src|source)$/i;

/**
 * Removes tracking parameters so the same job always has the same link.
 * LinkedIn job pages are fully identified by their path, so all their parameters
 * (position, pageNum, refId, trackingId, ...) are dropped.
 */
export function cleanUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (/(^|\.)linkedin\.com$/.test(u.hostname) && u.pathname.startsWith("/jobs/view")) {
      u.search = "";
    } else {
      for (const key of [...u.searchParams.keys()]) {
        if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
      }
    }
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Job ID taken from the page URL (stable across runs and across actors). */
export function idFromUrl(url: string): string | null {
  return (
    url.match(/linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ??
    url.match(/drushim\.co\.il\/job\/(\d+)/)?.[1] ??
    url.match(/drushim\.co\.il\/sendcv\.aspx\?jobcode=(\d+)/i)?.[1] ??
    null
  );
}

/** "drushim-38796844" → "38796844" so actors that prefix their IDs still agree. */
const cleanId = (id: string) => id.match(/^[A-Za-z]+-(\d+)$/)?.[1] ?? id;

const LEGAL_SUFFIX = /\b(ltd|limited|inc|incorporated|llc|corp|corporation|co|gmbh|plc)\b|בעמ/g;

/** Company name for comparison: no punctuation, no "Ltd/Inc/בע"מ". */
export function foldCompany(name: string): string {
  return foldForMatch(name).replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

/** "AT&T Israel" matches favorite "AT&T"; "Navina Ltd" matches "Navina"; "Attack Inc" does not match "AT&T". */
export function isFavoriteCompany(company: string, favorites: string[]): boolean {
  const c = foldCompany(company);
  return favorites.some((f) => {
    const fav = foldCompany(f);
    return fav !== "" && (c === fav || c.startsWith(`${fav} `));
  });
}

export function detectLanguage(text: string): "Hebrew" | "English" | null {
  const hebrew = (text.match(/[֐-׿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (hebrew + latin === 0) return null;
  return hebrew / (hebrew + latin) > 0.3 ? "Hebrew" : "English";
}

/**
 * One raw actor item → the common shape. Returns null when the item has no usable title
 * (nothing to match or show) or the source marks it as expired. Never throws on odd input.
 */
export function normalizeJob(raw: RawJob, ctx: NormalizeContext): NormalizedJob | null {
  if (flag(raw, KEYS.expired)) return null;
  const title = cleanText(pick(raw, KEYS.title));
  if (!title) return null;

  // "- חסוי -" (confidential) → "חסוי"
  const company = cleanText(pick(raw, KEYS.company)).replace(/^[-–\s]+|[-–\s]+$/g, "");
  const locations = pickLocations(raw).map(cleanText);
  const location = locations.join(" / ");

  let description = cleanText(pick(raw, KEYS.description));
  const requirements = cleanText(pick(raw, KEYS.requirements));
  if (requirements && !description.includes(requirements)) {
    description = `${description}\n\nRequirements:\n${requirements}`.trim();
  }

  const directUrl = cleanUrl(pick(raw, KEYS.applyUrl));
  const pageUrl = cleanUrl(pick(raw, KEYS.jobUrl));
  const applyUrl = directUrl ?? pageUrl;

  const officeRequirement = detectOfficeRequirement({
    structured: `${pick(raw, KEYS.workplace)}${flag(raw, KEYS.hybrid) ? " hybrid" : ""}`.trim(),
    remoteFlag: flag(raw, KEYS.remote) ? true : undefined,
    title,
    location,
    description,
  });

  // A job may list several cities; it fits when ANY of them is an approved city.
  const places = locations.length ? locations : [""];
  const matched = places.map((p) => matchCity(p, ctx.cities)).find((c) => c !== null) ?? null;
  const locationOk = places.some((p) => isLocationOk(officeRequirement, p, ctx.cities));

  const sourceJobId =
    (pageUrl && idFromUrl(pageUrl)) || (directUrl && idFromUrl(directUrl)) || cleanId(pick(raw, KEYS.id)) || null;
  const externalId = `${ctx.source}:${
    sourceJobId ?? `h${shortHash([foldCompany(company), foldForMatch(title), foldForMatch(location)].join("|"))}`
  }`;

  return {
    externalId,
    source: ctx.source,
    sourceJobId,
    title,
    company,
    favoriteCompany: isFavoriteCompany(company, ctx.favoriteCompanies ?? []),
    location,
    city: matched ? matched.city : null,
    country: detectCountry(places[0]),
    officeRequirement,
    locationOk,
    description,
    applyUrl,
    postedDate: parsePostedDate(pick(raw, KEYS.postedDate), ctx.now),
    language: detectLanguage(`${title} ${description.slice(0, 1000)}`),
    alsoSeenOn: [],
  };
}

/** Normalizes a whole actor result, silently dropping unusable and expired items. */
export function normalizeAll(items: RawJob[], ctx: NormalizeContext): NormalizedJob[] {
  return items.flatMap((raw) => normalizeJob(raw, ctx) ?? []);
}
