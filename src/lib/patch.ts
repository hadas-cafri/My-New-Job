import { STATUSES, type JobPatch, type Status } from "./types";

/** Whitelist: only status / notes / appliedDate can be written from the dashboard. */
export function parsePatch(body: unknown): JobPatch | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: JobPatch = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status as Status)) return null;
    patch.status = b.status as Status;
  }
  if (b.notes !== undefined) {
    if (typeof b.notes !== "string" || b.notes.length > 5000) return null;
    patch.notes = b.notes;
  }
  if (b.appliedDate !== undefined) {
    if (b.appliedDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.appliedDate))) return null;
    patch.appliedDate = b.appliedDate as string | null;
  }
  return Object.keys(patch).length ? patch : null;
}
