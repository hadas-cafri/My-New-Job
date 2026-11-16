"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AirtableError, createClient } from "@/lib/airtable";
import { domainLabel, isPreferredDomain } from "@/lib/domains";
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
  const visible = useMemo(() => sortJobs(filterJobs(jobs, filters), filters.sort), [jobs, filters]);
  const sources = useMemo(
    () => [...new Set(jobs.map((j) => j.source).filter((s): s is string => !!s))],
    [jobs],
  );
  const lastUpdated = useMemo(() => {
    const seen = jobs.map((j) => j.lastSeen).filter((d): d is string => !!d);
    return seen.length ? seen.sort().at(-1)! : null;
  }, [jobs]);

  async function changeStatus(job: Job, status: Status) {
    if (!conn) return;
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
    } catch {
      alert("העדכון נכשל. בדקי שלמפתח יש הרשאת כתיבה (data.records:write).");
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
          <option value="fit">מיון: לפי התאמה</option>
          <option value="priority">מיון: עדיפות קודם</option>
        </select>
        <label className="inline">
          התאמה מעל {filters.minMatch}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minMatch}
            onChange={(e) => set("minMatch", Number(e.target.value))}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={filters.locationOkOnly}
            onChange={(e) => set("locationOkOnly", e.target.checked)}
          />
          מיקום מתאים בלבד
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
          <JobCard key={job.id} job={job} onStatus={changeStatus} onCvRequest={toggleCvRequest} />
        ))}
      </ul>
    </>
  );
}

function JobCard({
  job,
  onStatus,
  onCvRequest,
}: {
  job: Job;
  onStatus: (j: Job, s: Status) => void;
  onCvRequest: (j: Job) => void;
}) {
  const pct = matchPercent(job);
  return (
    <li className="card">
      <div className="card-head">
        <div className="card-title">
          <h3>{job.title}</h3>
          <p className="company">
            {job.favoriteCompany && <span title="חברה מועדפת">★ </span>}
            {job.company}
            {job.domain && job.domain !== "Other" && (
              <span className="pill" title={isPreferredDomain(job.domain) ? "תחום מועדף" : undefined}>
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
        {job.recommendedCv && <span className="pill">קו״ח בסיס: {job.recommendedCv}</span>}
        {!job.cvSuggestions && (
          <button
            type="button"
            className="btn"
            aria-pressed={job.cvSuggestionsRequested}
            onClick={() => onCvRequest(job)}
            title={job.cvSuggestionsRequested ? "לחצי לביטול הבקשה" : "הצעות יופקו רק למשרות שתבקשי"}
          >
            {job.cvSuggestionsRequested ? "✓ התבקשו הצעות (ביטול)" : "אני רוצה הצעות לקו״ח"}
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
        <Section title="תיאור המשרה" text={job.description} />
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
