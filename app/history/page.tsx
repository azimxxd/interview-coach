"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  clearSessionHistory,
  getSessionHistory,
  type SessionHistoryEntry
} from "@/lib/storage/history";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<SessionHistoryEntry[]>(() => getSessionHistory());
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);

  const selected = useMemo(() => {
    if (!selectedId) return entries[0] ?? null;
    return entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  }, [entries, selectedId]);

  const clearHistory = () => {
    if (!window.confirm("Clear all interview history? This cannot be undone.")) {
      return;
    }
    clearSessionHistory();
    setEntries([]);
    setSelectedId(null);
  };

  if (!entries.length) {
    return (
      <main className="page">
        <section className="card stack">
          <h1>Interview history</h1>
          <p className="tiny">No completed sessions yet.</p>
          <Link className="btn btn-primary" href="/">
            Start interview
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page two-col">
      <section className="card stack">
        <div className="controls">
          <h1>Interview history</h1>
          <button className="btn btn-ghost" type="button" onClick={clearHistory}>
            Clear history
          </button>
        </div>
        <div className="stack">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`btn btn-ghost ${entry.id === selected?.id ? "is-active" : ""}`}
              onClick={() => setSelectedId(entry.id)}
            >
              <span>
                {formatDate(entry.savedAt)} · {entry.session.settings.category} · {entry.session.settings.interviewType}
              </span>
              <strong>{entry.overallScore.toFixed(2)} / 5</strong>
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <section className="card stack">
          <h2>Session details</h2>
          <p className="tiny">
            {formatDate(selected.savedAt)} · {selected.session.settings.category} · {selected.session.settings.difficulty} · {selected.session.settings.questionCount} questions
          </p>

          {selected.session.summary && (
            <div className="summary-recommendation">
              <strong>Summary</strong>
              <p className="tiny">
                Overall: {selected.session.summary.overallScore.toFixed(2)} / 5
              </p>
              <p className="tiny">
                Next set: {selected.session.summary.recommendedNextConfig.category} · {selected.session.summary.recommendedNextConfig.interviewType} · {selected.session.summary.recommendedNextConfig.difficulty}
              </p>
            </div>
          )}

          <div className="stack">
            {selected.session.turns.map((turn, index) => (
              <article key={turn.id} className="rubric-card">
                <strong>
                  Q{index + 1}: {turn.question}
                </strong>
                <p className="tiny">Answer: {turn.transcript || "-"}</p>

                {turn.rubric && (
                  <div className="rubric-grid">
                    {Object.entries(turn.rubric.scores).map(([key, value]) => (
                      <div key={key} className="rubric-score-pill">
                        <span>{key}</span>
                        <strong>{value}/5</strong>
                      </div>
                    ))}
                  </div>
                )}

                {turn.followups.length > 0 && (
                  <div className="stack">
                    <strong>Follow-ups</strong>
                    {turn.followups.map((followup, followupIndex) => (
                      <div key={followup.id} className="followup-item">
                        <span>
                          F{followupIndex + 1}: {followup.question}
                        </span>
                        <small>{followup.transcript || "-"}</small>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
