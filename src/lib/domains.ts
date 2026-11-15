/**
 * Industries a job's company can belong to. The matching step picks one per job.
 * Add a line here to add a domain: the dashboard label and the model's instructions follow.
 * (Airtable's `Domain` select creates the new option on the first write with typecast.)
 */
export const DOMAINS = [
  { value: "Biotech", he: "ביוטק", hint: "drug discovery, genomics, life-science tools" },
  { value: "Medtech", he: "מדטק", hint: "medical devices, digital health, clinical decision tools" },
  { value: "Telco", he: "טלקום", hint: "telecommunications, network operators and equipment, 5G, connectivity" },
  { value: "Fintech", he: "פינטק", hint: "payments, banking and insurance tech, trading, lending, crypto" },
  { value: "Cybersecurity", he: "סייבר", hint: "security products and services" },
  { value: "AI & Data", he: "AI ודאטה", hint: "AI/ML platforms, data infrastructure, analytics, AI-native products" },
  { value: "Enterprise Software", he: "תוכנה ארגונית", hint: "B2B software / SaaS / developer and DevOps tools that fit no other domain" },
  { value: "E-commerce & Retail", he: "מסחר וקמעונאות", hint: "online marketplaces, retail, consumer commerce" },
  { value: "Mobility & Automotive", he: "תחבורה ורכב", hint: "vehicles, mobility, transportation tech" },
  { value: "Energy & Cleantech", he: "אנרגיה וקלינטק", hint: "energy, utilities, climate and clean technology" },
  { value: "Defense & Gov", he: "ביטחון וממשל", hint: "defense industry, government and public-sector projects" },
  { value: "Industrial & Logistics", he: "תעשייה ולוגיסטיקה", hint: "traditional industry, manufacturing, shipping, supply chain" },
  { value: "Real Estate", he: "נדל״ן", hint: "real estate, property tech, construction" },
  { value: "Media & Gaming", he: "מדיה וגיימינג", hint: "media, content, advertising, games" },
  { value: "Education", he: "חינוך", hint: "education and learning" },
  { value: "Other", he: "אחר", hint: "anything that fits none of the above" },
] as const;

export type Domain = (typeof DOMAINS)[number]["value"];

/**
 * Domains the user prefers. They raise a job's PRIORITY in the dashboard.
 * They never change the match score, which measures fit to the requirements only.
 */
export const PREFERRED_DOMAINS: readonly Domain[] = ["Biotech", "Medtech"];

export const isDomain = (v: unknown): v is Domain => DOMAINS.some((d) => d.value === v);

export const isPreferredDomain = (domain: string | null | undefined): boolean =>
  PREFERRED_DOMAINS.some((d) => d === domain);

/** Hebrew label for display; unknown values are shown as written. */
export const domainLabel = (domain: string): string => DOMAINS.find((d) => d.value === domain)?.he ?? domain;
