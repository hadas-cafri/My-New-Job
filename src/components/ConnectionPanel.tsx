"use client";

import { useEffect, useState } from "react";
import { AirtableError, createClient } from "@/lib/airtable";
import {
  describeConnectError,
  maskToken,
  validateIds,
  validateToken,
} from "@/lib/connection";
import { useConnection } from "./ConnectionProvider";

export function ConnectionPanel() {
  const { conn, ready, defaults, connect, forget } = useConnection();
  const [open, setOpen] = useState(true);
  const [token, setToken] = useState("");
  const [baseId, setBaseId] = useState(defaults.baseId);
  const [tableId, setTableId] = useState(defaults.tableId);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Once saved values are loaded: fill the form, and collapse the panel if already connected.
  useEffect(() => {
    if (!ready) return;
    setBaseId(defaults.baseId);
    setTableId(defaults.tableId);
    setRemember(defaults.remembered);
    setOpen(conn === null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = token.trim();
    const b = baseId.trim();
    const tb = tableId.trim();
    const problem = validateToken(t) ?? validateIds(b, tb);
    if (problem) return setMessage({ kind: "error", text: problem });

    setBusy(true);
    setMessage(null);
    try {
      await createClient({ token: t, baseId: b, tableId: tb }).ping();
      connect({ token: t, baseId: b, tableId: tb }, remember);
      setToken(""); // the form forgets it; the live copy stays in page memory only
      setOpen(false);
    } catch (err) {
      const status = err instanceof AirtableError ? err.status : 0;
      setMessage({ kind: "error", text: describeConnectError(status) });
    } finally {
      setBusy(false);
    }
  }

  function onForget() {
    forget();
    setToken("");
    setRemember(false);
    setOpen(true);
    setMessage({ kind: "ok", text: "המפתח נמחק מהדפדפן ומהזיכרון." });
  }

  return (
    <details
      className="connect"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        חיבור ל-Airtable{" "}
        {conn ? (
          <span className="pill ok">
            מחובר · <bdi dir="ltr">{maskToken(conn.token)}</bdi>
          </span>
        ) : (
          <span className="pill">לא מחובר</span>
        )}
      </summary>

      <form onSubmit={onSubmit} className="connect-form">
        <div className="fields">
          <label>
            מפתח API (Personal Access Token)
            <input
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="pat…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-label="מפתח API"
            />
          </label>
          <label>
            Base ID
            <input
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
            />
          </label>
          <label>
            Table ID
            <input
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
            />
          </label>
        </div>

        <label className="inline remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          לזכור את המפתח בדפדפן הזה
        </label>

        <div className="row">
          <button type="submit" disabled={busy || token.trim().length === 0}>
            {busy ? "בודק…" : "התחבר"}
          </button>
          <button type="button" className="secondary" onClick={onForget}>
            מחק מפתח שמור
          </button>
        </div>

        {message && (
          <p className={`msg ${message.kind}`} role="status">
            {message.text}
          </p>
        )}

        <p className="muted">
          המפתח לא נכתב בקובץ. הוא נשמר רק בזיכרון של הדף, או בדפדפן הזה אם סימנת &quot;לזכור&quot;.
          כדאי להגביל אותו לבסיס My New Job בלבד, עם הרשאות data.records:read ו-data.records:write.
        </p>
      </form>
    </details>
  );
}
