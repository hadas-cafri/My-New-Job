import { describe, expect, it, vi } from "vitest";
import { AirtableError, createClient, mapRecord, patchToFields } from "@/lib/airtable";
import { parsePatch } from "@/lib/patch";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

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
  it("sends the bearer token and follows pagination", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ records: [{ id: "rec1", fields: { Title: "A" } }], offset: "next1" }))
      .mockResolvedValueOnce(ok({ records: [{ id: "rec2", fields: { Title: "B" } }] }));
    const client = createClient("patTOKEN", { baseId: "appTEST", fetchImpl: fetchImpl as never });

    const jobs = await client.listJobs();

    expect(jobs.map((j) => j.title)).toEqual(["A", "B"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url1, init1] = fetchImpl.mock.calls[0];
    expect(url1).toContain("/appTEST/");
    expect((init1.headers as Record<string, string>).Authorization).toBe("Bearer patTOKEN");
    expect(fetchImpl.mock.calls[1][0]).toContain("offset=next1");
  });

  it("throws AirtableError with the status on failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const client = createClient("bad", { fetchImpl: fetchImpl as never });
    await expect(client.ping()).rejects.toMatchObject({ status: 401 });
    await expect(client.ping()).rejects.toBeInstanceOf(AirtableError);
  });

  it("updateJob PATCHes only the given fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ id: "rec1", fields: { Status: "Applied" } }));
    const client = createClient("pat", { fetchImpl: fetchImpl as never });

    const job = await client.updateJob("rec1", { status: "Applied" });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ fields: { Status: "Applied" } });
    expect(job.status).toBe("Applied");
  });
});

describe("patch whitelist", () => {
  it("accepts status / notes / appliedDate", () => {
    expect(parsePatch({ status: "Saved", notes: "x", appliedDate: "2026-11-15" })).toEqual({
      status: "Saved",
      notes: "x",
      appliedDate: "2026-11-15",
    });
    expect(parsePatch({ appliedDate: null })).toEqual({ appliedDate: null });
  });

  it("rejects unknown statuses, bad dates and empty patches", () => {
    expect(parsePatch({ status: "Hired" })).toBeNull();
    expect(parsePatch({ appliedDate: "15/11/2026" })).toBeNull();
    expect(parsePatch({})).toBeNull();
    expect(parsePatch(null)).toBeNull();
  });

  it("ignores fields outside the whitelist", () => {
    expect(parsePatch({ status: "Saved", "Match %": 1, Title: "hack" })).toEqual({ status: "Saved" });
    expect(patchToFields({ status: "Saved" })).toEqual({ Status: "Saved" });
  });
});
