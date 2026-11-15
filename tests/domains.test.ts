import { describe, expect, it } from "vitest";
import { DOMAINS, PREFERRED_DOMAINS, domainLabel, isDomain, isPreferredDomain } from "@/lib/domains";

describe("domains", () => {
  it("every domain has a unique value, a Hebrew label and a hint for the model; 'Other' is last", () => {
    const values = DOMAINS.map((d) => d.value);
    expect(new Set(values).size).toBe(values.length);
    for (const d of DOMAINS) {
      expect(d.he.length, d.value).toBeGreaterThan(0);
      expect(d.hint.length, d.value).toBeGreaterThan(10);
    }
    expect(values.at(-1)).toBe("Other");
  });

  it("includes the domains the user asked for: telco, fintech, and non-tech organizations such as banks", () => {
    for (const v of ["Telco", "Fintech", "Traditional Org"]) expect(isDomain(v), v).toBe(true);
    expect(domainLabel("Telco")).toBe("טלקום");
    expect(domainLabel("Fintech")).toBe("פינטק");
    expect(domainLabel("Traditional Org")).toBe("ארגון מסורתי");
  });

  it("tells fintech companies and traditional banks apart for the model", () => {
    const fintech = DOMAINS.find((d) => d.value === "Fintech")!.hint;
    const traditional = DOMAINS.find((d) => d.value === "Traditional Org")!.hint;
    expect(fintech).toMatch(/traditional bank or insurer is Traditional Org/);
    expect(traditional).toMatch(/bank/);
    expect(traditional).toMatch(/not technology/);
  });

  it("preferred domains are only Biotech and Medtech (the user said telco and fintech are not, for now)", () => {
    expect([...PREFERRED_DOMAINS]).toEqual(["Biotech", "Medtech"]);
    for (const d of PREFERRED_DOMAINS) expect(isDomain(d)).toBe(true);
    for (const d of ["Telco", "Fintech", "Traditional Org", "Other"]) expect(isPreferredDomain(d), d).toBe(false);
    expect(isPreferredDomain(null)).toBe(false);
  });

  it("unknown values are shown as written", () => {
    expect(domainLabel("Gardening")).toBe("Gardening");
    expect(isDomain("Gardening")).toBe(false);
  });
});
