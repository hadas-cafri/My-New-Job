const DAY = 24 * 60 * 60 * 1000;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function validIso(s: string): string | null {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || ymd(d) !== s ? null : s;
}

const UNIT_MS: Record<string, number> = {
  minute: 60_000, hour: 3_600_000, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY,
  דקה: 60_000, דקות: 60_000, שעה: 3_600_000, שעות: 3_600_000, יום: DAY, ימים: DAY,
  שבוע: 7 * DAY, שבועות: 7 * DAY, חודש: 30 * DAY, חודשים: 30 * DAY,
};

/**
 * Posted date → "YYYY-MM-DD" (UTC), or null if it cannot be understood.
 * Handles ISO strings, Unix timestamps (s or ms), day-first dates (15/11/2026),
 * and relative text in English ("3 days ago") and Hebrew ("לפני 3 ימים", "אתמול").
 */
export function parsePostedDate(value: unknown, now: Date = new Date()): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" || (typeof value === "string" && /^\d{10,13}$/.test(value.trim()))) {
    const n = Number(value);
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : ymd(d);
  }
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();

  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return validIso(iso[1]);

  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) return validIso(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);

  if (/^(today|just now|now)$/.test(s) || s === "היום" || s === "עכשיו") return ymd(now);
  if (s === "yesterday" || s === "אתמול") return ymd(new Date(now.getTime() - DAY));

  const en = s.match(/(\d+|an?)\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (en) {
    const n = /^an?$/.test(en[1]) ? 1 : Number(en[1]);
    return ymd(new Date(now.getTime() - n * UNIT_MS[en[2]]));
  }

  // Hebrew duals: "לפני יומיים" (2 days), "לפני שבועיים" (2 weeks), "לפני חודשיים" (2 months)
  const dual: Record<string, number> = { יומיים: 2 * DAY, שבועיים: 14 * DAY, חודשיים: 60 * DAY, שעתיים: 2 * 3_600_000 };
  const du = s.match(/לפני\s*(יומיים|שבועיים|חודשיים|שעתיים)/);
  if (du) return ymd(new Date(now.getTime() - dual[du[1]]));

  const he = s.match(/לפני\s*(\d+)?\s*(דקות|דקה|שעות|שעה|ימים|יום|שבועות|שבוע|חודשים|חודש)/);
  if (he) return ymd(new Date(now.getTime() - Number(he[1] ?? 1) * UNIT_MS[he[2]]));

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : ymd(new Date(parsed));
}
