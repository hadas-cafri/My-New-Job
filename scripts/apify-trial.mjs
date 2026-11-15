#!/usr/bin/env node
/**
 * Apify trial: runs each candidate actor with a tiny limit and reports
 * count, cost, duration and field coverage, so we can pick one actor per source.
 *
 * Usage:
 *   APIFY_TOKEN=... node scripts/apify-trial.mjs            # run all trials
 *   APIFY_TOKEN=... node scripts/apify-trial.mjs --schema   # print each actor's input schema
 *   APIFY_TOKEN=... node scripts/apify-trial.mjs linkedin   # run only matching trials
 *
 * The token is read from the environment only. Output goes to trial-results/ (git-ignored).
 *
 * NOTE: the `input` objects below are best guesses. Run with --schema first and
 * adjust them to each actor's real input schema before the full trial.
 */
import { mkdir, writeFile } from "node:fs/promises";

const TOKEN = process.env.APIFY_TOKEN;
const API = "https://api.apify.com/v2";
const LIMIT = 15; // jobs per actor: keeps the trial to a few cents

const LINKEDIN_URL =
  "https://www.linkedin.com/jobs/search/?keywords=Senior%20Product%20Manager&location=Israel&f_TPR=r604800";

export const TRIALS = [
  {
    key: "linkedin-curious",
    source: "LinkedIn",
    actor: "curious_coder/linkedin-jobs-scraper",
    input: { urls: [LINKEDIN_URL], count: LIMIT },
  },
  {
    key: "linkedin-valig",
    source: "LinkedIn",
    actor: "valig/linkedin-jobs-scraper",
    input: { searchUrl: LINKEDIN_URL, maxItems: LIMIT },
  },
  {
    key: "drushim-blackfalcon",
    source: "Drushim",
    actor: "blackfalcondata/drushim-scraper",
    input: { searchQuery: "Product Manager", maxItems: LIMIT },
  },
  {
    key: "drushim-swerve",
    source: "Drushim",
    actor: "swerve/drushim-scraper",
    input: { query: "Product Manager", maxItems: LIMIT },
  },
];

/** Fields we need per job (spec §2) and the key names actors commonly use for them. */
const WANTED = {
  title: ["title", "jobTitle", "position", "name"],
  company: ["company", "companyName", "employer"],
  location: ["location", "city", "jobLocation"],
  description: ["description", "descriptionText", "jobDescription", "descriptionHtml"],
  applyUrl: ["applyUrl", "applyLink", "url", "link", "jobUrl"],
  postedDate: ["postedAt", "postedDate", "publishedAt", "datePosted", "listedAt", "date"],
};

export function pick(item, names) {
  for (const n of names) {
    const v = item?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

export function coverage(items) {
  const out = {};
  for (const field of Object.keys(WANTED)) {
    const have = items.filter((it) => pick(it, WANTED[field]) !== undefined).length;
    out[field] = items.length ? Math.round((have / items.length) * 100) : 0;
  }
  return out;
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  return res.json();
}

const actorPath = (actor) => encodeURIComponent(actor.replace("/", "~"));

async function printSchema(t) {
  const { data } = await api(`/acts/${actorPath(t.actor)}`);
  const v = data.defaultRunOptions ? data : data;
  const latest = v.taggedBuilds?.latest ?? null;
  console.log(`\n=== ${t.actor} ===`);
  console.log(`users/month: ${data.stats?.totalUsers30Days ?? "?"}, pricing: ${JSON.stringify(data.pricingInfos?.at(-1) ?? data.pricingModel ?? "?")}`);
  console.log(`latest build: ${latest?.buildId ?? "?"}`);
  console.log(`input schema: ${JSON.stringify(data.exampleRunInput?.body ?? "(see actor page)")}`);
}

async function runTrial(t) {
  const started = Date.now();
  const { data: run } = await api(`/acts/${actorPath(t.actor)}/runs?waitForFinish=120`, {
    method: "POST",
    body: JSON.stringify(t.input),
  });
  let current = run;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(current.status)) {
    if (Date.now() - started > 5 * 60_000) throw new Error("timeout waiting for run");
    current = (await api(`/actor-runs/${run.id}?waitForFinish=60`)).data;
  }
  if (current.status !== "SUCCEEDED") throw new Error(`run ${current.status}`);

  const items = await (
    await fetch(`${API}/datasets/${current.defaultDatasetId}/items?clean=true&limit=${LIMIT * 2}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
  ).json();

  return {
    key: t.key,
    source: t.source,
    actor: t.actor,
    ok: true,
    seconds: Math.round((Date.now() - started) / 1000),
    costUsd: current.usageTotalUsd ?? null,
    items: items.length,
    coverage: coverage(items),
    sample: items.slice(0, 3).map((it) => ({
      title: pick(it, WANTED.title),
      company: pick(it, WANTED.company),
      location: pick(it, WANTED.location),
      applyUrl: pick(it, WANTED.applyUrl),
      postedDate: pick(it, WANTED.postedDate),
    })),
    rawKeys: items[0] ? Object.keys(items[0]) : [],
  };
}

async function main() {
  if (!TOKEN) {
    console.error("APIFY_TOKEN is not set. See .env.example.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith("--"));
  const trials = TRIALS.filter((t) => !filter || t.key.includes(filter));

  if (args.includes("--schema")) {
    for (const t of trials) await printSchema(t).catch((e) => console.error(t.actor, e.message));
    return;
  }

  const results = [];
  for (const t of trials) {
    process.stdout.write(`Running ${t.actor} ... `);
    try {
      const r = await runTrial(t);
      console.log(`${r.items} items, $${r.costUsd ?? "?"}, ${r.seconds}s`);
      results.push(r);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      results.push({ key: t.key, source: t.source, actor: t.actor, ok: false, error: e.message });
    }
  }

  await mkdir("trial-results", { recursive: true });
  const file = `trial-results/apify-${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(file, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${file}`);
  console.table(
    results.map((r) => ({
      actor: r.actor,
      ok: r.ok,
      items: r.items,
      usd: r.costUsd,
      title: r.coverage?.title,
      company: r.coverage?.company,
      location: r.coverage?.location,
      desc: r.coverage?.description,
      apply: r.coverage?.applyUrl,
      posted: r.coverage?.postedDate,
    })),
  );
}

// Run only when executed directly (so tests can import pick/coverage).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
