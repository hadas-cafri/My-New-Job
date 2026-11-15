import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filterJobs, matchPercent, sortJobs } from "@/lib/jobs";
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
