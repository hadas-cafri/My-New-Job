import { describe, expect, it } from "vitest";
import { toAirtableFields } from "@/pipeline/airtable-fields";
import { classify, dedupe, fingerprint, isDirectCompanyUrl } from "@/pipeline/dedupe";
import {
  cleanUrl,
  detectLanguage,
  foldCompany,
  idFromUrl,
  isFavoriteCompany,
  normalizeAll,
  normalizeJob,
} from "@/pipeline/normalize";
import type { NormalizedJob } from "@/pipeline/types";
import { CITIES } from "./fixtures";

const now = new Date("2026-11-15T12:00:00Z");
const ctx = (source: "LinkedIn" | "Drushim" | "Company site") => ({
  source,
  cities: CITIES,
  favoriteCompanies: ["AT&T", "JFrog", "Navina", "MDClone"],
  now,
});

// Shapes are guesses at real actor output; they get replaced with real samples after the Apify trial.
const linkedinRaw = {
  id: "3801234567",
  title: "Senior Product Manager",
  companyName: "JFrog",
  location: "Herzliya, Tel Aviv District, Israel",
  descriptionHtml: "<p>Own the <b>platform</b> roadmap.</p><ul><li>Hybrid, 3 days in the office</li></ul>",
  link: "https://www.linkedin.com/jobs/view/senior-product-manager-at-jfrog-3801234567?trackingId=abc&refId=xyz&utm_source=x",
  applyUrl: "https://jfrog.com/careers/apply/123?utm_campaign=li",
  postedAt: "2026-11-12",
};

const drushimRaw = {
  שם_המשרה: "ignored",
  title: "מנהל/ת מוצר בכיר/ה",
  company: "נבינה בע\"מ",
  location: "תל אביב",
  description: "<div>אנחנו מחפשים מנהל מוצר לצוות ה-AI. עבודה מהבית אפשרית.</div>",
  url: "https://www.drushim.co.il/job/987654/abc?src=feed",
  date: "לפני 3 ימים",
};

describe("normalizeJob", () => {
  it("normalizes a LinkedIn item into the common shape", () => {
    const job = normalizeJob(linkedinRaw, ctx("LinkedIn"))!;
    expect(job).toMatchObject({
      externalId: "LinkedIn:3801234567",
      source: "LinkedIn",
      title: "Senior Product Manager",
      company: "JFrog",
      favoriteCompany: true,
      city: "Herzliya",
      country: "Israel",
      officeRequirement: "Hybrid",
      locationOk: true,
      postedDate: "2026-11-12",
      language: "English",
      applyUrl: "https://jfrog.com/careers/apply/123", // direct link preferred, tracking removed
    });
    expect(job.description).toBe("Own the platform roadmap.\n- Hybrid, 3 days in the office");
  });

  it("normalizes a Hebrew Drushim item", () => {
    const job = normalizeJob(drushimRaw, ctx("Drushim"))!;
    expect(job).toMatchObject({
      externalId: "Drushim:987654", // taken from the URL
      title: "מנהל/ת מוצר בכיר/ה",
      favoriteCompany: false, // the favorites list only has the English name "Navina"
      language: "Hebrew",
      city: "Tel Aviv-Yafo",
      postedDate: "2026-11-12",
      applyUrl: "https://www.drushim.co.il/job/987654/abc",
    });
  });

  it("recognizes a favorite company written in Hebrew when its Hebrew name is in the list", () => {
    const withHebrew = { ...ctx("Drushim"), favoriteCompanies: ["Navina", "נבינה"] };
    expect(normalizeJob(drushimRaw, withHebrew)!.favoriteCompany).toBe(true);
  });

  it("returns null when there is no title", () => {
    expect(normalizeJob({ company: "X" }, ctx("LinkedIn"))).toBeNull();
    expect(normalizeJob({ title: "   " }, ctx("LinkedIn"))).toBeNull();
  });

  it("builds a stable fallback ID when the source gives none", () => {
    const raw = { title: "Product Manager", company: "Acme", location: "Holon" };
    const a = normalizeJob(raw, ctx("LinkedIn"))!;
    const b = normalizeJob({ ...raw }, ctx("LinkedIn"))!;
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toMatch(/^LinkedIn:h[0-9a-f]{8}$/);
    expect(a.sourceJobId).toBeNull();
  });

  it("handles nested values and odd input without throwing", () => {
    const job = normalizeJob(
      { title: "Solution Architect", company: { name: "Acme Ltd" }, location: { text: "Holon" }, remote: false, id: 77 },
      ctx("LinkedIn"),
    )!;
    expect(job.company).toBe("Acme Ltd");
    expect(job.location).toBe("Holon");
    expect(job.externalId).toBe("LinkedIn:77");
    expect(() => normalizeJob({ title: "PM", postedAt: {}, link: 5, description: null }, ctx("LinkedIn"))).not.toThrow();
  });

  it("applies the location rule end to end", () => {
    const remoteAbroad = normalizeJob(
      { title: "Product Manager", company: "Acme", location: "Austin, Texas, United States", workplaceType: "Remote" },
      ctx("LinkedIn"),
    )!;
    expect(remoteAbroad).toMatchObject({ officeRequirement: "Fully remote", locationOk: true });

    const officeAbroad = normalizeJob(
      { title: "Product Manager", company: "Acme", location: "London, United Kingdom", workplaceType: "Hybrid" },
      ctx("LinkedIn"),
    )!;
    expect(officeAbroad.locationOk).toBe(false);

    const farOffice = normalizeJob(
      { title: "Product Manager", company: "Acme", location: "Haifa, Israel", workplaceType: "On-site" },
      ctx("LinkedIn"),
    )!;
    expect(farOffice).toMatchObject({ officeRequirement: "Daily office", locationOk: false });
  });

  it("normalizeAll drops unusable items", () => {
    expect(normalizeAll([linkedinRaw, { company: "no title" }, drushimRaw], ctx("LinkedIn"))).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("cleanUrl strips tracking parameters, keeps real ones, rejects non-http", () => {
    expect(cleanUrl("https://x.com/job?id=5&utm_source=a&trk=b&refId=c#frag")).toBe("https://x.com/job?id=5");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("not a url")).toBeNull();
    expect(cleanUrl("")).toBeNull();
  });

  it("idFromUrl", () => {
    expect(idFromUrl("https://www.linkedin.com/jobs/view/senior-pm-at-acme-3801234567?x=1")).toBe("3801234567");
    expect(idFromUrl("https://www.linkedin.com/jobs/view/3801234567/")).toBe("3801234567");
    expect(idFromUrl("https://www.drushim.co.il/job/12345/abc")).toBe("12345");
    expect(idFromUrl("https://example.com/careers/1")).toBeNull();
  });

  it("favorite company matching is strict about word boundaries", () => {
    const favs = ["AT&T", "JFrog", "Navina", "MDClone"];
    expect(isFavoriteCompany("AT&T", favs)).toBe(true);
    expect(isFavoriteCompany("AT&T Israel", favs)).toBe(true);
    expect(isFavoriteCompany("JFrog Ltd.", favs)).toBe(true);
    expect(isFavoriteCompany("Navina", favs)).toBe(true);
    expect(isFavoriteCompany("MDClone Ltd", favs)).toBe(true);
    expect(isFavoriteCompany("Attack Labs", favs)).toBe(false);
    expect(isFavoriteCompany("Navinatech", favs)).toBe(false);
    expect(isFavoriteCompany("", favs)).toBe(false);
    expect(isFavoriteCompany("Acme", [])).toBe(false);
  });

  it("foldCompany drops legal suffixes", () => {
    expect(foldCompany("Acme Ltd.")).toBe("acme");
    expect(foldCompany('אקמי בע"מ')).toBe("אקמי");
  });

  it("detectLanguage", () => {
    expect(detectLanguage("Senior Product Manager")).toBe("English");
    expect(detectLanguage("מנהל מוצר בכיר")).toBe("Hebrew");
    expect(detectLanguage("מנהל מוצר AI Platform")).toBe("Hebrew");
    expect(detectLanguage("1234 !!!")).toBeNull();
  });
});

const job = (over: Partial<NormalizedJob>): NormalizedJob => ({
  externalId: "LinkedIn:1",
  source: "LinkedIn",
  sourceJobId: "1",
  title: "Senior Product Manager",
  company: "JFrog",
  favoriteCompany: true,
  location: "Herzliya, Israel",
  city: "Herzliya",
  country: "Israel",
  officeRequirement: "Hybrid",
  locationOk: true,
  description: "Short",
  applyUrl: "https://www.linkedin.com/jobs/view/1",
  postedDate: "2026-11-12",
  language: "English",
  alsoSeenOn: [],
  ...over,
});

describe("dedupe", () => {
  it("fingerprint ignores case, punctuation, legal suffixes, gender tags", () => {
    const a = job({ title: "Product Manager (m/f/d)", company: "Acme Ltd." });
    const b = job({ title: "product manager", company: "ACME" });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("merges the same job found on LinkedIn and Drushim, keeping the direct company link", () => {
    const li = job({ externalId: "LinkedIn:1", applyUrl: "https://www.linkedin.com/jobs/view/1" });
    const dr = job({
      externalId: "Drushim:9",
      source: "Drushim",
      applyUrl: "https://jfrog.com/careers/apply/55",
      description: "Longer text",
    });
    const { unique, merged } = dedupe([li, dr]);
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({ externalId: "Drushim:9", alsoSeenOn: ["LinkedIn"] });
    expect(merged).toEqual([{ kept: "Drushim:9", dropped: ["LinkedIn:1"] }]);
  });

  it("with no direct link, keeps the fuller description", () => {
    const a = job({ externalId: "LinkedIn:1", description: "x".repeat(50) });
    const b = job({ externalId: "Drushim:9", source: "Drushim", applyUrl: "https://www.drushim.co.il/job/9", description: "y".repeat(500) });
    expect(dedupe([a, b]).unique[0].externalId).toBe("Drushim:9");
  });

  it("collapses a repeated externalId (same source, same job)", () => {
    const first = job({ description: "old" });
    const again = job({ description: "a longer, newer description" });
    const { unique } = dedupe([first, again]);
    expect(unique).toHaveLength(1);
    expect(unique[0].description).toBe("a longer, newer description");
  });

  it("keeps two different openings with the same title at the same company and city", () => {
    const a = job({ externalId: "LinkedIn:1" });
    const b = job({ externalId: "LinkedIn:2", sourceJobId: "2" });
    expect(dedupe([a, b]).unique).toHaveLength(2);
  });

  it("pairs openings across sources one to one", () => {
    const li1 = job({ externalId: "LinkedIn:1" });
    const li2 = job({ externalId: "LinkedIn:2" });
    const dr1 = job({ externalId: "Drushim:1", source: "Drushim" });
    const { unique } = dedupe([li1, li2, dr1]);
    expect(unique).toHaveLength(2); // 2 distinct openings, one of them seen on both sites
  });

  it("does not merge different companies, titles, or places", () => {
    const base = job({});
    expect(dedupe([base, job({ externalId: "D:1", source: "Drushim", company: "Navina" })]).unique).toHaveLength(2);
    expect(dedupe([base, job({ externalId: "D:2", source: "Drushim", title: "Solution Architect" })]).unique).toHaveLength(2);
    expect(dedupe([base, job({ externalId: "D:3", source: "Drushim", city: "Holon", location: "Holon" })]).unique).toHaveLength(2);
  });

  it("treats all fully remote copies as the same place", () => {
    const a = job({ officeRequirement: "Fully remote", city: null, location: "Remote" });
    const b = job({ externalId: "D:1", source: "Drushim", officeRequirement: "Fully remote", city: null, location: "Anywhere" });
    expect(dedupe([a, b]).unique).toHaveLength(1);
  });

  it("isDirectCompanyUrl", () => {
    expect(isDirectCompanyUrl("https://jfrog.com/careers/1")).toBe(true);
    expect(isDirectCompanyUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe(true);
    expect(isDirectCompanyUrl("https://www.linkedin.com/jobs/view/1")).toBe(false);
    expect(isDirectCompanyUrl("https://il.linkedin.com/jobs/view/1")).toBe(false);
    expect(isDirectCompanyUrl("https://www.drushim.co.il/job/1")).toBe(false);
    expect(isDirectCompanyUrl(null)).toBe(false);
  });

  it("classify splits new jobs from ones already in Airtable", () => {
    const a = job({ externalId: "LinkedIn:1" });
    const b = job({ externalId: "LinkedIn:2" });
    const { fresh, seen } = classify([a, b], new Set(["LinkedIn:1"]));
    expect(fresh.map((j) => j.externalId)).toEqual(["LinkedIn:2"]);
    expect(seen.map((j) => j.externalId)).toEqual(["LinkedIn:1"]);
  });
});

describe("toAirtableFields", () => {
  it("writes only what the pipeline knows, and the initial status for new jobs", () => {
    const f = toAirtableFields(job({}), { today: "2026-11-15", isNew: true });
    expect(f).toMatchObject({
      Title: "Senior Product Manager",
      Company: "JFrog",
      "Favorite Company": true,
      "Office Requirement": "Hybrid",
      "Location OK": true,
      Source: "LinkedIn",
      "External ID": "LinkedIn:1",
      "First Seen": "2026-11-15",
      "Last Seen": "2026-11-15",
      Status: "New",
      "Job Language": "English",
      "Posted Date": "2026-11-12",
    });
    // matching-stage fields are never written here
    for (const k of ["Match %", "Match Rationale", "CV Suggestions", "Skill Gaps", "Recommended CV", "Notes", "Applied Date"]) {
      expect(f).not.toHaveProperty(k);
    }
  });

  it("existing jobs only refresh Last Seen: never reset Status or First Seen", () => {
    const f = toAirtableFields(job({}), { today: "2026-11-16", isNew: false });
    expect(f["Last Seen"]).toBe("2026-11-16");
    expect(f).not.toHaveProperty("Status");
    expect(f).not.toHaveProperty("First Seen");
  });

  it("omits empty optional values and caps very long descriptions", () => {
    const f = toAirtableFields(job({ applyUrl: null, language: null, postedDate: null, description: "x".repeat(60_000) }), {
      today: "2026-11-15",
      isNew: true,
    });
    expect(f).not.toHaveProperty("Apply URL");
    expect(f).not.toHaveProperty("Job Language");
    expect(f).not.toHaveProperty("Posted Date");
    expect((f.Description as string).length).toBe(50_000);
  });
});
