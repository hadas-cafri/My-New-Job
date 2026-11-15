import { STATUSES, type Job, type JobPatch, type Status } from "./types";

const DEFAULT_API = "https://api.airtable.com/v0";
export const DEFAULT_BASE_ID = "appAnHmtOjUfgQAcA";
export const JOBS_TABLE_ID = "tblyQ1DaQW5A7wJbA";

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

export function patchToFields(patch: JobPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (patch.status !== undefined) fields["Status"] = patch.status;
  if (patch.notes !== undefined) fields["Notes"] = patch.notes;
  if (patch.appliedDate !== undefined) fields["Applied Date"] = patch.appliedDate;
  return fields;
}

export function createClient(
  token: string,
  opts: { baseId?: string; fetchImpl?: typeof fetch } = {},
) {
  const baseId = opts.baseId ?? process.env.AIRTABLE_BASE_ID ?? DEFAULT_BASE_ID;
  const doFetch = opts.fetchImpl ?? fetch;
  // AIRTABLE_API_URL is only for local end-to-end tests against a fake server.
  const api = process.env.AIRTABLE_API_URL ?? DEFAULT_API;
  const url = (query = "") => `${api}/${baseId}/${JOBS_TABLE_ID}${query}`;

  async function call(input: string, init: RequestInit = {}) {
    const res = await doFetch(input, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new AirtableError(res.status, `Airtable responded ${res.status}`);
    }
    return res.json() as Promise<{ records?: AirtableRecord[]; offset?: string } & AirtableRecord>;
  }

  return {
    /** Cheap connection check used when a token is entered in settings. */
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
