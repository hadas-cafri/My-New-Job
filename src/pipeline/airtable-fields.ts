import type { NormalizedJob } from "./types";

const MAX_DESCRIPTION = 50_000;

/**
 * Airtable field values for a job. Match %, rationale, CV suggestions etc. are NOT included:
 * they are written later by the matching step.
 * `isNew` adds First Seen and the initial status; existing rows only get Last Seen refreshed.
 */
export function toAirtableFields(
  job: NormalizedJob,
  opts: { today: string; isNew: boolean },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: job.title,
    Company: job.company,
    "Favorite Company": job.favoriteCompany,
    Location: job.location,
    "Office Requirement": job.officeRequirement,
    "Location OK": job.locationOk,
    Description: job.description.slice(0, MAX_DESCRIPTION),
    Source: job.source,
    "External ID": job.externalId,
    "Last Seen": opts.today,
  };
  if (job.applyUrl) fields["Apply URL"] = job.applyUrl;
  if (job.language) fields["Job Language"] = job.language;
  if (job.postedDate) fields["Posted Date"] = job.postedDate;
  if (opts.isNew) {
    fields["First Seen"] = opts.today;
    fields["Status"] = "New";
  }
  return fields;
}
