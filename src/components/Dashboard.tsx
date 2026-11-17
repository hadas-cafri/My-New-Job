"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AirtableError, createClient } from "@/lib/airtable";
import { domainLabel, isPreferredDomain } from "@/lib/domains";
import { descriptionBlocks } from "@/lib/format";
import { DEFAULT_FILTERS, filterJobs, matchPercent, sortJobs, type Filters } from "@/lib/jobs";
import { STATUSES, STATUS_LABELS, type Job, type Status } from "@/lib/types";
import { useConnection } from "./ConnectionProvider";

type Load =
  | { state: "loading" }
  | { state: "error"; text: string }
  | { state: "ready"; jobs: Job[]; fetchedAt: string };

const OFFICE_LABELS: Record<string, string> = {
  "Daily office": "משרד יומי",
  Hybrid: "היברידי",
  "Fully remote": "מרוחק לגמרי",
  Unknown: "לא ידוע",
};

export function Dashboard() {
  const { conn, ready } = useConnection();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [undo, setUndo] = useState<{ id: string; title: string; previous: Status } | null>(null);

  // The undo bar disappears by itself after a few seconds.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(t);
  }, [undo]);

  const fetchJobs = useCallback(async () => {
    if (!conn) return;
    setLoad({ state: "loading" });
    try {
      const jobs = await createClient(conn).listJobs();
      setLoad({ state: "ready", jobs, fetchedAt: new Date().toISOString() });
    } catch (err) {
      const status = err instanceof AirtableError ? err.status : 0;
      const text =
        status === 401 || status === 403
          ? "Airtable דחה את המפתח. פתחי את 'חיבור ל-Airtable' והזיני מפתח מחדש."
          : status === 0
            ? "אין חיבור לרשת או ש-Airtable לא נגיש."
            : `לא הצלחתי לטעון משרות מ-Airtable (${status}).`;
      setLoad({ state: "error", text });
    }
  }, [conn]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const jobs = load.state === "ready" ? load.jobs : [];
  const hasScores = jobs.some((j) => j.match !== null); // sorting / filtering by score only makes sense once jobs have scores
  const visible = useMemo(() => sortJobs(filterJobs(jobs, filters), filters.sort), [jobs, filters]);
  const sources = useMemo(
    () => [...new Set(jobs.map((j) => j.source).filter((s): s is string => !!s))],
    [jobs],
  );
  const lastUpdated = useMemo(() => {
    const seen = jobs.map((j) => j.lastSeen).filter((d): d is string => !!d);
    return seen.length ? seen.sort().at(-1)! : null;
  }, [jobs]);

  /** One tap: the job leaves the list; the user can undo for a few seconds. */
  async function quickNotRelevant(job: Job) {
    const previous = job.status;
    const ok = await changeStatus(job, "Not relevant");
    if (ok) setUndo({ id: job.id, title: job.title, previous });
  }

  async function undoNotRelevant() {
    if (!undo) return;
    const { id, previous } = undo;
    setUndo(null);
    const job = load.state === "ready" ? load.jobs.find((j) => j.id === id) : undefined;
    if (job) await changeStatus(job, previous);
  }

  async function changeStatus(job: Job, status: Status): Promise<boolean> {
    if (!conn) return false;
    const appliedDate =
      status === "Applied" && !job.appliedDate ? new Date().toISOString().slice(0, 10) : undefined;
    try {
      const updated = await createClient(conn).updateJob(job.id, {
        status,
        ...(appliedDate ? { appliedDate } : {}),
      });
      setLoad((cur) =>
        cur.state === "ready"
          ? { ...cur, jobs: cur.jobs.map((j) => (j.id === updated.id ? updated : j)) }
          : cur,
      );
      return true;
    } catch {
      alert("העדכון נכשל. בדקי שלמפתח יש הרשאת כתיבה (data.records:write).");
      return false;
    }
  }

  async function toggleCvRequest(job: Job) {
    if (!conn) return;
    try {
      const updated = await createClient(conn).updateJob(job.id, {
        cvSuggestionsRequested: !job.cvSuggestionsRequested,
      });
      setLoad((cur) =>
        cur.state === "ready"
          ? { ...cur, jobs: cur.jobs.map((j) => (j.id === updated.id ? updated : j)) }
          : cur,
      );
    } catch {
      alert("העדכון נכשל. ייתכן שחסר ב-Airtable השדה 'CV Suggestions Requested', או שלמפתח אין הרשאת כתיבה.");
    }
  }

  if (!ready) return null;
  if (!conn) {
    return <p className="panel">כדי לראות משרות, הזיני מפתח Airtable בחלונית &quot;חיבור ל-Airtable&quot; למעלה.</p>;
  }
  if (load.state === "loading") return <p className="muted pad">טוען משרות…</p>;
  if (load.state === "error") {
    return (
      <section className="panel">
        <p className="msg error">{load.text}</p>
        <button onClick={fetchJobs}>נסי שוב</button>
      </section>
    );
  }

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <>
      <div className="stamp">
        עודכן לאחרונה: {lastUpdated ?? "—"} · נטען {new Date(load.fetchedAt).toLocaleTimeString("he-IL")}{" "}
        <button className="link" onClick={fetchJobs}>
          רענון
        </button>
      </div>

      <section className="filters" aria-label="סינון">
        <input
          type="search"
          placeholder="חיפוש: תפקיד, חברה, מיקום"
          value={filters.query}
          onChange={(e) => set("query", e.target.value)}
        />
        <select
          aria-label="סטטוס"
          value={filters.status}
          onChange={(e) => set("status", e.target.value as Filters["status"])}
        >
          <option value="active">פעילות</option>
          <option value="all">הכול</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select aria-label="מקור" value={filters.source} onChange={(e) => set("source", e.target.value)}>
          <option value="">כל המקורות</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="מיון"
          value={filters.sort}
          onChange={(e) => set("sort", e.target.value as Filters["sort"])}
        >
          <option value="newest">מיון: חדשות קודם</option>
          {hasScores && <option value="fit">מיון: לפי ציון התאמה לקו״ח</option>}
          <option value="priority">מיון: ★ חברות מטרה קודם</option>
        </select>
        {hasScores && (
          <label className="inline">
            ציון התאמה מעל {filters.minMatch}%
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={filters.minMatch}
              onChange={(e) => set("minMatch", Number(e.target.value))}
            />
          </label>
        )}
        <select
          aria-label="תצוגה"
          value={filters.view}
          onChange={(e) => set("view", e.target.value as Filters["view"])}
        >
          <option value="all">תצוגה: כל המשרות</option>
          <option value="favorites">תצוגה: רק משרות שנראות מתאימות לפי הכותרת</option>
        </select>
        <select
          aria-label="תאריך פרסום"
          value={filters.maxAgeDays}
          onChange={(e) => set("maxAgeDays", Number(e.target.value))}
        >
          <option value={7}>פורסמו ב-7 הימים האחרונים</option>
          <option value={14}>פורסמו ב-14 הימים האחרונים</option>
          <option value={30}>פורסמו ב-30 הימים האחרונים</option>
          <option value={0}>כל התאריכים</option>
        </select>
        <label className="inline">
          <input
            type="checkbox"
            checked={filters.locationOkOnly}
            onChange={(e) => set("locationOkOnly", e.target.checked)}
          />
          רק משרות באזור ההגעה שלי (או מרוחקות)
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={filters.showHidden}
            onChange={(e) => set("showHidden", e.target.checked)}
          />
          הצג גם משרות שסוננו כלא מתאימות
        </label>
      </section>

      <p className="muted">
        {visible.length} משרות מתוך {jobs.length}
      </p>

      {jobs.length === 0 && (
        <p className="panel">אין עדיין משרות. הטבלה תתמלא בריצה הראשונה של האיסוף.</p>
      )}

      <ul className="cards">
        {visible.map((job) => (
          <JobCard key={job.id} job={job} onStatus={changeStatus} onCvRequest={toggleCvRequest} onNotRelevant={quickNotRelevant} />
        ))}
      </ul>

      {undo && (
        <div className="undo" role="status">
          <span>סומנה כלא רלוונטית: {undo.title}</span>
          <button type="button" onClick={undoNotRelevant}>
            בטלי
          </button>
        </div>
      )}
    </>
  );
}

function JobCard({
  job,
  onStatus,
  onCvRequest,
  onNotRelevant,
}: {
  job: Job;
  onStatus: (j: Job, s: Status) => void;
  onNotRelevant: (j: Job) => void;
  onCvRequest: (j: Job) => void;
}) {
  const pct = matchPercent(job);
  return (
    <li className="card">
      <div className="card-head">
        <div className="card-title">
          <h3>{job.title}</h3>
          <p className="company">
            {job.favoriteCompany && <span title="חברת מטרה">★ </span>}
            {job.company}
            {job.domain && job.domain !== "Other" && (
              <span className="pill" title={isPreferredDomain(job.domain) ? "תחום מטרה" : undefined}>
                {" "}
                {isPreferredDomain(job.domain) ? "★ " : ""}
                {domainLabel(job.domain)}
              </span>
            )}
          </p>
          <p className="muted">
            {job.location}
            {job.officeRequirement && ` · ${OFFICE_LABELS[job.officeRequirement] ?? job.officeRequirement}`}
            {job.source && ` · ${job.source}`}
          </p>
        </div>
        <div className={`score ${pct === null ? "none" : pct >= 80 ? "hi" : pct >= 60 ? "mid" : "lo"}`}>
          {pct === null ? "—" : `${pct}%`}
        </div>
      </div>

      <div className="row">
        <label className="inline">
          סטטוס:
          <select
            aria-label="סטטוס המשרה"
            value={job.status}
            onChange={(e) => onStatus(job, e.target.value as Status)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {job.triage === "Fit" && <span className="pill ok">נראית מתאימה</span>}
        {job.triage === "Not fit" && <span className="pill">סוננה כלא מתאימה</span>}
        {job.recommendedCv && job.cvSuggestions && <span className="pill">קו״ח בסיס: {job.recommendedCv}</span>}
        {!job.cvSuggestions && (
          <button
            type="button"
            className="btn"
            aria-pressed={job.cvSuggestionsRequested}
            onClick={() => onCvRequest(job)}
            title={job.cvSuggestionsRequested ? "לחצי לביטול הבקשה" : "גרסת הקו״ח המומלצת וההצעות יופקו רק למשרות שתבקשי"}
          >
            {job.cvSuggestionsRequested ? "✓ התבקשו הצעות (ביטול)" : "אני רוצה הצעות וגרסת קו״ח"}
          </button>
        )}
        {job.status !== "Not relevant" && (
          <button type="button" className="secondary" onClick={() => onNotRelevant(job)}>
            לא רלוונטית
          </button>
        )}
        {job.applyUrl && (
          <a className="btn" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
            הגשה
          </a>
        )}
      </div>

      <details>
        <summary>{job.cvSuggestions ? "פרטים והצעות לשיפור קו״ח" : "פרטים ותיאור המשרה"}</summary>
        <Section title="למה ההתאמה הזו" text={job.rationale} />
        <Section
          title="גרסת קו״ח מומלצת כבסיס"
          text={job.recommendedCv && job.cvSuggestions ? job.recommendedCv : ""}
        />
        <Section title="הצעות לשיפור קו״ח" text={job.cvSuggestions} />
        <Section title="פערים" text={job.skillGaps} />
        <Section title="מילות מפתח חסרות ל-ATS" text={job.missingKeywords} />
        {job.description && (
          <div className="section">
            <h4>תיאור המשרה</h4>
            <div className="desc" tabIndex={0} aria-label="תיאור המשרה (ניתן לגלול)">
              {descriptionBlocks(job.description).map((b, i) =>
                b.kind === "heading" ? <h5 key={i}>{b.text}</h5> : <p key={i}>{b.text}</p>,
              )}
            </div>
          </div>
        )}
        {job.notes && <Section title="הערות" text={job.notes} />}
      </details>
    </li>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  if (!text) return null;
  return (
    <div className="section">
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}
