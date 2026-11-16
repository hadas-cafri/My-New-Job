import { containsPhrase, foldForMatch, stripGenderMarkers } from "./text";
import { isTargetRole } from "./roles";
import type { NormalizedJob } from "./types";

/**
 * First-pass screening of a job from its title and company only (no model, no cost).
 * "Fit" jobs are shown first in the dashboard, "Maybe" normally, "Not fit" not at all (unless asked for).
 * The rules are the user's (spec §7); the lists below are meant to be edited as she corrects them.
 */
export type Triage = "Fit" | "Maybe" | "Not fit";

/** Title words that rule a job out: seniority above the target, technical roles, cloud / security / hardware. */
const NOT_FIT_TITLE = [
  "principal", "staff", "tpm", "technical", "engineer", "cisco", "customs",
  "security", "secure", "cyber", "grc", "iam", "cloud", "aws", "azure", "gcp", "devops", "networking", "infra", "presales", "pre sales", "uas",
  "טכני", "טכנית", "טכניים", "טכנולוגי", "טכנולוגית", "טכנולוגיים", "סייבר", "הסייבר", "אבטחת", "האבטחת", "אבטחה", "האבטחה", "עמילות מכס", "הנדסת מכונות", "לא דיגיטלי",
];

/** Companies whose product roles need cloud / security / hardware / defense / logistics knowledge. */
const NOT_FIT_COMPANY = [
  "palo alto networks", "zenity", "island", "akamai", "upwind", "esentire", "apono", "torq", "ionix", "bigid", "cyera", "silverfort",
  "scaleops", "pointfive", "finout", "drivenets", "nvidia", "mobileye", "elbit", "d fend", "applied materials", "newphotonics",
  "ingram micro", "maersk", "terasky", "mongodb", "amazon web services", "servicenow",
];

/** Anonymous postings and recruitment agencies: nothing is known about the real job, so "Maybe". */
const UNKNOWN_EMPLOYER = [
  "חסוי", "confidential", "השמה", "גיוס", "משאבי אנוש", "talent", "recruit", "recruitment", "staffing", "jobgether",
  "experis", "pentasia", "directeam", "gotfriends", "yael group", "ashley digital", "אביבית",
];

/** Titles above or beside the usual Product Manager role: worth a look, not a favorite. */
const UNUSUAL_LEVEL = ["group", "founding", "head of", "director", "vp", "vice president"];

const FINANCE = ["financial", "finance", "fintech", "bank", "פיננסי", "פיננסים", "פינטק", "בנק", "ביטוח"];

const has = (folded: string, words: string[]) => words.some((w) => containsPhrase(folded, foldForMatch(w)));

export function triageJob(job: Pick<NormalizedJob, "title" | "company">): { triage: Triage; reason: string } {
  const title = foldForMatch(stripGenderMarkers(job.title));
  const company = foldForMatch(job.company);

  if (has(title, NOT_FIT_TITLE)) return { triage: "Not fit", reason: "technical, senior-level, cloud or security role" };
  if (has(company, NOT_FIT_COMPANY)) return { triage: "Not fit", reason: "company in a cloud, security or hardware field" };

  const unknownEmployer = has(company, UNKNOWN_EMPLOYER);
  if (isTargetRole(job.title, ["Product Manager"])) {
    if (unknownEmployer) return { triage: "Maybe", reason: "anonymous employer or recruitment agency" };
    if (has(title, UNUSUAL_LEVEL)) return { triage: "Maybe", reason: "unusual level (group / founding / head)" };
    return { triage: "Fit", reason: "product manager role" };
  }
  if (isTargetRole(job.title, ["Solution Architect", "Solution Specialist"])) {
    if (!unknownEmployer && (has(title, FINANCE) || has(company, FINANCE))) return { triage: "Fit", reason: "solution architect in finance" };
    return { triage: "Maybe", reason: "solution architect" };
  }
  return { triage: "Maybe", reason: "no clear signal" };
}
