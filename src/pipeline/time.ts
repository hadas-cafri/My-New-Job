const IL = "Asia/Jerusalem";

/** YYYY-MM-DD in Israel (the date Airtable's `First Seen` / `Last Seen` should carry). */
export function israelToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IL, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
