export const STATUSES = [
  "New",
  "Saved",
  "Applied",
  "Interview",
  "Rejected",
  "Not relevant",
  "Closed",
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  New: "חדשה",
  Saved: "שמורה",
  Applied: "הוגשה",
  Interview: "ראיון",
  Rejected: "נדחתה",
  "Not relevant": "לא רלוונטית",
  Closed: "נסגרה",
};

/** Statuses shown by default ("active" filter). */
export const ACTIVE_STATUSES: Status[] = ["New", "Saved", "Applied", "Interview"];

export type Job = {
  id: string;
  title: string;
  company: string;
  favoriteCompany: boolean;
  location: string;
  officeRequirement: string | null;
  locationOk: boolean;
  description: string;
  applyUrl: string | null;
  /** Fraction 0..1 (Airtable percent field), null when not yet scored. */
  match: number | null;
  rationale: string;
  skillGaps: string;
  missingKeywords: string;
  cvSuggestions: string;
  /** The user ticked "I want CV suggestions for this job"; Claude writes them in the chat. */
  cvSuggestionsRequested: boolean;
  recommendedCv: string | null;
  domain: string | null;
  source: string | null;
  language: string | null;
  postedDate: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  status: Status;
  appliedDate: string | null;
  notes: string;
};

/** The only fields the dashboard may write back (spec §4): status, notes, applied date, CV-suggestions request. */
export type JobPatch = {
  status?: Status;
  notes?: string;
  appliedDate?: string | null;
  cvSuggestionsRequested?: boolean;
};
