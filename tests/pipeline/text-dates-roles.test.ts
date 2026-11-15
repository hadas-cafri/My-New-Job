import { describe, expect, it } from "vitest";
import { parsePostedDate } from "@/pipeline/dates";
import { expandRoles, isTargetRole, parseRoleList } from "@/pipeline/roles";
import { cleanText, containsPhrase, foldForMatch, shortHash, stripGenderMarkers } from "@/pipeline/text";

describe("text", () => {
  it("cleanText turns HTML into tidy plain text", () => {
    const html = "<p>About&nbsp;us &amp; the role</p><ul><li>Lead roadmap</li><li>Work with R&amp;D</li></ul><br/>Apply now";
    // a list is separated from the text after it by one blank line
    expect(cleanText(html)).toBe("About us & the role\n- Lead roadmap\n- Work with R&D\n\nApply now");
  });

  it("cleanText collapses whitespace and handles non-strings", () => {
    expect(cleanText("  a   b \n\n\n\n c  ")).toBe("a b\n\nc");
    expect(cleanText(undefined)).toBe("");
    expect(cleanText(42)).toBe("");
  });

  it("foldForMatch removes apostrophes, punctuation and Hebrew vowel marks", () => {
    expect(foldForMatch("Be'er Sheva")).toBe("beer sheva");
    expect(foldForMatch("Tel-Aviv, Israel")).toBe("tel aviv israel");
    expect(foldForMatch('ראשל"צ')).toBe("ראשלצ");
    expect(foldForMatch("שָׁלוֹם")).toBe("שלום");
  });

  it("containsPhrase matches whole words only", () => {
    expect(containsPhrase("senior product manager", "product manager")).toBe(true);
    expect(containsPhrase("lodz poland", "lod")).toBe(false);
  });

  it("stripGenderMarkers", () => {
    expect(stripGenderMarkers("מנהל/ת מוצר בכיר/ה")).toBe("מנהל מוצר בכיר");
    expect(stripGenderMarkers("מנהל.ת מוצר")).toBe("מנהל מוצר");
    expect(stripGenderMarkers("מנהל/ ת מוצר")).toBe("מנהל מוצר");
    expect(stripGenderMarkers("Product Manager (m/f/d)")).toBe("Product Manager ");
  });

  it("shortHash is stable and sensitive to input", () => {
    expect(shortHash("a|b")).toBe(shortHash("a|b"));
    expect(shortHash("a|b")).not.toBe(shortHash("a|c"));
  });
});

describe("parsePostedDate", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("parses absolute dates", () => {
    expect(parsePostedDate("2026-11-10", now)).toBe("2026-11-10");
    expect(parsePostedDate("2026-11-10T08:30:00.000Z", now)).toBe("2026-11-10");
    expect(parsePostedDate("15/11/2026", now)).toBe("2026-11-15"); // day first
    expect(parsePostedDate("3.2.2026", now)).toBe("2026-02-03");
    expect(parsePostedDate(Date.UTC(2026, 10, 1), now)).toBe("2026-11-01"); // ms
    expect(parsePostedDate(Math.floor(Date.UTC(2026, 10, 1) / 1000), now)).toBe("2026-11-01"); // seconds
  });

  it("parses English relative dates", () => {
    expect(parsePostedDate("3 days ago", now)).toBe("2026-11-12");
    expect(parsePostedDate("1 week ago", now)).toBe("2026-11-08");
    expect(parsePostedDate("2 hours ago", now)).toBe("2026-11-15");
    expect(parsePostedDate("an hour ago", now)).toBe("2026-11-15");
    expect(parsePostedDate("yesterday", now)).toBe("2026-11-14");
    expect(parsePostedDate("Today", now)).toBe("2026-11-15");
  });

  it("parses Hebrew relative dates", () => {
    expect(parsePostedDate("לפני 3 ימים", now)).toBe("2026-11-12");
    expect(parsePostedDate("לפני שבוע", now)).toBe("2026-11-08");
    expect(parsePostedDate("לפני יומיים", now)).toBe("2026-11-13");
    expect(parsePostedDate("לפני שבועיים", now)).toBe("2026-11-01");
    expect(parsePostedDate("אתמול", now)).toBe("2026-11-14");
    expect(parsePostedDate("היום", now)).toBe("2026-11-15");
  });

  it("returns null for empty or impossible values", () => {
    expect(parsePostedDate("", now)).toBeNull();
    expect(parsePostedDate(null, now)).toBeNull();
    expect(parsePostedDate("2026-02-31", now)).toBeNull();
    expect(parsePostedDate("whenever", now)).toBeNull();
    expect(parsePostedDate({}, now)).toBeNull();
  });
});

describe("target roles", () => {
  it.each([
    "Product Manager",
    "Senior Product Manager, Platform",
    "Sr. Product Manager - AI",
    "Solution Architect",
    "Solutions Architect (Pre-Sales)",
    "Solution Specialist",
    "מנהל/ת מוצר",
    "מנהלת מוצר בכיר/ה",
    "ארכיטקט/ית פתרונות",
    "Product Manager (m/f/d)",
    'מנהל.ת מוצר בתפ"י', // dot spelling, seen on Drushim
    "מנהל/ ת מוצר", // space before the ת
  ])("matches: %s", (title) => expect(isTargetRole(title)).toBe(true));

  it.each([
    "Product Marketing Manager",
    "Software Engineer",
    "Project Manager",
    "Product Designer",
    "Account Executive",
    "",
  ])("does not match: %s", (title) => expect(isTargetRole(title)).toBe(false));

  it("applies a blocklist when one is given", () => {
    expect(isTargetRole("Product Manager Intern", undefined, ["intern"])).toBe(false);
    expect(isTargetRole("Product Manager", undefined, ["intern"])).toBe(true);
    expect(isTargetRole("Product Manager Intern")).toBe(true); // empty by default
  });

  it("reads the Profile cell format and expands Hebrew/plural spellings", () => {
    expect(parseRoleList("Product Manager, Senior Product Manager,\nSolution Architect ")).toEqual([
      "Product Manager",
      "Senior Product Manager",
      "Solution Architect",
    ]);
    expect(expandRoles(["Solution Architect"])).toContain("solutions architect");
    expect(isTargetRole("מנהל מוצר", ["Product Manager"])).toBe(true);
    expect(isTargetRole("Solution Architect", ["Product Manager"])).toBe(false);
  });
});
