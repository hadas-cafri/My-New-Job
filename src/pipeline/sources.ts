import type { SourceConfig } from "./run";
import { NOT_FIT_TITLE } from "./triage";

export type Lookback = "week" | "day";

/**
 * Title words LinkedIn jobs are dropped for AT THE SOURCE (valig `titleExclude`): the same words that make
 * triage.ts say "not fit", one word each. Dropped jobs are never collected, so they cannot be shown later.
 * Left out on purpose: multi-word phrases (the actor matches all words of a phrase anywhere in the title)
 * and very short tokens that could sit inside an ordinary word ("iam", "uas").
 */
const RISKY_AT_SOURCE = new Set(["iam", "uas", "pre sales"]);
export const SOURCE_TITLE_EXCLUDE: string[] = NOT_FIT_TITLE.filter((w) => !RISKY_AT_SOURCE.has(w) && !w.includes(" "));

/** How many days back the LinkedIn searches look; also the window in which a missing job may be closed. */
export const lookbackDays = (l: Lookback): number => (l === "day" ? 1 : 7);

/**
 * What the scheduled run collects, using the actors chosen after the 2026-11-15 trial
 * (spec §3): valig for LinkedIn, blackfalcondata for Drushim. Inputs follow their real schemas.
 *
 *  - Weekly lookback is the default so that a job posted a few days ago is seen again on every run
 *    (that is how "still listed" is told apart from "gone").
 *  - `limit` caps every search (used for cheap dry runs).
 *  - LinkedIn is searched for Israel only. Fully remote jobs based abroad are not covered yet.
 *  - COST: Apify charges per result (LinkedIn/valig ~$0.0004, Drushim/blackfalcondata ~$0.002 plus
 *    ~$0.01 per search start). With these caps a full run costs at most about $0.4 (mostly Drushim);
 *    real runs return fewer results than the caps. Check Apify's usage page after the first days.
 */
export function buildSources(opts: { lookback?: Lookback; limit?: number } = {}): SourceConfig[] {
  const lookback = opts.lookback ?? "week";
  const cap = (n: number) => (opts.limit ? Math.min(n, opts.limit) : n);
  const datePosted = lookback === "day" ? "r86400" : "r604800";

  const linkedin = (key: string, keywords: string, limit: number): SourceConfig => ({
    key,
    source: "LinkedIn",
    actor: "valig/linkedin-jobs-scraper",
    input: { keywords, location: "Israel", datePosted, limit: cap(limit), titleExclude: SOURCE_TITLE_EXCLUDE },
  });
  const drushim = (key: string, query: string, maxResults: number): SourceConfig => ({
    key,
    source: "Drushim",
    actor: "blackfalcondata/drushim-scraper",
    input: { query, maxResults: cap(maxResults), includeDetails: true },
  });

  return [
    linkedin("linkedin-product-manager", "Product Manager", 100),
    linkedin("linkedin-solutions-architect", "Solutions Architect", 40),
    linkedin("linkedin-solution-specialist", "Solution Specialist", 20),
    drushim("drushim-product-manager", "Product Manager", 60),
    drushim("drushim-product-manager-he", "מנהל מוצר", 60),
    drushim("drushim-solution-architect", "Solution Architect", 30),
  ];
}
