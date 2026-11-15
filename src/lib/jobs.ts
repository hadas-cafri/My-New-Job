import { isPreferredDomain } from "./domains";
import { ACTIVE_STATUSES, type Job, type Status } from "./types";

/** "fit": by match score. "priority": favorite companies and preferred domains first, then by match score. */
export type SortMode = "fit" | "priority";

export type Filters = {
  query: string;
  source: string; // "" = all
  status: "active" | "all" | Status;
  minMatch: number; // 0..100
  locationOkOnly: boolean;
  sort: SortMode;
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  source: "",
  status: "active",
  minMatch: 0,
  locationOkOnly: false,
  sort: "fit",
};

export function filterJobs(jobs: Job[], f: Filters): Job[] {
  const q = f.query.trim().toLowerCase();
  return jobs.filter((j) => {
    if (f.status === "active" && !ACTIVE_STATUSES.includes(j.status)) return false;
    if (f.status !== "active" && f.status !== "all" && j.status !== f.status) return false;
    if (f.source && j.source !== f.source) return false;
    if (f.locationOkOnly && !j.locationOk) return false;
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

/**
 * "fit" (default): highest match first; on equal scores priority jobs come first; unscored last.
 * "priority": priority jobs first, then highest match. Newest posting breaks remaining ties.
 */
export function sortJobs(jobs: Job[], mode: SortMode = "fit"): Job[] {
  return [...jobs].sort((a, b) => {
    const byPriority = Number(isPriority(b)) - Number(isPriority(a));
    const byMatch = (b.match ?? -1) - (a.match ?? -1);
    const first = mode === "priority" ? byPriority || byMatch : byMatch || byPriority;
    return first || (b.postedDate ?? "").localeCompare(a.postedDate ?? "");
  });
}

export const matchPercent = (j: Job) => (j.match === null ? null : Math.round(j.match * 100));
