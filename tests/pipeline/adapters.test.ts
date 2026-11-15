import { describe, expect, it, vi } from "vitest";
import { createAnthropicComplete, DEFAULT_MODEL } from "@/pipeline/anthropic";
import { createApifyCollector } from "@/pipeline/apify";
import { createAirtableStore, TABLES } from "@/pipeline/airtable-store";
import { TransientError, withRetry } from "@/pipeline/retry";
import { buildSources, lookbackDays } from "@/pipeline/sources";
import { isScheduledHour, israelHour, israelToday } from "@/pipeline/time";
import type { RunLog } from "@/pipeline/run";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => {};

describe("withRetry", () => {
  it("retries transient errors only, with growing waits", async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        if (++calls < 3) throw new TransientError("502");
        return "ok";
      },
      { delayMs: 1000, sleep: async (ms) => void waits.push(ms) },
    );
    expect(out).toBe("ok");
    expect(waits).toEqual([1000, 2000]);
    let plain = 0;
    await expect(withRetry(async () => { plain++; throw new Error("401"); }, { sleep: noSleep })).rejects.toThrow("401");
    expect(plain).toBe(1);
  });
});

describe("Israel time and the schedule (08:00 / 18:00 despite daylight saving)", () => {
  const at = (iso: string) => new Date(iso);

  it("winter (UTC+2): 06:00 and 16:00 UTC are the scheduled hours", () => {
    expect(israelHour(at("2026-01-15T06:00:00Z"))).toBe(8);
    expect(isScheduledHour(at("2026-01-15T06:00:00Z"))).toBe(true);
    expect(isScheduledHour(at("2026-01-15T16:00:00Z"))).toBe(true);
    expect(isScheduledHour(at("2026-01-15T05:00:00Z"))).toBe(false); // 07:00 local: the summer trigger, skipped
    expect(isScheduledHour(at("2026-01-15T15:00:00Z"))).toBe(false);
  });

  it("summer (UTC+3): 05:00 and 15:00 UTC are the scheduled hours", () => {
    expect(isScheduledHour(at("2026-07-15T05:00:00Z"))).toBe(true);
    expect(isScheduledHour(at("2026-07-15T15:00:00Z"))).toBe(true);
    expect(isScheduledHour(at("2026-07-15T06:00:00Z"))).toBe(false); // 09:00 local: the winter trigger, skipped
    expect(isScheduledHour(at("2026-07-15T16:00:00Z"))).toBe(false);
  });

  it("exactly one of the two UTC triggers fires per slot, all year", () => {
    for (const day of ["2026-01-15", "2026-03-20", "2026-07-15", "2026-10-30", "2026-12-31"]) {
      const morning = [5, 6].filter((h) => isScheduledHour(at(`${day}T0${h}:00:00Z`)));
      const evening = [15, 16].filter((h) => isScheduledHour(at(`${day}T${h}:00:00Z`)));
      expect(morning, day).toHaveLength(1);
      expect(evening, day).toHaveLength(1);
    }
  });

  it("the Israeli date can be a day ahead of UTC", () => {
    expect(israelToday(at("2026-11-15T22:30:00Z"))).toBe("2026-11-16");
    expect(israelToday(at("2026-11-15T10:00:00Z"))).toBe("2026-11-15");
  });
});

describe("buildSources", () => {
  it("uses the chosen actors with their real input fields, and a cost cap on every search", () => {
    const sources = buildSources();
    expect(new Set(sources.map((s) => s.key)).size).toBe(sources.length);
    expect(new Set(sources.map((s) => s.source))).toEqual(new Set(["LinkedIn", "Drushim"]));
    for (const s of sources.filter((x) => x.source === "LinkedIn")) {
      expect(s.actor).toBe("valig/linkedin-jobs-scraper");
      expect(s.input).toMatchObject({ location: "Israel", datePosted: "r604800" });
      expect(s.input.limit as number).toBeGreaterThan(0);
    }
    for (const s of sources.filter((x) => x.source === "Drushim")) {
      expect(s.actor).toBe("blackfalcondata/drushim-scraper");
      expect(s.input.maxResults as number).toBeGreaterThan(0);
    }
  });

  it("covers Hebrew titles, day lookback, and a limit override for cheap dry runs", () => {
    expect(buildSources().some((s) => s.input.query === "מנהל מוצר")).toBe(true);
    expect(buildSources({ lookback: "day" }).filter((s) => s.source === "LinkedIn").every((s) => s.input.datePosted === "r86400")).toBe(true);
    const capped = buildSources({ limit: 5 });
    expect(capped.every((s) => (s.input.limit ?? s.input.maxResults) === 5)).toBe(true);
    expect(lookbackDays("week")).toBe(7);
    expect(lookbackDays("day")).toBe(1);
  });
});

describe("Apify collector", () => {
  const cfg = { key: "k", source: "Drushim" as const, actor: "blackfalcondata/drushim-scraper", input: { query: "PM", maxResults: 5 } };
  const run = (status: string) => ({ data: { id: "run1", status, defaultDatasetId: "ds1" } });

  it("starts the run, waits for it, and returns the items", async () => {
    const calls: { url: string; method: string; auth: string | null; body: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body: (init?.body as string) ?? null });
      if (u.includes("/acts/")) return json(run("RUNNING"));
      if (u.includes("/actor-runs/run1")) return json(run("SUCCEEDED"));
      if (u.includes("/datasets/ds1/items")) return json([{ title: "a" }, { title: "b" }]);
      return json({}, 404);
    });
    const items = await createApifyCollector({ token: "tok", fetchImpl: fetchImpl as never })(cfg);
    expect(items).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "POST", auth: "Bearer tok", body: JSON.stringify(cfg.input) });
    expect(calls[0].url).toContain("/acts/blackfalcondata~drushim-scraper/runs");
  });

  it("retries the 502 that happened in the real trial, then succeeds", async () => {
    let posts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/acts/")) return ++posts === 1 ? json({}, 502) : json(run("SUCCEEDED"));
      if (u.includes("/datasets/")) return json([{ title: "a" }]);
      return json({}, 404);
    });
    const items = await createApifyCollector({ token: "t", fetchImpl: fetchImpl as never, sleep: noSleep })(cfg);
    expect(items).toHaveLength(1);
    expect(posts).toBe(2);
  });

  it("reports a failed run, an aborted run, and a run that never finishes", async () => {
    const failing = (status: string) => vi.fn(async () => json(run(status)));
    await expect(createApifyCollector({ token: "t", fetchImpl: failing("FAILED") as never })(cfg)).rejects.toThrow("run FAILED");
    await expect(createApifyCollector({ token: "t", fetchImpl: failing("TIMED-OUT") as never })(cfg)).rejects.toThrow("run TIMED-OUT");
    await expect(createApifyCollector({ token: "t", fetchImpl: failing("RUNNING") as never, maxPolls: 2 })(cfg)).rejects.toThrow(/still running/);
  });

  it("does not retry a real error such as a bad token, and never puts the token in the message", async () => {
    const fetchImpl = vi.fn(async () => json({}, 401));
    await expect(createApifyCollector({ token: "SECRET-TOKEN", fetchImpl: fetchImpl as never, sleep: noSleep })(cfg)).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await createApifyCollector({ token: "SECRET-TOKEN", fetchImpl: fetchImpl as never, sleep: noSleep })(cfg).catch((e: Error) => expect(e.message).not.toContain("SECRET-TOKEN"));
  });
});

describe("Airtable store", () => {
  /** A tiny fake Airtable: tables by ID, paging, and a log of writes. */
  function fakeAirtable(tables: Record<string, { id: string; fields: Record<string, unknown> }[]>, pageSize = 100) {
    const writes: { method: string; table: string; body: { records: unknown[]; typecast?: boolean } }[] = [];
    let failNext: number | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      const table = u.pathname.split("/").pop()!;
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer pat-test");
      if (failNext !== null) {
        const status = failNext;
        failNext = null;
        return json({}, status);
      }
      if (init?.method === "POST" || init?.method === "PATCH") {
        writes.push({ method: init.method, table, body: JSON.parse(init.body as string) });
        return json({ records: [] });
      }
      const rows = tables[table] ?? [];
      const start = Number(u.searchParams.get("offset") ?? 0);
      const page = rows.slice(start, start + pageSize);
      return json({ records: page, ...(start + pageSize < rows.length ? { offset: String(start + pageSize) } : {}) });
    });
    return { fetchImpl, writes, failOnce: (status: number) => void (failNext = status) };
  }
  const store = (fake: ReturnType<typeof fakeAirtable>, extra = {}) =>
    createAirtableStore({ token: "pat-test", baseId: "appTEST", fetchImpl: fake.fetchImpl as never, writeGapMs: 0, retryDelayMs: 0, sleep: noSleep, ...extra });

  it("loads the settings: active cities, favorite companies, target roles, active CVs with text", async () => {
    const fake = fakeAirtable({
      [TABLES.approvedCities]: [
        { id: "r1", fields: { City: "Holon", "Hebrew Name": "חולון", Active: true } },
        { id: "r2", fields: { City: "Haifa", "Hebrew Name": "חיפה" } }, // Airtable omits an unticked checkbox
      ],
      [TABLES.companies]: [
        { id: "r3", fields: { Name: "JFrog", Favorite: true } },
        { id: "r4", fields: { Name: "Acme" } },
      ],
      [TABLES.profile]: [{ id: "r5", fields: { Setting: "Target roles", Value: "Product Manager, Solution Architect" } }],
      [TABLES.cvVersions]: [
        { id: "r6", fields: { Name: "Base", Emphasis: "general", "Full Text": "cv text", Active: true } },
        { id: "r7", fields: { Name: "Old", "Full Text": "old", Active: false } },
        { id: "r8", fields: { Name: "Empty", Active: true } },
      ],
    });
    const cfg = await store(fake).loadConfig();
    expect(cfg.cities).toEqual([
      { city: "Holon", hebrewName: "חולון", active: true },
      { city: "Haifa", hebrewName: "חיפה", active: false },
    ]);
    expect(cfg.favoriteCompanies).toEqual(["JFrog"]);
    expect(cfg.roles).toEqual(["Product Manager", "Solution Architect"]);
    expect(cfg.blocklist).toEqual([]);
    expect(cfg.cvs).toEqual([{ name: "Base", emphasis: "general", fullText: "cv text" }]);
  });

  it("falls back to the default roles when the Profile has none, and reads a blocklist if one exists", async () => {
    const empty = await store(fakeAirtable({})).loadConfig();
    expect(empty.roles).toContain("Product Manager");
    const withBlock = await store(fakeAirtable({ [TABLES.profile]: [{ id: "r", fields: { Setting: "Blocklist", Value: "Intern, Junior" } }] })).loadConfig();
    expect(withBlock.blocklist).toEqual(["Intern", "Junior"]);
  });

  it("lists existing jobs across pages, mapping fields and skipping rows without an External ID", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `rec${i}`,
      fields: { "External ID": `LinkedIn:${i}`, Status: "Saved", "Last Seen": "2026-11-14", "Posted Date": "2026-11-10", "Match %": 0.8, Title: "PM", Company: "Acme", Location: "Holon", "Office Requirement": "Hybrid", Source: "LinkedIn" },
    }));
    rows.push({ id: "recX", fields: { "External ID": "", Title: "no id" } as never });
    const jobs = await store(fakeAirtable({ [TABLES.jobs]: rows }, 2)).loadExistingJobs();
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toEqual({
      recordId: "rec0", externalId: "LinkedIn:0", source: "LinkedIn", status: "Saved", lastSeen: "2026-11-14", postedDate: "2026-11-10",
      match: 0.8, title: "PM", company: "Acme", location: "Holon", officeRequirement: "Hybrid",
    });
  });

  it("defaults missing fields safely", async () => {
    const [job] = await store(fakeAirtable({ [TABLES.jobs]: [{ id: "r", fields: { "External ID": "X:1", Source: "Mystery", "Office Requirement": "???" } }] })).loadExistingJobs();
    expect(job).toMatchObject({ source: null, status: "New", lastSeen: null, match: null, officeRequirement: "Unknown" });
  });

  it("writes in batches of 10 with typecast, pausing between batches", async () => {
    const fake = fakeAirtable({});
    const sleeps: number[] = [];
    const s = store(fake, { writeGapMs: 250, sleep: async (ms: number) => void sleeps.push(ms) });
    await s.createJobs(Array.from({ length: 25 }, (_, i) => ({ Title: `t${i}` })));
    expect(fake.writes.map((w) => w.body.records.length)).toEqual([10, 10, 5]);
    expect(fake.writes.every((w) => w.method === "POST" && w.table === TABLES.jobs && w.body.typecast === true)).toBe(true);
    expect(sleeps).toEqual([250, 250]);
  });

  it("updates by record ID, and writes nothing for an empty list", async () => {
    const fake = fakeAirtable({});
    const s = store(fake);
    await s.updateJobs([{ id: "recA", fields: { "Last Seen": "2026-11-15" } }]);
    await s.updateJobs([]);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ method: "PATCH", body: { records: [{ id: "recA", fields: { "Last Seen": "2026-11-15" } }], typecast: true } });
  });

  it("logs a run to the Runs table, leaving out empty errors", async () => {
    const fake = fakeAirtable({});
    const entry: RunLog = { startedAt: "2026-11-15T06:00:00.000Z", source: "LinkedIn", status: "Success", newJobs: 3, updatedJobs: 5, closedJobs: 1, errors: "" };
    await store(fake).logRun(entry);
    await store(fake).logRun({ ...entry, status: "Partial", errors: "boom" });
    expect(fake.writes[0].table).toBe(TABLES.runs);
    expect(fake.writes[0].body.records[0]).toEqual({ fields: { "Started At": entry.startedAt, Source: "LinkedIn", Status: "Success", "New Jobs": 3, "Updated Jobs": 5, "Closed Jobs": 1 } });
    expect((fake.writes[1].body.records[0] as { fields: Record<string, unknown> }).fields.Errors).toBe("boom");
  });

  it("retries a rate limit (429) but not a permission error, and never leaks the token", async () => {
    const limited = fakeAirtable({ [TABLES.jobs]: [] });
    limited.failOnce(429);
    await expect(store(limited).loadExistingJobs()).resolves.toEqual([]);
    expect(limited.fetchImpl).toHaveBeenCalledTimes(2);

    const denied = fakeAirtable({});
    denied.failOnce(403);
    const err = await store(denied).loadExistingJobs().catch((e: Error) => e);
    expect((err as Error).message).toContain("403");
    expect((err as Error).message).not.toContain("pat-test");
    expect(denied.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("Anthropic client", () => {
  const ok = (text = '{"x":1}') => json({ content: [{ type: "text", text }] });

  it("sends the documented request and returns the text", async () => {
    let seen: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), headers: new Headers(init?.headers), body: JSON.parse(init?.body as string) };
      return json({ content: [{ type: "text", text: "part1 " }, { type: "tool_use" }, { type: "text", text: "part2" }] });
    });
    const text = await createAnthropicComplete({ apiKey: "sk-test", fetchImpl: fetchImpl as never })({ system: "SYS", user: "USER", maxTokens: 123 });
    expect(text).toBe("part1 part2");
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen!.headers.get("x-api-key")).toBe("sk-test");
    expect(seen!.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(seen!.body).toEqual({ model: DEFAULT_MODEL, max_tokens: 123, system: "SYS", messages: [{ role: "user", content: "USER" }] });
  });

  it("uses the configured model", async () => {
    let model = "";
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => ((model = JSON.parse(init?.body as string).model), ok()));
    await createAnthropicComplete({ apiKey: "k", model: "claude-haiku-5-5", fetchImpl: fetchImpl as never })({ system: "", user: "", maxTokens: 1 });
    expect(model).toBe("claude-haiku-5-5");
  });

  it("retries overload (529) and rate limits, but not a rejected key; errors never include the key", async () => {
    let n = 0;
    const flaky = vi.fn(async () => (++n === 1 ? json({}, 529) : ok("done")));
    await expect(createAnthropicComplete({ apiKey: "sk-secret", fetchImpl: flaky as never, sleep: noSleep })({ system: "", user: "", maxTokens: 1 })).resolves.toBe("done");

    const rejected = vi.fn(async () => json({ error: "bad key sk-secret" }, 401));
    const err = await createAnthropicComplete({ apiKey: "sk-secret", fetchImpl: rejected as never, sleep: noSleep })({ system: "", user: "", maxTokens: 1 }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Anthropic API 401");
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("fails clearly on an empty reply", async () => {
    const fetchImpl = vi.fn(async () => json({ content: [] }));
    await expect(createAnthropicComplete({ apiKey: "k", fetchImpl: fetchImpl as never })({ system: "", user: "", maxTokens: 1 })).rejects.toThrow("empty reply");
  });
});

describe("cost ceiling of one scheduled run", () => {
  it("stays under about $0.5 even if every search returns its maximum (prices from the 2026-11-15 trial)", () => {
    let usd = 0;
    for (const s of buildSources()) {
      const results = (s.input.limit ?? s.input.maxResults) as number;
      usd += s.source === "LinkedIn" ? results * 0.0004 + 0.001 : results * 0.002 + 0.01;
    }
    expect(usd).toBeLessThan(0.5);
  });
});
