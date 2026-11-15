import { parsePostedDate } from "./dates";
import { detectCountry, detectOfficeRequirement, isLocationOk, matchCity } from "./location";
import { cleanText, foldForMatch, shortHash } from "./text";
import type { ApprovedCity, NormalizedJob, RawJob, Source } from "./types";

export type NormalizeContext = {
  source: Source;
  cities: ApprovedCity[];
  /** Company names from the Airtable `Companies` table where Favorite is ticked. */
  favoriteCompanies?: string[];
  now?: Date;
};

/**
 * Field names each Apify actor might use for the same thing.
 * These are best guesses: after the Apify trial run, trim this to the real keys.
 */
const KEYS = {
  title: ["title", "jobTitle", "position", "name", "שם המשרה"],
  company: ["company", "companyName", "employer", "hiringOrganization", "חברה"],
  location: ["location", "jobLocation", "city", "formattedLocation", "מיקום", "עיר"],
  description: ["descriptionText", "description", "descriptionHtml", "jobDescription", "details", "תיאור"],
  applyUrl: ["applyUrl", "applyLink", "externalApplyLink", "applicationUrl"],
  jobUrl: ["jobUrl", "url", "link", "postingUrl", "jobLink"],
  id: ["id", "jobId", "job_id", "trackingId", "postingId"],
  postedDate: ["postedAt", "postedDate", "publishedAt", "datePosted", "listedAt", "postedTime", "date", "תאריך"],
  workplace: ["workplaceType", "workType", "workplace", "remoteType", "work_type", "employmentLocation"],
  remote: ["remote", "isRemote", "is_remote"],
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

const TRACKING_PARAMS = /^(utm_.*|trk|trackingid|refid|ref|ebp|lipi|midtoken|midsig|otptoken|recommendedflavor|original_referer|src|source)$/i;

/** Removes tracking parameters so the same job always has the same link. */
export function cleanUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Job ID taken from the page URL when the actor does not return one. */
export function idFromUrl(url: string): string | null {
  return (
    url.match(/linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ??
    url.match(/drushim\.co\.il\/job\/(\d+)/)?.[1] ??
    null
  );
}

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
 * (nothing to match or show). Never throws on odd input.
 */
export function normalizeJob(raw: RawJob, ctx: NormalizeContext): NormalizedJob | null {
  const title = cleanText(pick(raw, KEYS.title));
  if (!title) return null;

  const company = cleanText(pick(raw, KEYS.company));
  const location = cleanText(pick(raw, KEYS.location));
  const description = cleanText(pick(raw, KEYS.description));

  const directUrl = cleanUrl(pick(raw, KEYS.applyUrl));
  const pageUrl = cleanUrl(pick(raw, KEYS.jobUrl));
  const applyUrl = directUrl ?? pageUrl;

  const remoteRaw = KEYS.remote.map((k) => raw[k]).find((v) => v !== undefined);
  const officeRequirement = detectOfficeRequirement({
    structured: pick(raw, KEYS.workplace),
    remoteFlag: remoteRaw === true || remoteRaw === "true" ? true : undefined,
    title,
    location,
    description,
  });

  const matched = matchCity(location, ctx.cities);
  const sourceJobId = pick(raw, KEYS.id) || (pageUrl && idFromUrl(pageUrl)) || (directUrl && idFromUrl(directUrl)) || null;
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
    country: detectCountry(location),
    officeRequirement,
    locationOk: isLocationOk(officeRequirement, location, ctx.cities),
    description,
    applyUrl,
    postedDate: parsePostedDate(pick(raw, KEYS.postedDate), ctx.now),
    language: detectLanguage(`${title} ${description.slice(0, 1000)}`),
    alsoSeenOn: [],
  };
}

/** Normalizes a whole actor result, silently dropping items without a title. */
export function normalizeAll(items: RawJob[], ctx: NormalizeContext): NormalizedJob[] {
  return items.flatMap((raw) => normalizeJob(raw, ctx) ?? []);
}
