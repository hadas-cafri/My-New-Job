import { isPreferredDomain } from "./domains";
import { ACTIVE_STATUSES, type Job, type Status } from "./types";

/** "newest": newest posting first (the default while there are no match scores). "fit": by match score. "priority": favorite companies and preferred domains first, then by match score. */
export type SortMode = "newest" | "fit" | "priority";

export type Filters = {
  query: string;
  source: string; // "" = all
  status: "active" | "all" | Status;
  minMatch: number; // 0..100
  locationOkOnly: boolean;
  /** "favorites": only jobs screened as a fit. "all": everything (favorites first). */
  view: "all" | "favorites";
  /** Also show jobs screened as "not fit" (hidden by default). */
  showHidden: boolean;
  /** Only jobs posted within this many days; 0 = any date. Jobs without a date are always kept. */
  maxAgeDays: number;
  sort: SortMode;
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  source: "",
  status: "active",
  minMatch: 0,
  locationOkOnly: true, // jobs outside the approved commuting area are hidden unless the user unticks it
  view: "all",
  showHidden: false, // jobs screened as "not fit" are not shown at all unless asked for
  maxAgeDays: 14,
  sort: "newest", // there are no match scores yet; "fit" (by score) is offered once jobs have scores
};

const DAY_MS = 86_400_000;

/** Whole days since a "YYYY-MM-DD" date (null when there is no usable date). */
export function ageInDays(postedDate: string | null, now: Date): number | null {
  if (!postedDate) return null;
  const t = Date.parse(postedDate);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

export function filterJobs(jobs: Job[], f: Filters, now: Date = new Date()): Job[] {
  const q = f.query.trim().toLowerCase();
  return jobs.filter((j) => {
    if (f.status === "active" && !ACTIVE_STATUSES.includes(j.status)) return false;
    if (f.status !== "active" && f.status !== "all" && j.status !== f.status) return false;
    if (f.source && j.source !== f.source) return false;
    if (f.locationOkOnly && !j.locationOk) return false;
    if (j.triage === "Not fit" && !f.showHidden) return false;
    if (f.view === "favorites" && j.triage !== "Fit") return false;
    if (f.maxAgeDays > 0) {
      const age = ageInDays(j.postedDate, now);
      if (age !== null && age > f.maxAgeDays) return false;
    }
    if ((j.match ?? 0) * 100 < f.minMatch) return false;
    if (q && !`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * How much the user WANTS the job, separate from how well she FITS it (the match score):
 * a favorite company or a preferred domain.
 */
export const isPriority = (j: Job): boolean => j.favoriteCompany || isPreferredDomain(j.domain);

/** Jobs screened as a fit come first, then the rest; "not fit" (when shown) last. */
const triageRank = (j: Job) => (j.triage === "Fit" ? 0 : j.triage === "Not fit" ? 2 : 1);

/**
 * Jobs that look like a fit (by title) always come first. Then "newest": newest posting first.
 * "fit": highest match score first; on equal scores target companies first; unscored last.
 * "priority": target companies and domains first, then highest score. Newest breaks remaining ties.
 */
export function sortJobs(jobs: Job[], mode: SortMode = "fit"): Job[] {
  return [...jobs].sort((a, b) => {
    const byTriage = triageRank(a) - triageRank(b);
    if (byTriage) return byTriage;
    if (mode === "newest") return (b.postedDate ?? "").localeCompare(a.postedDate ?? "");
    const byPriority = Number(isPriority(b)) - Number(isPriority(a));
    const byMatch = (b.match ?? -1) - (a.match ?? -1);
    const first = mode === "priority" ? byPriority || byMatch : byMatch || byPriority;
    return first || (b.postedDate ?? "").localeCompare(a.postedDate ?? "");
  });
}

export const matchPercent = (j: Job) => (j.match === null ? null : Math.round(j.match * 100));
