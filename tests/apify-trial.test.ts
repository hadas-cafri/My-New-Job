import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { TRIALS, coverage, describeInputSchema, pick, pricePerResult, withRetry } from "../scripts/apify-trial.mjs";

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

  describe("withRetry (transient 502s seen in the real trial)", () => {
    const transient = () => Object.assign(new Error("502 upstream request failed"), { transient: true });
    const noWait = { sleep: async () => {} };

    it("retries transient errors and then succeeds", async () => {
      let calls = 0;
      const result = await withRetry(async () => {
        if (++calls < 3) throw transient();
        return "ok";
      }, noWait);
      expect(result).toBe("ok");
      expect(calls).toBe(3);
    });

    it("gives up after the retry limit and surfaces the error", async () => {
      let calls = 0;
      await expect(withRetry(async () => { calls++; throw transient(); }, { ...noWait, retries: 2 })).rejects.toThrow("502");
      expect(calls).toBe(3); // first try + 2 retries
    });

    it("does NOT retry real errors (bad token, bad input): that would just repeat a paid mistake", async () => {
      let calls = 0;
      await expect(withRetry(async () => { calls++; throw new Error("401 unauthorized"); }, noWait)).rejects.toThrow("401");
      expect(calls).toBe(1);
    });

    it("waits longer between attempts", async () => {
      const waits: number[] = [];
      let calls = 0;
      await withRetry(async () => { if (++calls < 3) throw transient(); }, { sleep: async (ms: number) => void waits.push(ms), delayMs: 2000 });
      expect(waits).toEqual([2000, 4000]);
    });
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
