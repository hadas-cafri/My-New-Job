import { describe, expect, it, vi } from "vitest";
import { AirtableError, createClient, mapRecord, patchToFields } from "@/lib/airtable";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const CONN = { token: "patTOKEN", baseId: "appTESTTESTTEST01", tableId: "tblTESTTESTTEST01" };

describe("mapRecord", () => {
  it("maps Airtable fields and keeps match as a fraction", () => {
    const job = mapRecord({
      id: "recAAAAAAAAAAAAAA",
      fields: {
        Title: "Senior PM",
        Company: "JFrog",
        "Favorite Company": true,
        "Match %": 0.85,
        Status: "Interview",
        "Apply URL": "https://example.com/apply",
      },
    });
    expect(job).toMatchObject({
      title: "Senior PM",
      company: "JFrog",
      favoriteCompany: true,
      match: 0.85,
      status: "Interview",
      applyUrl: "https://example.com/apply",
    });
  });

  it("applies safe defaults for empty records", () => {
    const job = mapRecord({ id: "recBBBBBBBBBBBBBB", fields: {} });
    expect(job.status).toBe("New");
    expect(job.match).toBeNull();
    expect(job.applyUrl).toBeNull();
    expect(job.favoriteCompany).toBe(false);
  });

  it("falls back to New for an unknown status", () => {
    expect(mapRecord({ id: "r", fields: { Status: "Whatever" } }).status).toBe("New");
  });
});

describe("client", () => {
  it("uses the user's base/table IDs and bearer token, and follows pagination", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ records: [{ id: "rec1", fields: { Title: "A" } }], offset: "next1" }))
      .mockResolvedValueOnce(ok({ records: [{ id: "rec2", fields: { Title: "B" } }] }));
    const client = createClient(CONN, { fetchImpl: fetchImpl as never });

    const jobs = await client.listJobs();

    expect(jobs.map((j) => j.title)).toEqual(["A", "B"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url1, init1] = fetchImpl.mock.calls[0];
    expect(url1).toBe(`https://api.airtable.com/v0/${CONN.baseId}/${CONN.tableId}`);
    expect((init1.headers as Record<string, string>).Authorization).toBe("Bearer patTOKEN");
    expect(fetchImpl.mock.calls[1][0]).toContain("offset=next1");
  });

  it("throws AirtableError carrying the HTTP status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
    const client = createClient(CONN, { fetchImpl: fetchImpl as never });
    await expect(client.ping()).rejects.toMatchObject({ status: 403 });
    await expect(client.ping()).rejects.toBeInstanceOf(AirtableError);
  });

  it("reports network failures as status 0", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createClient(CONN, { fetchImpl: fetchImpl as never });
    await expect(client.listJobs()).rejects.toMatchObject({ status: 0 });
  });

  it("updateJob PATCHes only the given fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ id: "rec1", fields: { Status: "Applied" } }));
    const client = createClient(CONN, { fetchImpl: fetchImpl as never });

    const job = await client.updateJob("rec1", { status: "Applied" });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ fields: { Status: "Applied" } });
    expect(job.status).toBe("Applied");
  });
});

describe("write-back is limited to tracking fields", () => {
  it("maps status / notes / appliedDate", () => {
    expect(patchToFields({ status: "Saved", notes: "x", appliedDate: "2026-11-15" })).toEqual({
      Status: "Saved",
      Notes: "x",
      "Applied Date": "2026-11-15",
    });
    expect(patchToFields({ appliedDate: null })).toEqual({ "Applied Date": null });
  });

  it("maps the CV-suggestions request (checkbox) and reads it back", () => {
    expect(patchToFields({ cvSuggestionsRequested: true })).toEqual({ "CV Suggestions Requested": true });
    expect(patchToFields({ cvSuggestionsRequested: false })).toEqual({ "CV Suggestions Requested": false });
    expect(mapRecord({ id: "r", fields: { "CV Suggestions Requested": true } }).cvSuggestionsRequested).toBe(true);
    expect(mapRecord({ id: "r", fields: {} }).cvSuggestionsRequested).toBe(false);
  });

  it("reads the screening (Triage); anything else is treated as not screened", () => {
    expect(mapRecord({ id: "r", fields: { Triage: "Fit" } }).triage).toBe("Fit");
    expect(mapRecord({ id: "r", fields: { Triage: "Not fit" } }).triage).toBe("Not fit");
    expect(mapRecord({ id: "r", fields: { Triage: "Whatever" } }).triage).toBeNull();
    expect(mapRecord({ id: "r", fields: {} }).triage).toBeNull();
    // the dashboard never writes it back
    expect(patchToFields({ triage: "Fit" } as never)).toEqual({});
  });

  it("cannot be coerced into writing other fields", () => {
    const sneaky = { status: "Saved", "Match %": 1, Title: "hack" } as never;
    expect(patchToFields(sneaky)).toEqual({ Status: "Saved" });
  });
});
