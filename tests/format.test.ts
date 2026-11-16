import { describe, expect, it } from "vitest";
import { descriptionBlocks, formatDescription } from "@/lib/format";

describe("formatDescription: restores structure for flattened job descriptions", () => {
  it("splits glued section titles and sentences (real Microsoft text)", () => {
    const flat =
      "Microsoft Security is committed to making the world safer.ResponsibilitiesBecome a founding member and help shape its direction.Shape the product from day one.QualificationsYou have at least 10+ years of experience.Preferred QualificationsB.Sc./M.Sc. in Computer Science.";
    const out = formatDescription(flat);
    expect(out).toContain("\nResponsibilities\nBecome a founding member");
    expect(out).toContain("direction.\nShape the product");
    expect(out).toContain("\nQualifications\nYou have");
    expect(out).toContain("\nPreferred Qualifications\nB.Sc./M.Sc.");
    // the title is not cut in half ("Preferred Qualifications" must not become "Preferred" + "Qualifications")
    expect(out).not.toContain("Preferred \n");
  });

  it("handles a title that ends in a word (real Similarweb text)", () => {
    const out = formatDescription("About The RoleWe're looking for a PM.What You'll DoOwn the product strategy.Lead a team.What You Bring5+ years in product management.");
    expect(out).toContain("About The Role\nWe're looking");
    expect(out).toContain("What You'll Do\nOwn the product strategy.\nLead a team.");
    expect(out).toContain("What You Bring\n5+ years");
  });

  it("leaves names and abbreviations alone", () => {
    const text = "We use Node.js and LinkedIn and B2B SaaS, e.g. the iPhone app.";
    expect(formatDescription(text)).toBe(text);
  });

  it("leaves text that already has line breaks untouched", () => {
    const text = "Overview\nWe build things.\n\nResponsibilities\n- Lead the team\n- Ship\n- Measure\n- Learn";
    expect(formatDescription(text)).toBe(text);
  });

  it("empty input and Hebrew text are safe", () => {
    expect(formatDescription("")).toBe("");
    expect(formatDescription("אנחנו מגייסים מנהל מוצר. נדרש ניסיון של 5 שנים.")).toBe("אנחנו מגייסים מנהל מוצר. נדרש ניסיון של 5 שנים.");
  });
});

describe("descriptionBlocks", () => {
  it("marks section titles as headings and the rest as text", () => {
    const blocks = descriptionBlocks("OverviewWe build.ResponsibilitiesLead the team.");
    expect(blocks).toEqual([
      { kind: "heading", text: "Overview" },
      { kind: "text", text: "We build." },
      { kind: "heading", text: "Responsibilities" },
      { kind: "text", text: "Lead the team." },
    ]);
  });
});
