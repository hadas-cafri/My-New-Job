"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_FILTERS, filterJobs, matchPercent, sortJobs, type Filters } from "@/lib/jobs";
import { STATUSES, STATUS_LABELS, type Job, type Status } from "@/lib/types";

type Load =
  | { state: "loading" }
  | { state: "no_token" }
  | { state: "error"; text: string }
  | { state: "ready"; jobs: Job[]; fetchedAt: string };

const OFFICE_LABELS: Record<string, string> = {
  "Daily office": "משרד יומי",
  Hybrid: "היברידי",
  "Fully remote": "מרוחק לגמרי",
  Unknown: "לא ידוע",
};

export default function Dashboard() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const fetchJobs = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await fetch("/api/jobs");
      if (res.status === 401) return setLoad({ state: "no_token" });
      if (!res.ok) return setLoad({ state: "error", text: "לא הצלחתי לטעון משרות מ-Airtable." });
      const data = await res.json();
      setLoad({ state: "ready", jobs: data.jobs, fetchedAt: data.fetchedAt });
    } catch {
      setLoad({ state: "error", text: "שגיאת רשת." });
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const jobs = load.state === "ready" ? load.jobs : [];
  const visible = useMemo(() => sortJobs(filterJobs(jobs, filters)), [jobs, filters]);
  const sources = useMemo(
    () => [...new Set(jobs.map((j) => j.source).filter((s): s is string => !!s))],
    [jobs],
  );

  const lastUpdated = useMemo(() => {
    const seen = jobs.map((j) => j.lastSeen).filter((d): d is string => !!d);
    return seen.length ? seen.sort().at(-1)! : null;
  }, [jobs]);

  async function changeStatus(job: Job, status: Status) {
    const appliedDate =
      status === "Applied" && !job.appliedDate ? new Date().toISOString().slice(0, 10) : undefined;
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(appliedDate ? { appliedDate } : {}) }),
    });
    if (!res.ok) return alert("העדכון נכשל");
    const { job: updated } = (await res.json()) as { job: Job };
    setLoad((cur) =>
      cur.state === "ready"
        ? { ...cur, jobs: cur.jobs.map((j) => (j.id === updated.id ? updated : j)) }
        : cur,
    );
  }

  if (load.state === "loading") return <p className="muted pad">טוען משרות…</p>;

  if (load.state === "no_token") {
    return (
      <section className="panel">
        <h1>עוד לא התחברת ל-Airtable</h1>
        <p>כדי לראות משרות, הזיני טוקן בדף ההגדרות.</p>
        <Link className="btn" href="/settings">
          להגדרות
        </Link>
      </section>
    );
  }

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
        <select value={filters.status} onChange={(e) => set("status", e.target.value as Filters["status"])}>
          <option value="active">פעילות</option>
          <option value="all">הכול</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={filters.source} onChange={(e) => set("source", e.target.value)}>
          <option value="">כל המקורות</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
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
        <p className="panel">
          אין עדיין משרות. הטבלה תתמלא בריצה הראשונה של האיסוף.
        </p>
      )}

      <ul className="cards">
        {visible.map((job) => (
          <JobCard key={job.id} job={job} onStatus={changeStatus} />
        ))}
      </ul>
    </>
  );
}

function JobCard({ job, onStatus }: { job: Job; onStatus: (j: Job, s: Status) => void }) {
  const pct = matchPercent(job);
  return (
    <li className="card">
      <div className="card-head">
        <div>
          <h3>{job.title}</h3>
          <p className="company">
            {job.favoriteCompany && <span title="חברה מועדפת">★ </span>}
            {job.company}
            {job.domain && job.domain !== "Other" && <span className="pill"> {job.domain}</span>}
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
          aria-label="סטטוס"
          value={job.status}
          onChange={(e) => onStatus(job, e.target.value as Status)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {job.recommendedCv && <span className="pill">קו״ח: {job.recommendedCv}</span>}
        {job.applyUrl && (
          <a className="btn" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
            הגשה
          </a>
        )}
      </div>

      <details>
        <summary>פרטים והצעות לשיפור קו״ח</summary>
        <Section title="למה ההתאמה הזו" text={job.rationale} />
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
