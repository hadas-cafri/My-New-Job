import { describe, expect, it } from "vitest";
import { buildSources, SOURCE_TITLE_EXCLUDE } from "@/pipeline/sources";
import { triageJob } from "@/pipeline/triage";

describe("sources: dropping unwanted titles at the source", () => {
  it("every LinkedIn search carries the title exclusions; Drushim (no such option) does not", () => {
    for (const s of buildSources()) {
      if (s.source === "LinkedIn") expect(s.input.titleExclude, s.key).toEqual(SOURCE_TITLE_EXCLUDE);
      else expect(s.input.titleExclude, s.key).toBeUndefined();
    }
  });

  it("contains the user's rules: principal / staff, technical, cloud, security", () => {
    for (const w of ["principal", "staff", "technical", "engineer", "cloud", "security", "cyber", "aws"]) {
      expect(SOURCE_TITLE_EXCLUDE, w).toContain(w);
    }
  });

  it("leaves out short or multi-word tokens that could drop good jobs", () => {
    for (const w of SOURCE_TITLE_EXCLUDE) {
      expect(w.includes(" "), w).toBe(false);
      expect(w.length, w).toBeGreaterThanOrEqual(3);
    }
    expect(SOURCE_TITLE_EXCLUDE).not.toContain("iam");
    expect(SOURCE_TITLE_EXCLUDE).not.toContain("uas");
  });

  it("every excluded word really makes triage say 'not fit' (the two stay in agreement)", () => {
    for (const w of SOURCE_TITLE_EXCLUDE) {
      expect(triageJob({ title: `Senior ${w} Product Manager`, company: "Acme" }).triage, w).toBe("Not fit");
    }
  });

  it("an ordinary Product Manager title is not excluded", () => {
    const title = "Senior Product Manager, Payments Platform";
    const lower = title.toLowerCase().split(/\W+/);
    expect(SOURCE_TITLE_EXCLUDE.some((w) => lower.includes(w))).toBe(false);
  });

  it("the cap for cheap dry runs still applies", () => {
    for (const s of buildSources({ limit: 8 })) expect(Number(s.input.limit ?? s.input.maxResults)).toBeLessThanOrEqual(8);
  });
});
