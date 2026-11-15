import { toAirtableFields } from "./airtable-fields";
import { dedupe, fingerprint } from "./dedupe";
import { matchCity } from "./location";
import { MatchError, matchJob, shouldMatch, toMatchFields, type Complete, type CvVersion } from "./match";
import { normalizeAll } from "./normalize";
import { isTargetRole } from "./roles";
import type { ApprovedCity, NormalizedJob, OfficeRequirement, RawJob, Source } from "./types";

/** What to collect from where. `actor` + `input` are passed to Apify as they are. */
export type SourceConfig = { key: string; source: Source; actor: string; input: Record<string, unknown> };

/** Fetches the raw items for one source (Apify in production, a fake in tests). */
export type Collector = (cfg: SourceConfig) => Promise<RawJob[]>;

/** A job already stored in Airtable (only what the run needs). */
export type ExistingJob = {
  recordId: string;
  externalId: string;
  source: Source | null;
  status: string;
  lastSeen: string | null;
  postedDate: string | null;
  /** Fraction 0..1, null when never scored. */
  match: number | null;
  title: string;
  company: string;
  location: string;
  officeRequirement: OfficeRequirement;
};

export type PipelineConfig = {
  cities: ApprovedCity[];
  favoriteCompanies: string[];
  roles: string[];
  blocklist: string[];
  cvs: CvVersion[];
};

export type RunLog = {
  startedAt: string;
  source: "LinkedIn" | "Drushim" | "Company sites" | "All";
  status: "Success" | "Partial" | "Failed";
  newJobs: number;
  updatedJobs: number;
  closedJobs: number;
  errors: string;
};

/** Where the run reads its settings from and writes its results to (Airtable in production). */
export type Store = {
  loadConfig(): Promise<PipelineConfig>;
  loadExistingJobs(): Promise<ExistingJob[]>;
  createJobs(rows: Record<string, unknown>[]): Promise<void>;
  updateJobs(rows: { id: string; fields: Record<string, unknown> }[]): Promise<void>;
  logRun(entry: RunLog): Promise<void>;
};

export type RunOptions = {
  /** YYYY-MM-DD in Israel time. */
  today: string;
  now: Date;
  /** Collect, normalize and plan, but write nothing (no jobs, no Runs rows). */
  dryRun?: boolean;
  /** A New/Saved job not seen for more than this many days is marked Closed. Default 3. */
  closeAfterDays?: number;
  /**
   * How far back the searches look (days). A job can only be closed for going missing if it was
   * posted inside this window: an older job would be missing from the results even if still open.
   * Default 7 (the weekly search window).
   */
  lookbackDays?: number;
  /** Cap on model calls per run (cost control). Default 60. */
  maxMatches?: number;
};

export type SourceStat = { key: string; source: Source; fetched: number; normalized: number; relevant: number; error: string | null };

export type RunReport = {
  startedAt: string;
  dryRun: boolean;
  sources: SourceStat[];
  /** Relevant jobs after the role filter, before dedupe. */
  relevant: number;
  unique: number;
  created: number;
  updated: number;
  closed: number;
  matched: number;
  /** Jobs that should have been scored but were not (no model, budget used up, or a model error). */
  matchSkipped: number;
  errors: string[];
  /** A few of the new jobs, for the dry-run printout. */
  sample: { title: string; company: string; location: string; officeRequirement: string; locationOk: boolean; source: string }[];
};

export type Deps = { sources: SourceConfig[]; collect: Collector; store: Store; complete?: Complete };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

function shiftDate(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Only these are closed automatically: anything the user acted on (Applied, Interview, ...) is left alone. */
const AUTO_CLOSABLE = new Set(["New", "Saved"]);

const runsSource = (s: Source | null): RunLog["source"] | null =>
  s === "LinkedIn" ? "LinkedIn" : s === "Drushim" ? "Drushim" : s === "Company site" ? "Company sites" : null;

/**
 * One full run: collect → normalize → keep target roles → dedupe → compare with Airtable →
 * score new jobs → create / refresh / close → log.
 *
 * Safety rules:
 *  - a source that failed, or returned nothing, never causes its jobs to be closed;
 *  - a job already stored from another source is not created a second time;
 *  - existing rows only get `Last Seen` refreshed (never status, notes or dates the user set);
 *  - the model is optional: without it jobs are created unscored and scored on a later run.
 */
export async function runPipeline(deps: Deps, opts: RunOptions): Promise<RunReport> {
  const { sources, collect, store, complete } = deps;
  const { today, now, dryRun = false, closeAfterDays = 3, lookbackDays = 7, maxMatches = 60 } = opts;
  const cfg = await store.loadConfig();
  const existing = await store.loadExistingJobs();
  const byExternalId = new Map(existing.map((e) => [e.externalId, e]));

  const report: RunReport = {
    startedAt: now.toISOString(),
    dryRun,
    sources: [],
    relevant: 0,
    unique: 0,
    created: 0,
    updated: 0,
    closed: 0,
    matched: 0,
    matchSkipped: 0,
    errors: [],
    sample: [],
  };

  // 1) collect + normalize + role filter, one source at a time (a failure in one does not stop the others)
  const batch: NormalizedJob[] = [];
  for (const s of sources) {
    const stat: SourceStat = { key: s.key, source: s.source, fetched: 0, normalized: 0, relevant: 0, error: null };
    try {
      const raw = await collect(s);
      stat.fetched = raw.length;
      const jobs = normalizeAll(raw, { source: s.source, cities: cfg.cities, favoriteCompanies: cfg.favoriteCompanies, now });
      stat.normalized = jobs.length;
      const relevant = jobs.filter((j) => isTargetRole(j.title, cfg.roles, cfg.blocklist));
      stat.relevant = relevant.length;
      batch.push(...relevant);
    } catch (e) {
      stat.error = errorText(e);
      report.errors.push(`${s.key}: ${stat.error}`);
    }
    report.sources.push(stat);
  }
  report.relevant = batch.length;

  // A source is healthy when none of its searches failed and it returned something. Only a healthy
  // source can "lose" jobs: an outage or an empty answer must never close anything.
  const healthy = new Set<Source>();
  for (const src of new Set(report.sources.map((x) => x.source))) {
    const stats = report.sources.filter((x) => x.source === src);
    if (stats.every((x) => !x.error) && stats.some((x) => x.fetched > 0)) healthy.add(src);
  }

  // 2) dedupe inside the batch, then against what Airtable already holds
  const { unique } = dedupe(batch);
  report.unique = unique.length;

  const existingByFingerprint = new Map<string, ExistingJob[]>();
  for (const e of existing) {
    const city = matchCity(e.location, cfg.cities)?.city ?? null;
    const fp = fingerprint({ company: e.company, title: e.title, location: e.location, city, officeRequirement: e.officeRequirement } as NormalizedJob);
    existingByFingerprint.set(fp, [...(existingByFingerprint.get(fp) ?? []), e]);
  }

  const claimed = new Set<string>(); // Airtable rows matched by a job in this run
  const fresh: NormalizedJob[] = [];
  const seen: { job: NormalizedJob; row: ExistingJob }[] = [];
  for (const job of unique) {
    let row = byExternalId.get(job.externalId);
    if (!row) {
      // the same job stored earlier from ANOTHER source (cross-source duplicate across runs)
      row = (existingByFingerprint.get(fingerprint(job)) ?? []).find((e) => e.source !== job.source && !claimed.has(e.recordId));
    }
    if (row) {
      claimed.add(row.recordId);
      seen.push({ job, row });
    } else {
      fresh.push(job);
    }
  }

  // 3) score: new jobs, and jobs seen again that were never scored (e.g. created before a key existed)
  const scored = new Map<string, Record<string, unknown>>();
  const candidates = [...fresh, ...seen.filter((s) => s.row.match === null).map((s) => s.job)].filter((j) =>
    shouldMatch(j, { roles: cfg.roles, blocklist: cfg.blocklist }),
  );
  if (complete && cfg.cvs.length > 0) {
    for (const job of candidates.slice(0, maxMatches)) {
      try {
        scored.set(job.externalId, toMatchFields(await matchJob(job, cfg.cvs, complete)));
      } catch (e) {
        report.errors.push(`match ${job.externalId}: ${errorText(e)}`);
        if (!(e instanceof MatchError)) break; // network / key / quota problem: stop instead of failing every job
      }
    }
  }
  report.matched = scored.size;
  report.matchSkipped = candidates.length - scored.size;

  // 4) jobs that disappeared: close New/Saved ones, only for sources that answered normally
  const cutoff = shiftDate(today, -closeAfterDays);
  const windowStart = shiftDate(today, -lookbackDays);
  const toClose = existing.filter(
    (e) =>
      !claimed.has(e.recordId) &&
      e.source !== null &&
      healthy.has(e.source) &&
      AUTO_CLOSABLE.has(e.status) &&
      e.lastSeen !== null &&
      e.lastSeen < cutoff &&
      e.postedDate !== null &&
      e.postedDate >= windowStart, // posted inside the search window, so it should still be listed if open
  );

  report.created = fresh.length;
  report.updated = seen.length;
  report.closed = toClose.length;
  report.sample = fresh.slice(0, 5).map((j) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    officeRequirement: j.officeRequirement,
    locationOk: j.locationOk,
    source: j.source,
  }));
  if (dryRun) return report;

  // 5) write
  await store.createJobs(fresh.map((j) => ({ ...toAirtableFields(j, { today, isNew: true }), ...(scored.get(j.externalId) ?? {}) })));
  await store.updateJobs([
    ...seen.map(({ job, row }) => ({
      id: row.recordId,
      fields: {
        "Last Seen": today,
        ...(row.status === "Closed" ? { Status: "New" } : {}), // it is listed again: reopen
        ...(scored.get(job.externalId) ?? {}),
      },
    })),
    ...toClose.map((e) => ({ id: e.recordId, fields: { Status: "Closed" } })),
  ]);

  // 6) log: one row per source (all its searches together) and a summary row
  const startedAt = report.startedAt;
  const failed = report.sources.filter((s) => s.error).length;
  for (const target of new Set(report.sources.map((x) => x.source))) {
    const label = runsSource(target);
    if (!label) continue;
    const stats = report.sources.filter((x) => x.source === target);
    const broken = stats.filter((x) => x.error);
    await store.logRun({
      startedAt,
      source: label,
      status: broken.length === stats.length ? "Failed" : broken.length > 0 ? "Partial" : "Success",
      newJobs: fresh.filter((j) => j.source === target).length,
      updatedJobs: seen.filter((s) => s.job.source === target).length,
      closedJobs: toClose.filter((e) => e.source === target).length,
      errors: broken.map((x) => `${x.key}: ${x.error}`).join("\n"),
    });
  }
  await store.logRun({
    startedAt,
    source: "All",
    status: failed === report.sources.length && failed > 0 ? "Failed" : report.errors.length > 0 ? "Partial" : "Success",
    newJobs: report.created,
    updatedJobs: report.updated,
    closedJobs: report.closed,
    errors: report.errors.join("\n").slice(0, 5000),
  });
  return report;
}
