import { describe, expect, it } from "vitest";
import { detectCountry, detectOfficeRequirement, hasNoPlace, isLocationOk, matchCity } from "@/pipeline/location";
import { CITIES } from "./fixtures";

const city = (loc: string) => matchCity(loc, CITIES)?.city ?? null;

describe("matchCity: spellings real sources use", () => {
  it.each([
    ["Herzliya, Tel Aviv District, Israel", "Herzliya"],
    ["Tel Aviv District, Israel", "Tel Aviv-Yafo"],
    ["Tel Aviv-Yafo", "Tel Aviv-Yafo"],
    ["Tel-Aviv, Israel", "Tel Aviv-Yafo"],
    ["Greater Tel Aviv", "Tel Aviv-Yafo"],
    ["Be'er Sheva, South District, Israel", "Beer Sheva"],
    ["Beersheba", "Beer Sheva"],
    ["Modi'in-Maccabim-Re'ut, Israel", "Modiin"],
    ["Petach Tikva", "Petah Tikva"],
    ["Petah Tikvah, Israel", "Petah Tikva"],
    ["Rishon Le Zion", "Rishon LeZion"],
    ["Ra'anana", "Raanana"],
    ["Kfar Sava", "Kfar Saba"],
    ["Ramat-Gan", "Ramat Gan"],
    ["Qiryat Gat", "Kiryat Gat"],
  ])("%s → %s", (loc, expected) => expect(city(loc)).toBe(expected));

  it.each([
    ["תל אביב", "Tel Aviv-Yafo"],
    ["תל-אביב יפו", "Tel Aviv-Yafo"],
    ["רמת גן", "Ramat Gan"],
    ["פתח תקוה", "Petah Tikva"], // spelled without the ו
    ["פתח תקווה", "Petah Tikva"],
    ['ראשל"צ', "Rishon LeZion"],
    ["קרית גת", "Kiryat Gat"],
    ["באר שבע", "Beer Sheva"],
    ["מודיעין-מכבים-רעות", "Modiin"],
    ["הרצליה פיתוח", "Herzliya"],
  ])("Hebrew %s → %s", (loc, expected) => expect(city(loc)).toBe(expected));

  it("does not match cities outside the approved list", () => {
    for (const loc of ["Haifa, Israel", "Jerusalem", "Rosh HaAyin", "Central District, Israel", "Israel", "", "חיפה"]) {
      expect(city(loc), loc).toBeNull();
    }
  });

  it("only the city segment counts, not the district after it", () => {
    expect(city("Rosh HaAyin, Tel Aviv District, Israel")).toBeNull();
    expect(city("Kadima, Central District")).toBeNull();
  });

  it("ignores inactive cities", () => {
    const inactive = CITIES.map((c) => (c.city === "Herzliya" ? { ...c, active: false } : c));
    expect(matchCity("Herzliya", inactive)).toBeNull();
  });

  it("does not match a longer word that merely contains a city name", () => {
    expect(city("Lodz, Poland")).toBeNull(); // "lod" must be a whole word
  });
});

describe("detectCountry", () => {
  it("recognizes Israel and foreign countries", () => {
    expect(detectCountry("Herzliya, Tel Aviv District, Israel")).toBe("Israel");
    expect(detectCountry("תל אביב, ישראל")).toBe("Israel");
    expect(detectCountry("London, United Kingdom")).toBe("United Kingdom");
    expect(detectCountry("Austin, Texas, United States")).toBe("United States");
    expect(detectCountry("Berlin, Berlin, Germany")).toBe("Germany");
  });

  it("does not guess when there is no country", () => {
    expect(detectCountry("Tel Aviv")).toBeNull();
    expect(detectCountry("Tel Aviv, Center")).toBeNull();
    expect(detectCountry("Remote")).toBeNull();
    expect(detectCountry("")).toBeNull();
  });
});

describe("detectOfficeRequirement", () => {
  const detect = (over: Partial<Parameters<typeof detectOfficeRequirement>[0]>) =>
    detectOfficeRequirement({ title: "Product Manager", location: "Tel Aviv", description: "", ...over });

  it("trusts the source's structured field first", () => {
    expect(detect({ structured: "Hybrid" })).toBe("Hybrid");
    expect(detect({ structured: "Remote" })).toBe("Fully remote");
    expect(detect({ structured: "On-site" })).toBe("Daily office");
    expect(detect({ structured: "היברידי" })).toBe("Hybrid");
    expect(detect({ remoteFlag: true })).toBe("Fully remote");
  });

  it("reads title and location wording", () => {
    expect(detect({ location: "Remote" })).toBe("Fully remote");
    expect(detect({ title: "Senior PM (Remote)" })).toBe("Fully remote");
    expect(detect({ title: "Product Manager - Hybrid" })).toBe("Hybrid");
    expect(detect({ location: "Tel Aviv (Hybrid)" })).toBe("Hybrid");
  });

  it("reads clear phrases in the description", () => {
    expect(detect({ description: "We work in a hybrid model, 3 days a week in the office." })).toBe("Hybrid");
    expect(detect({ description: "1-2 days in office" })).toBe("Hybrid");
    expect(detect({ description: "This is a fully remote position." })).toBe("Fully remote");
    expect(detect({ description: "We are remote-first." })).toBe("Fully remote");
    expect(detect({ description: "Office-based role in our Herzliya HQ." })).toBe("Daily office");
    expect(detect({ description: "משרה היברידית – 3 ימים בשבוע מהמשרד" })).toBe("Hybrid");
    expect(detect({ description: "אפשרות לעבודה מהבית" })).toBe("Fully remote");
  });

  it("hybrid wins when a description mentions both hybrid and remote", () => {
    expect(detect({ description: "Hybrid, with a fully remote option for some weeks" })).toBe("Hybrid");
  });

  it("a passing mention of 'remote' in the description is NOT enough", () => {
    expect(detect({ description: "You will manage a remote engineering team across time zones." })).toBe("Unknown");
    expect(detect({ description: "" })).toBe("Unknown");
  });
});

describe("isLocationOk (spec §2א)", () => {
  it("fully remote is OK anywhere, including outside Israel", () => {
    expect(isLocationOk("Fully remote", "Austin, Texas, United States", CITIES)).toBe(true);
    expect(isLocationOk("Fully remote", "Haifa", CITIES)).toBe(true);
    expect(isLocationOk("Fully remote", "", CITIES)).toBe(true);
  });

  it("daily office or hybrid needs an approved city", () => {
    for (const req of ["Daily office", "Hybrid"] as const) {
      expect(isLocationOk(req, "Ramat Gan, Tel Aviv District, Israel", CITIES)).toBe(true);
      expect(isLocationOk(req, "Haifa, Israel", CITIES)).toBe(false);
      expect(isLocationOk(req, "Jerusalem", CITIES)).toBe(false);
    }
  });

  it("outside Israel without full remote is never OK", () => {
    expect(isLocationOk("Hybrid", "London, United Kingdom", CITIES)).toBe(false);
    expect(isLocationOk("Daily office", "Berlin, Berlin, Germany", CITIES)).toBe(false);
  });

  it("unknown requirement: the city decides", () => {
    expect(isLocationOk("Unknown", "Holon", CITIES)).toBe(true);
    expect(isLocationOk("Unknown", "Haifa", CITIES)).toBe(false);
    expect(isLocationOk("Unknown", "Center District, Israel", CITIES)).toBe(false); // a region is a place, just not on the list
  });

  it("no location at all is included: empty, or just the country (seen on real LinkedIn jobs)", () => {
    for (const req of ["Daily office", "Hybrid", "Unknown"] as const) {
      expect(isLocationOk(req, "", CITIES), `${req}: empty`).toBe(true);
      expect(isLocationOk(req, "Israel", CITIES), `${req}: Israel`).toBe(true);
      expect(isLocationOk(req, "ישראל", CITIES), `${req}: ישראל`).toBe(true);
    }
  });

  it("but a missing city is not a free pass: a named place off the list, or another country, still fails", () => {
    expect(isLocationOk("Hybrid", "Haifa, Israel", CITIES)).toBe(false);
    expect(isLocationOk("Hybrid", "Center District, Israel", CITIES)).toBe(false);
    expect(isLocationOk("Daily office", "United States", CITIES)).toBe(false);
    expect(isLocationOk("Hybrid", "London, United Kingdom", CITIES)).toBe(false);
  });

  it("hasNoPlace", () => {
    expect(hasNoPlace("")).toBe(true);
    expect(hasNoPlace("  Israel ")).toBe(true);
    expect(hasNoPlace("Israel, ישראל")).toBe(true);
    expect(hasNoPlace("Tel Aviv, Israel")).toBe(false);
    expect(hasNoPlace("Center District, Israel")).toBe(false);
    expect(hasNoPlace("חיפה")).toBe(false);
  });
});
