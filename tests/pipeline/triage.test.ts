import { describe, expect, it } from "vitest";
import { triageJob, type Triage } from "@/pipeline/triage";

// Real titles and companies from the first run (public job postings), with the user's rules applied.
const CASES: [string, string, Triage][] = [
  // Fit: product manager roles at product companies / digital roles at banks and insurers
  ["Senior Product Manager, AI-Native Platform", "Similarweb", "Fit"],
  ["Product Manager - Wix Editor Platform", "Wix", "Fit"],
  ["Senior Product Manager", "Taboola", "Fit"],
  ["Product Manager", "Tailor Brands", "Fit"],
  ["מנהל.ת מוצר דיגיטל", 'מנורה מבטחים בע"מ', "Fit"],
  ["מנהל/ת מוצר דיגיטל - הובלת הטרנספורמציה הדיגיטלית", "מגדל ביטוח ופיננסים", "Fit"],
  ["DATA & AI PRODUCT MANAGER", "QPOINT Technologies", "Fit"],
  ["Financial Solution Architect", "Matrix", "Fit"],
  ["Solution Architect לארגון פיננסי מוביל באזור המרכז", "Jobist", "Fit"],
  // Not fit: principal / staff
  ["Principal Product Manager - AMI Platform", "BMC Software", "Not fit"],
  ["Staff Product Manager", "Guesty", "Not fit"],
  ["Sr Staff Product Manager (Armis/Veza)", "ServiceNow", "Not fit"],
  ["Senior Staff Product Manager, Bill Pay", "Intuit", "Not fit"],
  // Not fit: technical
  ["Technical Product Manager", "Rounds", "Not fit"],
  ["Senior Technical Product Manager", "Milestone Systems", "Not fit"],
  ["Product Manager / System Engineer", "Elbit Systems Israel", "Not fit"],
  ["דרוש/ה מנהל/ת מוצר טכנולוגי בכיר/ה", "QPOINT Technologies", "Not fit"],
  ["מנהל מוצר ופתרונות טכנולוגיים", 'יאמ שרפשטיין בע"מ', "Not fit"],
  // Not fit: cloud / security
  ["Senior Product Manager – Secure Browsing", "Akamai Technologies", "Not fit"],
  ["AWS Cloud Solution Architect", "חסוי", "Not fit"],
  ["Cyber Security Solution Architect", "Mobileye", "Not fit"],
  ["Senior Product Manager - GRC", "BMC Software", "Not fit"],
  ["מנהל/ת מוצר בעולם האבטחת מידע", "Visual D.G", "Not fit"],
  ["Senior Product Manager", "Island", "Not fit"], // company in a security field
  ["Product Manager - Agentic AI", "Torq", "Not fit"],
  ["Senior Product Manager", "PointFive", "Not fit"], // cloud cost optimization
  // Not fit: another field entirely
  ["Customs Product Manager, Israel", "Maersk", "Not fit"],
  ["מנהל/ת מוצר בתחום המיסוב - הנדסת מכונות", "חסוי", "Not fit"],
  ["Multi-Layer C-UAS - Product Manager", "D-Fend Solutions", "Not fit"],
  ["מנהל/ת מוצר(לא דיגיטלי) וערך לקוח-דיסקרטי", "פרוג'ובס", "Not fit"],
  ["Cisco Product Manager", "Bezeq International", "Not fit"],
  // Maybe: anonymous employer, recruiter, unusual level, other solution architects
  ["מנהל/ת מוצר", "חסוי", "Maybe"],
  ["Senior Product Manager & AI Builder- 245038", "Experis", "Maybe"],
  ["Product Manager", "Gotfriends", "Maybe"],
  ["Group Product Manager, Data Platforms", "Jobgether", "Maybe"],
  ["Founding Product Manager", "TReAT", "Maybe"],
  ["Salesforce Solution Architect", "comblack", "Maybe"],
];

describe("triageJob (the user's first-pass screening rules)", () => {
  it.each(CASES)("%s @ %s → %s", (title, company, expected) => {
    expect(triageJob({ title, company }).triage, `${title} @ ${company}`).toBe(expected);
  });

  it("always explains the decision", () => {
    for (const [title, company] of CASES) expect(triageJob({ title, company }).reason.length).toBeGreaterThan(3);
  });

  it("a job with no clear signal is Maybe, never hidden", () => {
    expect(triageJob({ title: "Business Analyst", company: "Acme" }).triage).toBe("Maybe");
  });

  it("whole words only: 'Staffing' or 'Principle' do not trigger the seniority rule", () => {
    expect(triageJob({ title: "Product Manager, Staffing Platform", company: "Acme" }).triage).toBe("Fit");
    expect(triageJob({ title: "Product Manager - Principle Design", company: "Acme" }).triage).toBe("Fit");
  });
});
