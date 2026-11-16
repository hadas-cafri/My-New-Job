import type { CvVersion } from "./match";
import { DEFAULT_TARGET_ROLES, parseRoleList } from "./roles";
import { TRANSIENT_STATUS, TransientError, withRetry } from "./retry";
import type { ExistingJob, PipelineConfig, RunLog, Store } from "./run";
import type { OfficeRequirement, Source } from "./types";

const API = "https://api.airtable.com/v0";

/** Table IDs of the `My New Job` base. */
export const TABLES = {
  jobs: "tblyQ1DaQW5A7wJbA",
  companies: "tblIzKMbEr97WAQyt",
  cvVersions: "tblIY5UH7RhaVIIPV",
  approvedCities: "tbl99NnAU7iprKvuD",
  profile: "tblItOoWrtBF129Up",
  runs: "tbl1XLNDdhw59JghV",
} as const;

type Rec = { id: string; fields: Record<string, unknown> };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const SOURCES: Source[] = ["LinkedIn", "Drushim", "Company site"];
const OFFICE: OfficeRequirement[] = ["Daily office", "Hybrid", "Fully remote", "Unknown"];

/**
 * Reads the run's settings from Airtable and writes its results back, using a personal access
 * token with read + write on the base (this one runs in GitHub Actions; the dashboard has its own).
 * Airtable allows 10 records per write and about 5 requests per second, so writes are batched and
 * spaced out, and rate-limit / server errors are retried.
 */
export function createAirtableStore(opts: {
  token: string;
  baseId: string;
  fetchImpl?: typeof fetch;
  /** Pause between write batches. Default 250 ms (Airtable's limit is ~5 requests/second). */
  writeGapMs?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Store {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retry = { retries: 3, delayMs: opts.retryDelayMs ?? 5000, sleep };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    return withRetry(async () => {
      let res: Response;
      try {
        res = await doFetch(`${API}/${opts.baseId}/${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
        });
      } catch (e) {
        throw new TransientError(`Airtable ${init.method ?? "GET"} ${path.split("?")[0]} -> network error`);
      }
      if (!res.ok) {
        const msg = `Airtable ${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status}`;
        throw TRANSIENT_STATUS.has(res.status) ? new TransientError(msg) : new Error(msg);
      }
      return (await res.json()) as T;
    }, retry);
  }

  async function listAll(table: string, fields: string[] = []): Promise<Rec[]> {
    const out: Rec[] = [];
    let offset: string | undefined;
    do {
      const q = new URLSearchParams();
      for (const f of fields) q.append("fields[]", f);
      if (offset) q.set("offset", offset);
      const page = await call<{ records: Rec[]; offset?: string }>(`${table}${q.size ? `?${q}` : ""}`);
      out.push(...page.records);
      offset = page.offset;
    } while (offset);
    return out;
  }

  /** Writes in batches of 10; fields use select-option NAMES, and `typecast` creates options not seen before (e.g. a new Domain). */
  async function writeBatches<T>(items: T[], send: (batch: T[]) => Promise<void>) {
    for (let i = 0; i < items.length; i += 10) {
      if (i > 0) await sleep(opts.writeGapMs ?? 250);
      await send(items.slice(i, i + 10));
    }
  }

  return {
    async loadConfig(): Promise<PipelineConfig> {
      const [cityRows, companyRows, profileRows, cvRows] = await Promise.all([
        listAll(TABLES.approvedCities),
        listAll(TABLES.companies),
        listAll(TABLES.profile),
        listAll(TABLES.cvVersions),
      ]);
      const setting = (name: string) => profileRows.find((r) => str(r.fields["Setting"]).toLowerCase() === name.toLowerCase());
      const roles = parseRoleList(str(setting("Target roles")?.fields["Value"]));
      const blocklist = parseRoleList(str((setting("Blocklist") ?? setting("Blocklist keywords"))?.fields["Value"]));

      return {
        cities: cityRows
          .filter((r) => str(r.fields["City"]))
          .map((r) => ({ city: str(r.fields["City"]), hebrewName: str(r.fields["Hebrew Name"]) || undefined, active: r.fields["Active"] === true })),
        favoriteCompanies: companyRows.filter((r) => r.fields["Favorite"] === true).map((r) => str(r.fields["Name"])).filter(Boolean),
        roles: roles.length ? roles : DEFAULT_TARGET_ROLES,
        blocklist,
        cvs: cvRows
          .filter((r) => r.fields["Active"] === true && str(r.fields["Full Text"]))
          .map((r): CvVersion => ({ name: str(r.fields["Name"]), emphasis: str(r.fields["Emphasis"]), fullText: str(r.fields["Full Text"]) })),
      };
    },

    async loadExistingJobs(): Promise<ExistingJob[]> {
      const rows = await listAll(TABLES.jobs, [
        "External ID", "Status", "Last Seen", "Posted Date", "Match %", "Title", "Company", "Location", "Location OK", "Office Requirement", "Source",
      ]);
      return rows
        .filter((r) => str(r.fields["External ID"]))
        .map((r) => {
          const f = r.fields;
          const source = SOURCES.find((s) => s === f["Source"]) ?? null;
          const office = OFFICE.find((o) => o === f["Office Requirement"]) ?? "Unknown";
          return {
            recordId: r.id,
            externalId: str(f["External ID"]),
            source,
            status: str(f["Status"]) || "New",
            lastSeen: str(f["Last Seen"]) || null,
            postedDate: str(f["Posted Date"]) || null,
            locationOk: f["Location OK"] === true,
            match: typeof f["Match %"] === "number" ? (f["Match %"] as number) : null,
            title: str(f["Title"]),
            company: str(f["Company"]),
            location: str(f["Location"]),
            officeRequirement: office,
          };
        });
    },

    createJobs: (rows) =>
      writeBatches(rows, (batch) =>
        call(TABLES.jobs, { method: "POST", body: JSON.stringify({ records: batch.map((fields) => ({ fields })), typecast: true }) }).then(() => undefined),
      ),

    updateJobs: (rows) =>
      writeBatches(rows, (batch) =>
        call(TABLES.jobs, { method: "PATCH", body: JSON.stringify({ records: batch, typecast: true }) }).then(() => undefined),
      ),

    async logRun(e: RunLog) {
      const fields: Record<string, unknown> = {
        "Started At": e.startedAt,
        Source: e.source,
        Status: e.status,
        "New Jobs": e.newJobs,
        "Updated Jobs": e.updatedJobs,
        "Closed Jobs": e.closedJobs,
      };
      if (e.errors) fields["Errors"] = e.errors;
      await call(TABLES.runs, { method: "POST", body: JSON.stringify({ records: [{ fields }], typecast: true }) });
    },
  };
}
