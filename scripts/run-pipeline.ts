/**
 * Runs the whole pipeline once: Apify → normalize → dedupe → score → Airtable.
 *
 *   npm run pipeline                         # a real run: writes to Airtable
 *   npm run pipeline -- --dry-run            # collects and plans, writes nothing
 *   npm run pipeline -- --dry-run --limit 8  # cheap trial (8 results per search)
 *   npm run pipeline -- --lookback day       # only jobs posted in the last 24 hours
 *   npm run pipeline -- --only drushim       # only searches whose key contains "drushim"
 *   npm run pipeline -- --dry-run --offline-config local/offline.json   # settings from a file instead of Airtable
 *
 * Environment: APIFY_TOKEN (required), AIRTABLE_TOKEN (required unless --offline-config),
 * AIRTABLE_BASE_ID (optional), ANTHROPIC_API_KEY (optional: without it jobs are stored unscored),
 * MATCH_MODEL (optional).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createAirtableStore } from "../src/pipeline/airtable-store";
import { createAnthropicComplete } from "../src/pipeline/anthropic";
import { createApifyCollector } from "../src/pipeline/apify";
import { runPipeline, type PipelineConfig, type RunReport, type Store } from "../src/pipeline/run";
import { buildSources, lookbackDays, type Lookback } from "../src/pipeline/sources";
import { israelToday } from "../src/pipeline/time";

type OfflineConfig = Partial<PipelineConfig> & { existing?: Awaited<ReturnType<Store["loadExistingJobs"]>> };

/** Settings read from a JSON file; writing is refused (dry runs only). */
function offlineStore(path: string): Store {
  const file = JSON.parse(readFileSync(path, "utf8")) as OfflineConfig;
  const refuse = () => Promise.reject(new Error("offline settings are read-only: use --dry-run"));
  return {
    loadConfig: async () => ({
      cities: file.cities ?? [],
      favoriteCompanies: file.favoriteCompanies ?? [],
      roles: file.roles ?? ["Product Manager", "Solution Architect", "Solution Specialist"],
      blocklist: file.blocklist ?? [],
      cvs: file.cvs ?? [],
    }),
    loadExistingJobs: async () => file.existing ?? [],
    createJobs: refuse,
    updateJobs: refuse,
    logRun: refuse,
  };
}

function printReport(r: RunReport) {
  console.log(`\n${r.dryRun ? "DRY RUN (nothing written)" : "Run finished"}  ${r.startedAt}`);
  for (const s of r.sources) {
    console.log(`  ${s.error ? "✗" : "✓"} ${s.key.padEnd(30)} fetched ${String(s.fetched).padStart(3)}  usable ${String(s.normalized).padStart(3)}  target roles ${String(s.relevant).padStart(3)}${s.capped ? "  (result cap reached: more jobs exist)" : ""}${s.error ? `  ERROR ${s.error}` : ""}`);
  }
  console.log(`\n  target-role jobs ${r.relevant} → after dedupe ${r.unique}`);
  console.log(`  new ${r.created} | already stored (Last Seen refreshed) ${r.updated} | closed ${r.closed}`);
  console.log(`  scored ${r.matched} | waiting to be scored ${r.matchSkipped}`);
  if (r.sample.length) {
    console.log("\n  new jobs (sample):");
    for (const j of r.sample) console.log(`   - ${j.title.slice(0, 50)} @ ${j.company.slice(0, 24)} | ${j.location.slice(0, 40)} | ${j.officeRequirement} | location ${j.locationOk ? "OK" : "no"} | ${j.source}`);
  }
  if (r.errors.length) {
    console.log("\n  problems:");
    for (const e of r.errors) console.log(`   - ${e}`);
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean" },
      lookback: { type: "string" },
      limit: { type: "string" },
      only: { type: "string" },
      "offline-config": { type: "string" },
      "max-matches": { type: "string" },
    },
  });
  const now = new Date();

  const lookback = (values.lookback ?? "week") as Lookback;
  if (lookback !== "week" && lookback !== "day") {
    console.error('--lookback must be "week" or "day"');
    return 2;
  }
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    console.error("APIFY_TOKEN is not set.");
    return 2;
  }

  let store: Store;
  if (values["offline-config"]) {
    store = offlineStore(values["offline-config"]);
  } else {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) {
      console.error("AIRTABLE_TOKEN is not set (or use --offline-config with --dry-run).");
      return 2;
    }
    store = createAirtableStore({ token, baseId: process.env.AIRTABLE_BASE_ID ?? "appAnHmtOjUfgQAcA" });
  }
  const dryRun = values["dry-run"] === true;
  if (values["offline-config"] && !dryRun) {
    console.error("--offline-config can only be used with --dry-run.");
    return 2;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) console.log("ANTHROPIC_API_KEY is not set: jobs will be stored without a match score.");

  const only = values.only?.toLowerCase();
  const sources = buildSources({ lookback, limit: values.limit ? Number(values.limit) : undefined }).filter(
    (s) => !only || s.key.toLowerCase().includes(only),
  );
  if (sources.length === 0) {
    console.error(`No search matches --only ${values.only}`);
    return 2;
  }

  const report = await runPipeline(
    {
      sources,
      collect: createApifyCollector({ token: apifyToken }),
      store,
      complete: apiKey ? createAnthropicComplete({ apiKey, model: process.env.MATCH_MODEL }) : undefined,
    },
    { today: israelToday(now), now, dryRun, lookbackDays: lookbackDays(lookback), maxMatches: values["max-matches"] ? Number(values["max-matches"]) : undefined },
  );
  printReport(report);
  return report.sources.every((s) => s.error) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(`Run aborted: ${e.message}`);
    process.exit(1);
  },
);
