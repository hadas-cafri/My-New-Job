import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { TRIALS, coverage, pick } from "../scripts/apify-trial.mjs";

describe("apify trial helpers", () => {
  it("pick returns the first non-empty candidate key", () => {
    expect(pick({ jobTitle: "PM", title: "" }, ["title", "jobTitle"])).toBe("PM");
    expect(pick({}, ["title"])).toBeUndefined();
  });

  it("coverage reports percent of items having each field", () => {
    const c = coverage([
      { title: "A", companyName: "X", description: "d" },
      { title: "B" },
    ]);
    expect(c.title).toBe(100);
    expect(c.company).toBe(50);
    expect(c.description).toBe(50);
    expect(c.applyUrl).toBe(0);
  });

  it("coverage of an empty result is all zeros", () => {
    expect(Object.values(coverage([])).every((v) => v === 0)).toBe(true);
  });

  it("covers both required sources with unique keys", () => {
    const sources = new Set(TRIALS.map((t: { source: string }) => t.source));
    expect(sources).toEqual(new Set(["LinkedIn", "Drushim"]));
    const keys = TRIALS.map((t: { key: string }) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
