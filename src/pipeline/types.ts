export type Source = "LinkedIn" | "Drushim" | "Company site";

/** Values match the single-select choices in the Airtable `Jobs` table. */
export type OfficeRequirement = "Daily office" | "Hybrid" | "Fully remote" | "Unknown";

/** A row of the Airtable `Approved Cities` table. */
export type ApprovedCity = { city: string; hebrewName?: string; active?: boolean };

/** Whatever an Apify actor returned for one job. Shapes differ per actor, so keys are probed by alias. */
export type RawJob = Record<string, unknown>;

/** One job in the single shape shared by all sources (the output of normalization). */
export type NormalizedJob = {
  /** Dedup key: `${source}:${sourceJobId}`, or a stable content hash when the source gives no id. */
  externalId: string;
  source: Source;
  sourceJobId: string | null;
  title: string;
  company: string;
  favoriteCompany: boolean;
  /** Location as written by the source (cleaned). */
  location: string;
  /** Canonical English name from `Approved Cities`, or null when not an approved city. */
  city: string | null;
  /** "Israel", another country as written, or null when the source gave none. */
  country: string | null;
  officeRequirement: OfficeRequirement;
  /** Applies the location rule from spec §2א. */
  locationOk: boolean;
  description: string;
  /** Direct apply link when the actor provides one, otherwise the job page. */
  applyUrl: string | null;
  /** YYYY-MM-DD */
  postedDate: string | null;
  language: "Hebrew" | "English" | null;
  /** Other sources where the same job was found (filled by dedupe). */
  alsoSeenOn: Source[];
};
