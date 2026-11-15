import { describe, expect, it, vi } from "vitest";
import type { Complete, CvVersion } from "@/pipeline/match";
import { runPipeline, type Collector, type ExistingJob, type PipelineConfig, type RunLog, type SourceConfig } from "@/pipeline/run";
import { DEFAULT_TARGET_ROLES } from "@/pipeline/roles";
import type { RawJob } from "@/pipeline/types";
import { CITIES } from "./fixtures";

const NOW = new Date("2026-11-15T12:00:00Z");
const TODAY = "2026-11-15";
const OPTS = { today: TODAY, now: NOW };

const CVS: CvVersion[] = [
  { name: "Base", emphasis: "general", fullText: "Base CV" },
  { name: "AI Health", emphasis: "AI and health", fullText: "AI Health CV" },
];

const LI: SourceConfig = { key: "linkedin-pm", source: "LinkedIn", actor: "valig/linkedin-jobs-scraper", input: {} };
const DR: SourceConfig = { key: "drushim-pm", source: "Drushim", actor: "blackfalcondata/drushim-scraper", input: {} };

/** A LinkedIn-shaped raw item (ID comes from the link). */
const li = (id: number, title = "Senior Product Manager", company = "Acme", location = "Tel Aviv-Yafo, Tel Aviv District, Israel"): RawJob => ({
  title,
  companyName: company,
  location,
  postedAt: "2026-11-14",
  descriptionText: `Own the roadmap for ${company}. Requirements: product sense. Opening ${id}.`, // differs per ID: identical text would be an employer repost
  link: `https://il.linkedin.com/jobs/view/${title.toLowerCase().replace(/\W+/g, "-")}-at-${company.toLowerCase()}-${id}?trackingId=x`,
});

const dr = (code: number, title: string, company: string, location: string): RawJob => ({
  title,
  company,
  location,
  postedAt: "2026-11-13T10:00:00.000Z",
  description: `תיאור המשרה של ${company} ${code}. אחריות על מוצר.`,
  portalUrl: `https://www.drushim.co.il/job/${code}/abcd/`,
});

const ex = (over: Partial<ExistingJob> = {}): ExistingJob => ({
  recordId: "recAAAAAAAAAAAAA1",
  externalId: "LinkedIn:4400000001",
  source: "LinkedIn",
  status: "New",
  lastSeen: "2026-11-14",
  postedDate: "2026-11-12",
  match: null,
  title: "Senior Product Manager",
  company: "Acme",
  location: "Tel Aviv-Yafo, Tel Aviv District, Israel",
  officeRequirement: "Unknown",
  ...over,
});

function setup(existing: ExistingJob[] = [], cfg: Partial<PipelineConfig> = {}) {
  const created: Record<string, unknown>[] = [];
  const updated: { id: string; fields: Record<string, unknown> }[] = [];
  const runs: RunLog[] = [];
  const store = {
    loadConfig: async (): Promise<PipelineConfig> => ({
      cities: CITIES,
      favoriteCompanies: ["JFrog"],
      roles: DEFAULT_TARGET_ROLES,
      blocklist: [],
      cvs: CVS,
      ...cfg,
    }),
    loadExistingJobs: async () => existing,
    createJobs: async (rows: Record<string, unknown>[]) => void created.push(...rows),
    updateJobs: async (rows: { id: string; fields: Record<string, unknown> }[]) => void updated.push(...rows),
    logRun: async (e: RunLog) => void runs.push(e),
  };
  return { store, created, updated, runs };
}

/** Collector answering per source key: an array of raw items, or an Error to throw. */
const collector = (answers: Record<string, RawJob[] | Error>): Collector => async (cfg) => {
  const a = answers[cfg.key];
  if (a instanceof Error) throw a;
  return a ?? [];
};

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ score: 80, recommendedCv: "AI Health", domain: "Medtech", rationale: "הסבר", skillGaps: ["א"], missingKeywords: ["k"], cvSuggestions: ["ס"], ...over });

describe("a normal run", () => {
  it("creates new jobs, refreshes only Last Seen on known ones, drops other roles, and logs", async () => {
    const { store, created, updated, runs } = setup([ex()]);
    const report = await runPipeline(
      {
        sources: [LI, DR],
        collect: collector({
          "linkedin-pm": [li(4400000001), li(4400000002, "Product Manager", "JFrog"), li(4400000003, "Software Engineer")],
          "drushim-pm": [dr(111, "מנהל.ת מוצר", "חברה", "פתח תקווה")],
        }),
        store,
      },
      OPTS,
    );

    expect(report).toMatchObject({ created: 2, updated: 1, closed: 0, relevant: 3 }); // the engineer was dropped
    expect(created.map((r) => r["External ID"]).sort()).toEqual(["Drushim:111", "LinkedIn:4400000002"]);
    expect(created.find((r) => r["External ID"] === "LinkedIn:4400000002")).toMatchObject({
      Title: "Product Manager",
      "Favorite Company": true,
      Status: "New",
      "First Seen": TODAY,
      "Last Seen": TODAY,
      "Location OK": true,
    });
    // the known job: ONLY Last Seen. Never status, notes, dates the user may have set.
    expect(updated).toEqual([{ id: "recAAAAAAAAAAAAA1", fields: { "Last Seen": TODAY } }]);

    expect(runs.map((r) => `${r.source}:${r.status}`)).toEqual(["LinkedIn:Success", "Drushim:Success", "All:Success"]);
    expect(runs.find((r) => r.source === "All")).toMatchObject({ newJobs: 2, updatedJobs: 1, closedJobs: 0 });
  });

  it("jobs whose location does not fit are still stored (the dashboard can filter them), just never scored", async () => {
    const { store, created } = setup();
    const complete = vi.fn<Complete>().mockResolvedValue(reply());
    await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000009, "Product Manager", "Far", "Haifa, Israel")] }), store, complete }, OPTS);
    expect(created).toHaveLength(1);
    expect(created[0]["Location OK"]).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it("refuses to start (and writes nothing) when the settings cannot be loaded", async () => {
    const { store, created, runs } = setup();
    store.loadConfig = async () => {
      throw new Error("Airtable 401");
    };
    await expect(runPipeline({ sources: [LI], collect: collector({}), store }, OPTS)).rejects.toThrow("Airtable 401");
    expect(created).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it("dry run: plans everything, writes nothing", async () => {
    const { store, created, updated, runs } = setup([ex()]);
    const report = await runPipeline(
      { sources: [LI], collect: collector({ "linkedin-pm": [li(4400000001), li(4400000002)] }), store },
      { ...OPTS, dryRun: true },
    );
    expect(report).toMatchObject({ dryRun: true, created: 1, updated: 1 });
    expect(report.sample).toHaveLength(1);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });
});

describe("a failing source", () => {
  it("does not stop the others, is logged, and its jobs are NOT closed", async () => {
    const old = ex({ recordId: "recOLD00000000001", externalId: "LinkedIn:4400000050", lastSeen: "2026-11-01", postedDate: "2026-11-10" });
    const { store, created, updated, runs } = setup([old]);
    const report = await runPipeline(
      { sources: [LI, DR], collect: collector({ "linkedin-pm": new Error("502 upstream request failed"), "drushim-pm": [dr(222, "מנהל/ת מוצר", "חברה", "חולון")] }), store },
      OPTS,
    );
    expect(created.map((r) => r["External ID"])).toEqual(["Drushim:222"]);
    expect(report.errors[0]).toContain("linkedin-pm: 502");
    expect(updated.find((u) => u.id === old.recordId)).toBeUndefined(); // an outage must never close jobs
    expect(runs.map((r) => `${r.source}:${r.status}`)).toEqual(["LinkedIn:Failed", "Drushim:Success", "All:Partial"]);
    expect(runs[0].errors).toContain("502");
  });

  it("an empty answer from a source also closes nothing", async () => {
    const old = ex({ lastSeen: "2026-11-01", postedDate: "2026-11-10" });
    const { store, updated } = setup([old]);
    await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [] }), store }, OPTS);
    expect(updated).toEqual([]);
  });

  it("when every source fails the run is logged as Failed", async () => {
    const { store, runs } = setup();
    await runPipeline({ sources: [LI, DR], collect: collector({ "linkedin-pm": new Error("x"), "drushim-pm": new Error("y") }), store }, OPTS);
    expect(runs.at(-1)).toMatchObject({ source: "All", status: "Failed" });
  });

  it("with several searches on one source, one failed search does not hide the others and is logged once per source", async () => {
    const second: SourceConfig = { ...LI, key: "linkedin-architect" };
    const { store, runs, created } = setup();
    await runPipeline({ sources: [LI, second], collect: collector({ "linkedin-pm": [li(4400000007)], "linkedin-architect": new Error("boom") }), store }, OPTS);
    expect(created).toHaveLength(1);
    expect(runs.filter((r) => r.source === "LinkedIn")).toHaveLength(1);
    expect(runs.find((r) => r.source === "LinkedIn")).toMatchObject({ status: "Partial", newJobs: 1 });
  });
});

describe("closing jobs that went missing", () => {
  const still = ex({ recordId: "recSTILL000000001", externalId: "LinkedIn:4400000010", lastSeen: "2026-11-14" });

  it("closes a New/Saved job posted inside the search window and not seen for more than 3 days", async () => {
    const gone = ex({ recordId: "recGONE000000001", externalId: "LinkedIn:4400000011", lastSeen: "2026-11-10", postedDate: "2026-11-08" });
    const saved = ex({ recordId: "recSAVED00000001", externalId: "LinkedIn:4400000012", lastSeen: "2026-11-10", postedDate: "2026-11-08", status: "Saved" });
    const { store, updated, runs } = setup([gone, saved, still]);
    const report = await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000010)] }), store }, OPTS);
    expect(report.closed).toBe(2);
    expect(updated.filter((u) => u.fields.Status === "Closed").map((u) => u.id).sort()).toEqual(["recGONE000000001", "recSAVED00000001"]);
    expect(runs.find((r) => r.source === "LinkedIn")).toMatchObject({ closedJobs: 2 });
  });

  it("never touches jobs the user acted on, recent ones, or ones posted before the search window", async () => {
    const applied = ex({ recordId: "recAPPLIED000001", externalId: "LinkedIn:4400000013", lastSeen: "2026-11-01", postedDate: "2026-11-10", status: "Applied" });
    const interview = ex({ recordId: "recINTERV0000001", externalId: "LinkedIn:4400000014", lastSeen: "2026-11-01", postedDate: "2026-11-10", status: "Interview" });
    const recent = ex({ recordId: "recRECENT0000001", externalId: "LinkedIn:4400000015", lastSeen: "2026-11-13", postedDate: "2026-11-10" });
    const oldPost = ex({ recordId: "recOLDPOST000001", externalId: "LinkedIn:4400000016", lastSeen: "2026-11-01", postedDate: "2026-10-01" });
    const noDate = ex({ recordId: "recNODATE0000001", externalId: "LinkedIn:4400000017", lastSeen: "2026-11-01", postedDate: null });
    const { store, updated } = setup([applied, interview, recent, oldPost, noDate, still]);
    const report = await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000010)] }), store }, OPTS);
    expect(report.closed).toBe(0);
    expect(updated.every((u) => u.fields.Status !== "Closed")).toBe(true);
  });

  it("a closed job that is listed again is reopened", async () => {
    const closed = ex({ recordId: "recCLOSED0000001", status: "Closed" });
    const { store, updated } = setup([closed]);
    await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000001)] }), store }, OPTS);
    expect(updated).toEqual([{ id: "recCLOSED0000001", fields: { "Last Seen": TODAY, Status: "New" } }]);
  });

  it("but a job the user marked 'Not relevant' or 'Rejected' keeps that status when listed again", async () => {
    const nr = ex({ recordId: "recNOTREL0000001", status: "Not relevant" });
    const { store, updated } = setup([nr]);
    await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000001)] }), store }, OPTS);
    expect(updated[0].fields).toEqual({ "Last Seen": TODAY });
  });
});

describe("the same job on another site, found in an earlier run", () => {
  it("is not created a second time: the existing row is refreshed instead", async () => {
    const stored = ex({ recordId: "recJFROG000000001", externalId: "LinkedIn:4400000020", title: "Senior Product Manager", company: "JFrog", location: "Herzliya, Tel Aviv District, Israel" });
    const { store, created, updated } = setup([stored]);
    const report = await runPipeline(
      { sources: [DR], collect: collector({ "drushim-pm": [dr(333, "Senior Product Manager", "JFrog", "הרצליה")] }), store },
      OPTS,
    );
    expect(created).toHaveLength(0);
    expect(report).toMatchObject({ created: 0, updated: 1 });
    expect(updated).toEqual([{ id: "recJFROG000000001", fields: { "Last Seen": TODAY } }]);
  });

  it("two different openings are not mistaken for it", async () => {
    const stored = ex({ recordId: "recJFROG000000001", externalId: "LinkedIn:4400000020", company: "JFrog", location: "Herzliya, Israel" });
    const { store, created } = setup([stored]);
    await runPipeline({ sources: [DR], collect: collector({ "drushim-pm": [dr(334, "Senior Product Manager", "Navina", "הרצליה")] }), store }, OPTS);
    expect(created).toHaveLength(1);
  });
});

describe("scoring", () => {
  it("scores new, relevant jobs and writes the result with the job", async () => {
    const { store, created } = setup();
    const complete = vi.fn<Complete>().mockResolvedValue(reply({ score: 77 }));
    const report = await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000030)] }), store, complete }, OPTS);
    expect(report).toMatchObject({ matched: 1, matchSkipped: 0 });
    expect(created[0]).toMatchObject({ "Match %": 0.77, "Recommended CV": "AI Health", Domain: "Medtech", Status: "New" });
  });

  it("works without a model: jobs are created unscored and counted as waiting", async () => {
    const { store, created } = setup();
    const report = await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000031)] }), store }, OPTS);
    expect(created[0]).not.toHaveProperty("Match %");
    expect(report).toMatchObject({ matched: 0, matchSkipped: 1 });
  });

  it("a job the model could not score is still created, and the problem is logged", async () => {
    const { store, created, runs } = setup();
    const complete = vi.fn<Complete>().mockResolvedValue("not json");
    const report = await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000032)] }), store, complete }, OPTS);
    expect(created).toHaveLength(1);
    expect(created[0]).not.toHaveProperty("Match %");
    expect(report.errors[0]).toContain("match LinkedIn:4400000032");
    expect(runs.at(-1)?.status).toBe("Partial");
  });

  it("a model outage (key, quota, network) stops scoring instead of failing every job", async () => {
    const { store, created } = setup();
    const complete = vi.fn<Complete>().mockRejectedValue(new Error("529 overloaded"));
    const report = await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000033), li(4400000034), li(4400000035)] }), store, complete }, OPTS);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(3); // all still stored
    expect(report.errors).toHaveLength(1);
  });

  it("respects the per-run budget", async () => {
    const { store, created } = setup();
    const complete = vi.fn<Complete>().mockResolvedValue(reply());
    const report = await runPipeline(
      { sources: [LI], collect: collector({ "linkedin-pm": [li(4400000036), li(4400000037), li(4400000038)] }), store, complete },
      { ...OPTS, maxMatches: 1 },
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ matched: 1, matchSkipped: 2 });
    expect(created.filter((r) => "Match %" in r)).toHaveLength(1);
  });

  it("a job stored earlier without a score gets one when it shows up again", async () => {
    const unscored = ex({ match: null });
    const scoredAlready = ex({ recordId: "recSCORED0000001", externalId: "LinkedIn:4400000002", match: 0.5 });
    const { store, updated } = setup([unscored, scoredAlready]);
    const complete = vi.fn<Complete>().mockResolvedValue(reply({ score: 66 }));
    await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000001), li(4400000002)] }), store, complete }, OPTS);
    expect(complete).toHaveBeenCalledTimes(1); // only the unscored one
    expect(updated.find((u) => u.id === unscored.recordId)?.fields).toMatchObject({ "Last Seen": TODAY, "Match %": 0.66 });
    expect(updated.find((u) => u.id === scoredAlready.recordId)?.fields).toEqual({ "Last Seen": TODAY }); // existing score untouched
  });
});

describe("a search that hit its result cap", () => {
  const gone = ex({ recordId: "recGONE000000009", externalId: "LinkedIn:4400000090", lastSeen: "2026-11-01", postedDate: "2026-11-10" });
  const capped: SourceConfig = { ...LI, input: { limit: 2 } };

  it("never closes jobs: a job can be missing only because it did not fit under the cap (seen in the real run)", async () => {
    const { store, updated } = setup([gone]);
    const report = await runPipeline({ sources: [capped], collect: collector({ "linkedin-pm": [li(4400000091), li(4400000092)] }), store }, OPTS);
    expect(report.sources[0].capped).toBe(true);
    expect(report.closed).toBe(0);
    expect(updated.find((u) => u.id === gone.recordId)).toBeUndefined();
  });

  it("closes again as soon as the results are complete (fewer than the cap)", async () => {
    const { store, updated } = setup([gone]);
    const report = await runPipeline({ sources: [capped], collect: collector({ "linkedin-pm": [li(4400000091)] }), store }, OPTS);
    expect(report.sources[0].capped).toBe(false);
    expect(report.closed).toBe(1);
    expect(updated.find((u) => u.id === gone.recordId)?.fields.Status).toBe("Closed");
  });

  it("one capped search among several blocks closing for that whole source", async () => {
    const second: SourceConfig = { ...LI, key: "linkedin-architect", input: { limit: 50 } };
    const { store } = setup([gone]);
    const report = await runPipeline(
      { sources: [capped, second], collect: collector({ "linkedin-pm": [li(4400000091), li(4400000092)], "linkedin-architect": [li(4400000093)] }), store },
      OPTS,
    );
    expect(report.closed).toBe(0);
  });

  it("a source whose searches carry no cap is unaffected", async () => {
    const { store } = setup([gone]);
    const report = await runPipeline({ sources: [LI], collect: collector({ "linkedin-pm": [li(4400000091)] }), store }, OPTS);
    expect(report.sources[0].capped).toBe(false);
    expect(report.closed).toBe(1);
  });
});
