/**
 * Tests built from REAL Apify output (trial of 2026-11-15, see real-samples.json).
 * They guard the things that went wrong when the normalizer was first written from guesses.
 */
import { describe, expect, it } from "vitest";
import { dedupe } from "@/pipeline/dedupe";
import { normalizeJob } from "@/pipeline/normalize";
import { isTargetRole } from "@/pipeline/roles";
import { cleanText } from "@/pipeline/text";
import type { RawJob, Source } from "@/pipeline/types";
import samples from "./real-samples.json";
import { CITIES } from "./fixtures";

const now = new Date("2026-11-15T12:00:00Z");
const norm = (raw: unknown, source: Source) =>
  normalizeJob(raw as RawJob, { source, cities: CITIES, favoriteCompanies: ["AT&T", "JFrog", "Navina", "MDClone"], now })!;

describe("LinkedIn (curious_coder + valig)", () => {
  it("hybrid job: type found in the text, city from 'Tel Aviv-Yafo, Tel Aviv District, Israel'", () => {
    const job = norm(samples.curious.hybrid, "LinkedIn");
    expect(job).toMatchObject({
      source: "LinkedIn",
      company: "Similarweb",
      city: "Tel Aviv-Yafo",
      country: "Israel",
      officeRequirement: "Hybrid",
      locationOk: true,
      language: "English",
    });
    expect(isTargetRole(job.title)).toBe(true);
  });

  it("ID comes from the job page, and the link loses LinkedIn's tracking parameters", () => {
    const raw = samples.curious.hybrid as RawJob;
    const job = norm(raw, "LinkedIn");
    expect(job.sourceJobId).toBe(String(raw.id));
    expect(job.externalId).toBe(`LinkedIn:${raw.id}`);
    expect(job.applyUrl).toMatch(/^https:\/\/il\.linkedin\.com\/jobs\/view\/[^?]+$/);
    expect(job.applyUrl).not.toMatch(/refId|trackingId|position|pageNum/);
  });

  it("applyUrl is empty in the real output, so the job page link is used", () => {
    expect((samples.curious.hybrid as RawJob).applyUrl).toBe("");
    expect(norm(samples.curious.hybrid, "LinkedIn").applyUrl).toContain("linkedin.com/jobs/view");
  });

  it("the changing trackingId never becomes the job ID (it would create duplicates every run)", () => {
    const a = norm({ ...(samples.curious.hybrid as RawJob), trackingId: "run-1" }, "LinkedIn");
    const b = norm({ ...(samples.curious.hybrid as RawJob), trackingId: "run-2" }, "LinkedIn");
    expect(a.externalId).toBe(b.externalId);
  });

  it("a '(Remote)' title makes it fully remote", () => {
    expect(norm(samples.curious.remote, "LinkedIn")).toMatchObject({ officeRequirement: "Fully remote", locationOk: true });
  });

  it("a city outside the approved list is not OK", () => {
    expect(norm(samples.curious.farCity, "LinkedIn")).toMatchObject({ city: null, locationOk: false });
  });

  it("valig: 'workType' is the industry, so it must not be read as the work arrangement", () => {
    const raw = samples.valig.herzliya as RawJob;
    expect(typeof raw.workType).toBe("string"); // e.g. "Software Development"
    expect(norm(raw, "LinkedIn")).toMatchObject({ city: "Herzliya", officeRequirement: "Unknown", locationOk: true });
    const trap = norm({ ...raw, workType: "Office Furniture Manufacturing" }, "LinkedIn");
    expect(trap.officeRequirement).toBe("Unknown"); // would be "Daily office" if the industry were read as a work type
  });

  it("both LinkedIn actors give the same job the same ID, so they merge", () => {
    const a = norm(samples.valig.herzliya, "LinkedIn");
    const b = norm({ ...(samples.valig.herzliya as RawJob), id: undefined }, "LinkedIn"); // ID from the URL only
    expect(a.externalId).toBe(b.externalId);
    expect(dedupe([a, b]).unique).toHaveLength(1);
  });
});

describe("Drushim (blackfalcondata)", () => {
  it("Hebrew city, ID from the portal link", () => {
    const raw = samples.blackfalcon.ashdod as RawJob;
    const job = norm(raw, "Drushim");
    expect(job).toMatchObject({ city: "Ashdod", locationOk: true, source: "Drushim" });
    expect(job.externalId).toBe(`Drushim:${raw.jobCode}`);
  });

  it("the actor's own prefixed ID ('drushim-123') agrees with the plain ID from the link", () => {
    const raw = samples.blackfalcon.ashdod as RawJob;
    expect(String(raw.jobId)).toMatch(/^drushim-\d+$/);
    const withoutUrls = norm({ ...raw, portalUrl: undefined, applyUrl: undefined }, "Drushim");
    expect(withoutUrls.externalId).toBe(norm(raw, "Drushim").externalId);
  });

  it("a confidential company ('- חסוי -') is tidied", () => {
    expect(norm(samples.blackfalcon.confidential, "Drushim").company).toBe("חסוי");
  });

  it("isHybrid + Jerusalem (not approved) is not OK; part-time Remote scope is fully remote", () => {
    expect(norm(samples.blackfalcon.hybridJerusalem, "Drushim")).toMatchObject({ officeRequirement: "Hybrid", locationOk: false });
    expect(norm(samples.blackfalcon.partTimeRemote, "Drushim")).toMatchObject({ officeRequirement: "Fully remote", locationOk: true });
  });

  it("expired jobs are dropped", () => {
    expect(normalizeJob({ ...(samples.blackfalcon.ashdod as RawJob), isExpired: true }, { source: "Drushim", cities: CITIES })).toBeNull();
  });
});

describe("Drushim (swerve)", () => {
  it("a job in several cities fits when any of them is approved; 'היברידי' scope → Hybrid", () => {
    const job = norm(samples.swerve.multiCityHybrid, "Drushim");
    expect(job).toMatchObject({ officeRequirement: "Hybrid", locationOk: true });
    expect(job.city).not.toBeNull();
    expect(job.location).toContain(" / "); // all cities kept for display
  });

  it("requirements are added to the description (the matcher needs them)", () => {
    const raw = samples.swerve.multiCityHybrid as RawJob;
    const job = norm(raw, "Drushim");
    expect(job.description).toContain("Requirements:");
    // the normalizer tidies whitespace (tabs, line breaks), so compare in the same form
    expect(job.description).toContain(cleanText(String(raw.requirements)).slice(0, 30));
  });

  it("ID comes from the job link; title from jobTitle; ISO date without timezone is understood", () => {
    const raw = samples.swerve.multiCityHybrid as RawJob;
    const job = norm(raw, "Drushim");
    expect(job.externalId).toBe(`Drushim:${raw.jobCode}`);
    expect(job.title).toBe(raw.jobTitle);
    expect(job.postedDate).toBe(String(raw.postedAt).slice(0, 10));
  });

  it("'מנהל.ת מוצר' (dot spelling) is a target role; Ramat HaSharon is not an approved city", () => {
    const job = norm(samples.swerve.elbit, "Drushim");
    expect(isTargetRole(job.title)).toBe(true);
    expect(job.locationOk).toBe(false);
  });

  it("an employer's repost (same text, new ID) collapses to the newer posting", () => {
    const [older, newer] = (samples.swerve.flexRepost as RawJob[]).slice().sort((a, b) => String(a.postedAt).localeCompare(String(b.postedAt)));
    const { unique, merged } = dedupe(samples.swerve.flexRepost.map((r) => norm(r, "Drushim")));
    expect(unique).toHaveLength(1);
    expect(unique[0].externalId).toBe(`Drushim:${newer.jobCode}`);
    expect(merged[0].dropped).toEqual([`Drushim:${older.jobCode}`]);
  });

  it("two openings with the same title but different text stay separate", () => {
    const { unique } = dedupe(samples.swerve.sameTitleDifferentJobs.map((r) => norm(r, "Drushim")));
    expect(unique).toHaveLength(2);
  });
});
