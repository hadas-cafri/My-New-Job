const IL = "Asia/Jerusalem";

/** YYYY-MM-DD in Israel (the date Airtable's `First Seen` / `Last Seen` should carry). */
export function israelToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IL, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 0-23, Israel local time. */
export function israelHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: IL, hour: "numeric", hour12: false }).format(now);
  return Number(h) % 24;
}

/** The scheduled runs are at 08:00 and 18:00 Israel time. */
export const SCHEDULED_HOURS = [8, 18];

/**
 * GitHub's cron runs in UTC, and Israel's offset changes with daylight saving (+2 / +3).
 * The workflow therefore fires at both possible UTC hours and this check lets only the one that
 * lands on 08:00 or 18:00 Israel time do the work.
 */
export const isScheduledHour = (now: Date): boolean => SCHEDULED_HOURS.includes(israelHour(now));
