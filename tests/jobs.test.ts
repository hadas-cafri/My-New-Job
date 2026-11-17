import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, ageInDays, filterJobs, isPriority, matchPercent, sortJobs } from "@/lib/jobs";
import type { Job } from "@/lib/types";

const job = (over: Partial<Job>): Job => ({
  id: "rec1",
  title: "Senior Product Manager",
  company: "Acme",
  favoriteCompany: false,
  location: "Tel Aviv",
  officeRequirement: "Hybrid",
  locationOk: true,
  description: "",
  applyUrl: null,
  match: 0.7,
  rationale: "",
  skillGaps: "",
  missingKeywords: "",
  cvSuggestions: "",
  cvSuggestionsRequested: false,
  triage: null,
  recommendedCv: null,
  domain: null,
  source: "LinkedIn",
  language: "English",
  postedDate: "2026-11-10",
  firstSeen: null,
  lastSeen: null,
  status: "New",
  appliedDate: null,
  notes: "",
  ...over,
});

describe("sortJobs", () => {
  it("hides jobs outside the approved area by default (the user's rule), and shows them when unticked", () => {
    const list = [job({ id: "ok", locationOk: true }), job({ id: "far", locationOk: false })];
    expect(DEFAULT_FILTERS.locationOkOnly).toBe(true);
    expect(filterJobs(list, DEFAULT_FILTERS).map((j) => j.id)).toEqual(["ok"]);
    expect(filterJobs(list, { ...DEFAULT_FILTERS, locationOkOnly: false })).toHaveLength(2);
  });

  it("orders by match descending, unscored last", () => {
    const sorted = sortJobs([
      job({ id: "a", match: 0.5 }),
      job({ id: "b", match: null }),
      job({ id: "c", match: 0.9 }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(["c", "a", "b"]);
  });

  it("breaks ties in favor of favorite companies", () => {
    const sorted = sortJobs([
      job({ id: "a", match: 0.8 }),
      job({ id: "b", match: 0.8, favoriteCompany: true }),
    ]);
    expect(sorted[0].id).toBe("b");
  });

  it("does not mutate the input", () => {
    const input = [job({ id: "a", match: 0.1 }), job({ id: "b", match: 0.9 })];
    sortJobs(input);
    expect(input[0].id).toBe("a");
  });
});

describe("priority is separate from fit", () => {
  const fit = job({ id: "fit", match: 0.9, domain: "Other" });
  const wanted = job({ id: "wanted", match: 0.6, domain: "Medtech" });
  const fav = job({ id: "fav", match: 0.7, favoriteCompany: true });

  it("a favorite company or a preferred domain is a priority job; match score has no part in it", () => {
    expect(isPriority(fav)).toBe(true);
    expect(isPriority(wanted)).toBe(true);
    expect(isPriority(job({ domain: "Biotech" }))).toBe(true);
    expect(isPriority(fit)).toBe(false);
    expect(isPriority(job({ match: 1, domain: "Telco" }))).toBe(false); // telco is not preferred (yet)
    expect(isPriority(job({ match: 0, domain: "Medtech" }))).toBe(true);
  });

  it("default sort is pure fit: a priority job with a lower score does NOT jump ahead", () => {
    expect(sortJobs([wanted, fav, fit]).map((j) => j.id)).toEqual(["fit", "fav", "wanted"]);
  });

  it("'priority' sort puts priority jobs first, each group by fit", () => {
    expect(sortJobs([fit, wanted, fav], "priority").map((j) => j.id)).toEqual(["fav", "wanted", "fit"]);
  });

  it("on equal fit, priority jobs come first even in the default sort", () => {
    const a = job({ id: "a", match: 0.8 });
    const b = job({ id: "b", match: 0.8, domain: "Biotech" });
    expect(sortJobs([a, b]).map((j) => j.id)).toEqual(["b", "a"]);
  });
});

describe("filterJobs", () => {
  const jobs = [
    job({ id: "new", status: "New" }),
    job({ id: "closed", status: "Closed" }),
    job({ id: "rej", status: "Rejected" }),
    job({ id: "int", status: "Interview", source: "Drushim", match: 0.95 }),
  ];

  it("hides closed/rejected by default", () => {
    expect(filterJobs(jobs, DEFAULT_FILTERS).map((j) => j.id)).toEqual(["new", "int"]);
  });

  it("'all' shows everything", () => {
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, status: "all" })).toHaveLength(4);
  });

  it("filters by an explicit status", () => {
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, status: "Closed" }).map((j) => j.id)).toEqual([
      "closed",
    ]);
  });

  it("filters by source and minimum match", () => {
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, source: "Drushim" }).map((j) => j.id)).toEqual(["int"]);
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, minMatch: 90 }).map((j) => j.id)).toEqual(["int"]);
  });

  it("filters by location-ok and free text", () => {
    const list = [job({ id: "x", locationOk: false }), job({ id: "y", title: "Solution Architect" })];
    expect(filterJobs(list, { ...DEFAULT_FILTERS, locationOkOnly: true }).map((j) => j.id)).toEqual(["y"]);
    expect(filterJobs(list, { ...DEFAULT_FILTERS, query: "architect" }).map((j) => j.id)).toEqual(["y"]);
  });
});

describe("matchPercent", () => {
  it("converts fraction to rounded percent", () => {
    expect(matchPercent(job({ match: 0.857 }))).toBe(86);
    expect(matchPercent(job({ match: null }))).toBeNull();
  });
});

describe("first-pass screening (Triage) and freshness", () => {
  const NOW = new Date("2026-11-16T12:00:00Z");
  const list = [
    job({ id: "fit", triage: "Fit", postedDate: "2026-11-14" }),
    job({ id: "maybe", triage: "Maybe", postedDate: "2026-11-14" }),
    job({ id: "none", triage: null, postedDate: "2026-11-14" }),
    job({ id: "nofit", triage: "Not fit", postedDate: "2026-11-14" }),
    job({ id: "old", triage: null, postedDate: "2026-10-20" }),
    job({ id: "nodate", triage: null, postedDate: null }),
  ];
  const ids = (f: Partial<typeof DEFAULT_FILTERS>) =>
    sortJobs(filterJobs(list, { ...DEFAULT_FILTERS, ...f }, NOW)).map((j) => j.id);

  it("by default: not-fit jobs and jobs older than 14 days are hidden; favorites come first", () => {
    expect(ids({})).toEqual(["fit", "maybe", "none", "nodate"]);
  });

  it("favorites only shows just the jobs screened as a fit", () => {
    expect(ids({ view: "favorites" })).toEqual(["fit"]);
  });

  it("showing hidden jobs adds the not-fit ones, last", () => {
    expect(ids({ showHidden: true })).toEqual(["fit", "maybe", "none", "nodate", "nofit"]);
  });

  it("the age window can be widened or removed; a job without a date is never dropped for age", () => {
    expect(ids({ maxAgeDays: 7 })).toContain("nodate");
    expect(ids({ maxAgeDays: 30 })).toContain("old");
    expect(ids({ maxAgeDays: 0 })).toContain("old");
  });

  it("ageInDays", () => {
    expect(ageInDays("2026-11-16", NOW)).toBe(0);
    expect(ageInDays("2026-11-02", NOW)).toBe(14);
    expect(ageInDays(null, NOW)).toBeNull();
    expect(ageInDays("not a date", NOW)).toBeNull();
  });
});

describe("sort modes", () => {
  const list = [
    job({ id: "old-high", match: 0.9, postedDate: "2026-11-01" }),
    job({ id: "new-none", match: null, postedDate: "2026-11-15" }),
    job({ id: "fit-old", triage: "Fit", postedDate: "2026-11-02" }),
    job({ id: "new-star", match: null, favoriteCompany: true, postedDate: "2026-11-14" }),
  ];
  const ids = (mode: Parameters<typeof sortJobs>[1]) => sortJobs(list, mode).map((j) => j.id);

  it("the default is newest first (there are no scores yet), jobs that look like a fit on top", () => {
    expect(DEFAULT_FILTERS.sort).toBe("newest");
    expect(ids("newest")).toEqual(["fit-old", "new-none", "new-star", "old-high"]);
  });

  it("by score: highest score first (a job that looks like a fit still comes first)", () => {
    expect(ids("fit")).toEqual(["fit-old", "old-high", "new-star", "new-none"]);
  });

  it("target companies first", () => {
    expect(ids("priority")).toEqual(["fit-old", "new-star", "old-high", "new-none"]);
  });
});

