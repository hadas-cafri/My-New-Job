import { ACTIVE_STATUSES, type Job, type Status } from "./types";

export type Filters = {
  query: string;
  source: string; // "" = all
  status: "active" | "all" | Status;
  minMatch: number; // 0..100
  locationOkOnly: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  source: "",
  status: "active",
  minMatch: 0,
  locationOkOnly: false,
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

/** Highest match first; favorite companies win ties; unscored jobs last. */
export function sortJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const am = a.match ?? -1;
    const bm = b.match ?? -1;
    if (am !== bm) return bm - am;
    if (a.favoriteCompany !== b.favoriteCompany) return a.favoriteCompany ? -1 : 1;
    return (b.postedDate ?? "").localeCompare(a.postedDate ?? "");
  });
}

export const matchPercent = (j: Job) => (j.match === null ? null : Math.round(j.match * 100));
