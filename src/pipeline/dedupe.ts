import { foldCompany } from "./normalize";
import { foldForMatch, stripGenderMarkers } from "./text";
import type { NormalizedJob, Source } from "./types";

/** Same job on different sites → same fingerprint (company + title + city, or "remote"). */
export function fingerprint(job: NormalizedJob): string {
  const title = foldForMatch(stripGenderMarkers(job.title).replace(/\([^)]*\)/g, " "));
  const place =
    job.officeRequirement === "Fully remote" ? "remote" : (job.city ? foldForMatch(job.city) : foldForMatch(job.location));
  return [foldCompany(job.company), title, place].join("|");
}

const AGGREGATORS = ["linkedin.com", "drushim.co.il", "alljobs.co.il", "indeed.com", "glassdoor.com"];

/** True when the link goes to the company's own site/ATS rather than to a job board. */
export function isDirectCompanyUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return !AGGREGATORS.some((a) => host === a || host.endsWith(`.${a}`));
  } catch {
    return false;
  }
}

const SOURCE_RANK: Record<Source, number> = { "Company site": 0, LinkedIn: 1, Drushim: 2 };

/** Which copy to keep: direct company link, then the fuller description, then the better source. */
function better(a: NormalizedJob, b: NormalizedJob): NormalizedJob {
  const da = isDirectCompanyUrl(a.applyUrl);
  const db = isDirectCompanyUrl(b.applyUrl);
  if (da !== db) return da ? a : b;
  if (a.description.length !== b.description.length) return a.description.length > b.description.length ? a : b;
  return SOURCE_RANK[a.source] <= SOURCE_RANK[b.source] ? a : b;
}

export type DedupeResult = {
  unique: NormalizedJob[];
  /** For every merged group: the ID kept and the IDs dropped. */
  merged: { kept: string; dropped: string[] }[];
};

/**
 * Same source, same company/title/city AND the same description text = the employer posted the
 * job again under a new ID (seen on Drushim). Keeps the newer posting.
 * Same title but a different description = a different opening, so both stay.
 */
function collapseReposts(list: NormalizedJob[], merged: DedupeResult["merged"]): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  const byText = new Map<string, NormalizedJob>();
  for (const job of list) {
    const text = foldForMatch(job.description).slice(0, 2000);
    const prev = text.length >= 40 ? byText.get(text) : undefined;
    if (!prev) {
      if (text.length >= 40) byText.set(text, job);
      out.push(job);
      continue;
    }
    const kept = (job.postedDate ?? "") > (prev.postedDate ?? "") ? job : prev;
    const dropped = kept === job ? prev : job;
    out[out.indexOf(prev)] = kept;
    byText.set(text, kept);
    merged.push({ kept: kept.externalId, dropped: [dropped.externalId] });
  }
  return out;
}

/**
 * 1) identical externalId (same source, same job id) → one copy;
 * 2) a repost (same source, same text, new ID) → the newer copy;
 * 3) the same job on DIFFERENT sources (same fingerprint) → one copy, remembering the other
 *    sources in `alsoSeenOn`.
 *
 * Two different openings with the same title at the same company and city, on the same source
 * (different text), are kept as two jobs: copies are only paired up across sources
 * (1st LinkedIn ↔ 1st Drushim, 2nd LinkedIn ↔ 2nd Drushim, ...).
 * Order of first appearance is preserved.
 */
export function dedupe(jobs: NormalizedJob[]): DedupeResult {
  const merged: DedupeResult["merged"] = [];

  // 1) same externalId
  const byId = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const prev = byId.get(job.externalId);
    if (!prev) {
      byId.set(job.externalId, job);
      continue;
    }
    const kept = better(prev, job);
    byId.set(job.externalId, kept);
    merged.push({ kept: kept.externalId, dropped: [job.externalId] });
  }

  // 2) same fingerprint, different sources
  const groups = new Map<string, NormalizedJob[]>();
  for (const job of byId.values()) {
    const key = fingerprint(job);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(job);
  }

  const unique: NormalizedJob[] = [];
  for (const group of groups.values()) {
    const buckets = new Map<Source, NormalizedJob[]>();
    for (const job of group) {
      if (!buckets.has(job.source)) buckets.set(job.source, []);
      buckets.get(job.source)!.push(job);
    }
    const lists = [...buckets.values()].map((l) => collapseReposts(l, merged));
    const openings = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < openings; i++) {
      const members = lists.map((l) => l[i]).filter((j): j is NormalizedJob => j !== undefined);
      const kept = members.reduce(better);
      const dropped = members.filter((j) => j !== kept);
      if (dropped.length === 0) {
        unique.push(kept);
        continue;
      }
      merged.push({ kept: kept.externalId, dropped: dropped.map((d) => d.externalId) });
      unique.push({ ...kept, alsoSeenOn: [...new Set([...kept.alsoSeenOn, ...dropped.map((d) => d.source)])] });
    }
  }
  return { unique, merged };
}

/** Splits a batch into jobs not yet in Airtable (create) and ones already there (update Last Seen). */
export function classify(jobs: NormalizedJob[], existingIds: Set<string>) {
  const fresh: NormalizedJob[] = [];
  const seen: NormalizedJob[] = [];
  for (const job of jobs) (existingIds.has(job.externalId) ? seen : fresh).push(job);
  return { fresh, seen };
}
