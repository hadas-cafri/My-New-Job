/**
 * Airtable connection details, entered by the user in the dashboard (as taught in class).
 *
 * - The token lives in page memory. It is written to localStorage ONLY when the user
 *   ticks "remember on this browser".
 * - Base ID / Table ID are not secrets; they are always remembered.
 * - Nothing here is ever written to a file or to git.
 */
export const DEFAULT_BASE_ID = "appAnHmtOjUfgQAcA";
export const DEFAULT_TABLE_ID = "tblyQ1DaQW5A7wJbA"; // Jobs

export type Connection = { token: string; baseId: string; tableId: string };

export type Saved = { token: string | null; baseId: string; tableId: string };

export const STORAGE_KEY = "mnj.connection.v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage can throw or be missing (private mode, blocked site data): never crash. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const DEFAULTS: Saved = { token: null, baseId: DEFAULT_BASE_ID, tableId: DEFAULT_TABLE_ID };

export function loadSaved(storage: StorageLike | null = browserStorage()): Saved {
  if (!storage) return DEFAULTS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Saved>;
    return {
      token: typeof p.token === "string" && p.token ? p.token : null,
      baseId: typeof p.baseId === "string" && p.baseId ? p.baseId : DEFAULT_BASE_ID,
      tableId: typeof p.tableId === "string" && p.tableId ? p.tableId : DEFAULT_TABLE_ID,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Saves the IDs always; saves the token only when `remember` is true. */
export function saveConnection(
  c: Connection,
  remember: boolean,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    const value: Saved = { token: remember ? c.token : null, baseId: c.baseId, tableId: c.tableId };
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the in-memory connection still works */
  }
}

/** "Delete saved key": removes the token, keeps the (non-secret) IDs. */
export function clearSavedToken(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    const cur = loadSaved(storage);
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, token: null }));
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing else to do */
    }
  }
}

export function validateIds(baseId: string, tableId: string): string | null {
  if (!/^app[A-Za-z0-9]{14}$/.test(baseId)) return "Base ID לא נראה תקין (מתחיל ב-app, 17 תווים).";
  if (!/^tbl[A-Za-z0-9]{14}$/.test(tableId)) return "Table ID לא נראה תקין (מתחיל ב-tbl, 17 תווים).";
  return null;
}

export function validateToken(token: string): string | null {
  if (token.length < 10 || /\s/.test(token)) return "המפתח נראה לא תקין. בדקי שהעתקת אותו במלואו.";
  return null;
}

/** Human-readable Hebrew message for a failed connection check. `status` 0 = network error. */
export function describeConnectError(status: number): string {
  if (status === 401) return "Airtable דחה את המפתח. בדקי שהעתקת אותו נכון ושלא פג תוקפו.";
  if (status === 403) return "למפתח אין הרשאה לבסיס הזה. ודאי שהוא כולל את הבסיס My New Job ואת ההרשאות data.records:read ו-data.records:write.";
  if (status === 404) return "לא נמצאו הבסיס או הטבלה. בדקי את Base ID ואת Table ID.";
  if (status === 429) return "יותר מדי בקשות ל-Airtable. נסי שוב בעוד רגע.";
  if (status === 0) return "אין חיבור לרשת, או ש-Airtable לא נגיש.";
  return `שגיאה מ-Airtable (${status}).`;
}

/** Safe-to-display form, e.g. "pat••••1234". */
export function maskToken(token: string): string {
  if (token.length <= 10) return "••••";
  return `${token.slice(0, 3)}••••${token.slice(-4)}`;
}
