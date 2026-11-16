import type { Connection } from "./connection";
import { STATUSES, type Job, type JobPatch, type Status } from "./types";

const API = "https://api.airtable.com/v0";

/** `status` is the HTTP status, or 0 for a network failure (offline, blocked). */
export class AirtableError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type AirtableRecord = { id: string; fields: Record<string, unknown> };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);

export function mapRecord(rec: AirtableRecord): Job {
  const f = rec.fields;
  const status = STATUSES.includes(f["Status"] as Status) ? (f["Status"] as Status) : "New";
  return {
    id: rec.id,
    title: str(f["Title"]),
    company: str(f["Company"]),
    favoriteCompany: f["Favorite Company"] === true,
    location: str(f["Location"]),
    officeRequirement: strOrNull(f["Office Requirement"]),
    locationOk: f["Location OK"] === true,
    description: str(f["Description"]),
    applyUrl: strOrNull(f["Apply URL"]),
    match: typeof f["Match %"] === "number" ? (f["Match %"] as number) : null,
    rationale: str(f["Match Rationale"]),
    skillGaps: str(f["Skill Gaps"]),
    missingKeywords: str(f["Missing ATS Keywords"]),
    cvSuggestions: str(f["CV Suggestions"]),
    cvSuggestionsRequested: f["CV Suggestions Requested"] === true,
    recommendedCv: strOrNull(f["Recommended CV"]),
    domain: strOrNull(f["Domain"]),
    source: strOrNull(f["Source"]),
    language: strOrNull(f["Job Language"]),
    postedDate: strOrNull(f["Posted Date"]),
    firstSeen: strOrNull(f["First Seen"]),
    lastSeen: strOrNull(f["Last Seen"]),
    status,
    appliedDate: strOrNull(f["Applied Date"]),
    notes: str(f["Notes"]),
  };
}

/** The dashboard may write back only these four fields (spec §4). */
export function patchToFields(patch: JobPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (patch.status !== undefined) fields["Status"] = patch.status;
  if (patch.notes !== undefined) fields["Notes"] = patch.notes;
  if (patch.appliedDate !== undefined) fields["Applied Date"] = patch.appliedDate;
  if (patch.cvSuggestionsRequested !== undefined) fields["CV Suggestions Requested"] = patch.cvSuggestionsRequested;
  return fields;
}

/** Talks to Airtable directly from the browser using the token the user entered. */
export function createClient(conn: Connection, opts: { fetchImpl?: typeof fetch } = {}) {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = (query = "") => `${API}/${conn.baseId}/${conn.tableId}${query}`;

  async function call(input: string, init: RequestInit = {}) {
    let res: Response;
    try {
      res = await doFetch(input, {
        ...init,
        headers: {
          Authorization: `Bearer ${conn.token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch {
      throw new AirtableError(0, "Network error");
    }
    if (!res.ok) throw new AirtableError(res.status, `Airtable responded ${res.status}`);
    return res.json() as Promise<{ records?: AirtableRecord[]; offset?: string } & AirtableRecord>;
  }

  return {
    /** Cheap connection check used by the "connect" button. */
    async ping(): Promise<void> {
      await call(url("?maxRecords=1&fields%5B%5D=Title"));
    },

    async listJobs(): Promise<Job[]> {
      const jobs: Job[] = [];
      let offset: string | undefined;
      do {
        const page = await call(url(offset ? `?offset=${encodeURIComponent(offset)}` : ""));
        for (const rec of page.records ?? []) jobs.push(mapRecord(rec));
        offset = page.offset;
      } while (offset);
      return jobs;
    },

    async updateJob(id: string, patch: JobPatch): Promise<Job> {
      const rec = await call(url(`/${encodeURIComponent(id)}`), {
        method: "PATCH",
        body: JSON.stringify({ fields: patchToFields(patch) }),
      });
      return mapRecord(rec);
    },
  };
}
