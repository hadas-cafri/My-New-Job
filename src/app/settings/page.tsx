"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { connected: boolean; masked?: string };

const ERRORS: Record<string, string> = {
  bad_format: "הטוקן נראה לא תקין. בדקי שהעתקת אותו במלואו.",
  invalid_token: "Airtable דחה את הטוקן. בדקי שיש לו הרשאות קריאה וכתיבה לבסיס My New Job.",
  airtable_error: "שגיאה בהתחברות ל-Airtable. נסי שוב בעוד רגע.",
  server_error: "שגיאת שרת. בדקי שהוגדר SESSION_SECRET.",
};

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/token");
    setStatus(res.ok ? await res.json() : { connected: false });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setToken(""); // the browser forgets the token immediately
      setStatus(data);
      setMessage({ kind: "ok", text: "מחובר ל-Airtable. אפשר לחזור לדף המשרות." });
    } else {
      setMessage({ kind: "error", text: ERRORS[data.error] ?? ERRORS.server_error });
    }
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/token", { method: "DELETE" });
    setBusy(false);
    setMessage({ kind: "ok", text: "התנתקת. הטוקן נמחק." });
    await load();
  }

  return (
    <section className="panel">
      <h1>הגדרות</h1>

      <h2>חיבור ל-Airtable</h2>
      {status === null ? (
        <p className="muted">טוען…</p>
      ) : status.connected ? (
        <p>
          <span className="pill ok">מחובר</span> <code dir="ltr">{status.masked}</code>
        </p>
      ) : (
        <p>
          <span className="pill">לא מחובר</span>
        </p>
      )}

      <form onSubmit={connect}>
        <label htmlFor="token">
          {status?.connected ? "החלפת טוקן" : "הדביקי כאן Personal Access Token של Airtable"}
        </label>
        <input
          id="token"
          type="password"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="pat…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <div className="row">
          <button type="submit" disabled={busy || token.length === 0}>
            {busy ? "בודק…" : "בדיקה ושמירה"}
          </button>
          {status?.connected && (
            <button type="button" className="secondary" onClick={disconnect} disabled={busy}>
              ניתוק
            </button>
          )}
        </div>
      </form>

      {message && <p className={`msg ${message.kind}`}>{message.text}</p>}

      <details>
        <summary>איך מייצרים טוקן?</summary>
        <ol>
          <li>airtable.com/create/tokens ← Create new token</li>
          <li>
            Scopes: <code dir="ltr">data.records:read</code> ו-<code dir="ltr">data.records:write</code>
          </li>
          <li>Access: הבסיס My New Job בלבד</li>
        </ol>
        <p className="muted">
          הטוקן נשלח לשרת ונשמר שם מוצפן בעוגייה (httpOnly). הדפדפן לא יכול לקרוא אותו בחזרה, וקריאות
          ל-Airtable עוברות רק דרך השרת.
        </p>
      </details>
    </section>
  );
}
