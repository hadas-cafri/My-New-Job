import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { TRIALS, coverage, describeInputSchema, pick, pricePerResult } from "../scripts/apify-trial.mjs";

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

  it("pricePerResult reads flat and tiered pricing", () => {
    const flat = { pricingPerEvent: { actorChargeEvents: { "apify-default-dataset-item": { eventPriceUsd: 0.002 } } } };
    const tiered = {
      pricingPerEvent: {
        actorChargeEvents: { "apify-default-dataset-item": { eventTieredPricingUsd: { FREE: { tieredEventPriceUsd: 0.0004 } } } },
      },
    };
    expect(pricePerResult(flat)).toBe(0.002);
    expect(pricePerResult(tiered)).toBe(0.0004);
    expect(pricePerResult(undefined)).toBeNull();
  });

  it("describeInputSchema lists fields with required/enum/default and survives a missing schema", () => {
    const lines = describeInputSchema({
      required: ["q"],
      properties: { q: { type: "string", description: "Search  text" }, n: { type: "integer", default: 5 }, s: { type: "string", enum: ["a", "b"] } },
    });
    expect(lines[0]).toBe("- q (required): string | Search text");
    expect(lines[1]).toBe("- n: integer, default 5");
    expect(lines[2]).toBe('- s: string, one of ["a","b"]');
    expect(describeInputSchema(undefined)).toEqual(["(this actor publishes no input schema)"]);
  });

  it("every trial limits its results (cost control)", () => {
    for (const t of TRIALS) {
      const limit = t.input.limitPerSource ?? t.input.limit ?? t.input.maxResults ?? t.input.maxItems;
      expect(limit, t.key).toBeGreaterThan(0);
      expect(limit, t.key).toBeLessThanOrEqual(25);
    }
  });

  it("covers both required sources with unique keys", () => {
    const sources = new Set(TRIALS.map((t: { source: string }) => t.source));
    expect(sources).toEqual(new Set(["LinkedIn", "Drushim"]));
    const keys = TRIALS.map((t: { key: string }) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
