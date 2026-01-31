"use client";

import { useMemo } from "react";
import Link from "next/link";
import { getSession, type InterviewTurn } from "@/lib/storage/session";
import { useUi } from "@/components/UiProvider";
import type { UiCopyKey } from "@/lib/i18n";
import { computeConfidenceOverall, computeConfidenceTurn } from "@/lib/metrics/confidence";

const SCORE_KEYS = [
  "clarity",
  "depth",
  "evidence",
  "tradeoffs",
  "relevance",
  "delivery"
] as const;

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function aggregateNextFocus(turns: InterviewTurn[]) {
  const counts = new Map<string, number>();
  turns.forEach((turn) => {
    turn.evaluation?.next_focus?.forEach((item) => {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([item]) => item)
    .slice(0, 6);
}

export default function ReportPage() {
  const session = getSession();
  const { t } = useUi();

  const averages = useMemo(() => {
    if (!session) return {};
    const values: Record<string, number[]> = {};
    SCORE_KEYS.forEach((key) => {
      values[key] = [];
    });
    session.turns.forEach((turn) => {
      const scores = turn.evaluation?.scores;
      if (!scores) return;
      SCORE_KEYS.forEach((key) => {
        values[key].push(scores[key]);
      });
    });
    const result: Record<string, number> = {};
    SCORE_KEYS.forEach((key) => {
      result[key] = average(values[key]);
    });
    return result;
  }, [session]);

  const confidenceOverall = useMemo(() => {
    if (!session) return null;
    return computeConfidenceOverall(session.turns);
  }, [session]);

  const confidenceByTurn = useMemo(() => {
    if (!session) return new Map<string, { score: number; durationSec: number }>();
    const map = new Map<string, { score: number; durationSec: number }>();
    session.turns.forEach((turn) => {
      const durationSec = Math.max(0, Number(turn.signals?.duration_sec ?? 0));
      const result = computeConfidenceTurn({
        wpm: turn.signals?.wpm,
        filler_count: turn.signals?.filler_count,
        pauses_sec: turn.signals?.pauses_sec ?? 0,
        duration_sec: durationSec
      });
      map.set(turn.id, { score: result.score, durationSec });
    });
    return map;
  }, [session]);

  const confidenceHintKeys = useMemo(() => {
    if (!confidenceOverall) return [];
    const components = confidenceOverall.components;
    const items: Array<{ key: string; value: number; hint: UiCopyKey }> = [
      { key: "wpmScore", value: components.wpmScore, hint: "confidenceHintPace" },
      {
        key: "fillerScore",
        value: components.fillerScore,
        hint: "confidenceHintFillers"
      },
      { key: "pauseScore", value: components.pauseScore, hint: "confidenceHintPauses" }
    ];
    const sorted = [...items].sort((a, b) => a.value - b.value);
    const low = sorted.filter((item) => item.value < 0.8);
    const picked = (low.length ? low : sorted.slice(0, 1)).slice(0, 3);
    return picked.map((item) => item.hint);
  }, [confidenceOverall]);

  if (!session) {
    return (
      <main className="page">
        <div className="card stack">
          <h1>{t("noReportTitle")}</h1>
          <p className="tiny">{t("noReportBody")}</p>
          <Link className="btn btn-primary" href="/">
            {t("backToStart")}
          </Link>
        </div>
      </main>
    );
  }

  const scoreLabels = {
    clarity: t("scoreClarity"),
    depth: t("scoreDepth"),
    evidence: t("scoreEvidence"),
    tradeoffs: t("scoreTradeoffs"),
    relevance: t("scoreRelevance"),
    delivery: t("scoreDelivery")
  } as const;

  const focusAreas = aggregateNextFocus(session.turns);
  const confidenceAvailable =
    confidenceOverall && confidenceOverall.notes.totalDuration > 0;

  return (
    <main className="page">
      <header className="stack" style={{ marginBottom: "24px" }}>
        <span className="badge">{t("finalReportBadge")}</span>
        <h1>{t("interviewFeedbackTitle")}</h1>
        <p className="tiny">{t("reportIntro")}</p>
      </header>

      <section className="card stack" style={{ marginBottom: "24px" }}>
        <h2>{t("averageScores")}</h2>
        <div className="score-grid">
          {SCORE_KEYS.map((key) => (
            <div key={key} className="score-card">
              <h4>{scoreLabels[key]}</h4>
              <p>{averages[key]?.toFixed(1) ?? "0.0"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack" style={{ marginBottom: "24px" }}>
        <h2>{t("confidenceScoreTitle")}</h2>
        <p className="tiny">{t("confidenceScoreSubtitle")}</p>
        <div className="score-grid">
          <div className="score-card">
            <h4>{t("tableConfidence")}</h4>
            <p>{confidenceAvailable ? confidenceOverall?.score : t("confidenceNA")}</p>
          </div>
        </div>
        <div className="divider" />
        <h3>{t("confidenceWhyTitle")}</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <h4>{t("confidenceComponentWpm")}</h4>
            <p>
              {confidenceAvailable
                ? `${Math.round((confidenceOverall?.components.wpmScore ?? 0) * 100)}%`
                : t("confidenceNA")}
            </p>
          </div>
          <div className="metric-card">
            <h4>{t("confidenceComponentFillers")}</h4>
            <p>
              {confidenceAvailable
                ? `${Math.round((confidenceOverall?.components.fillerScore ?? 0) * 100)}%`
                : t("confidenceNA")}
            </p>
          </div>
          <div className="metric-card">
            <h4>{t("confidenceComponentPauses")}</h4>
            <p>
              {confidenceAvailable
                ? `${Math.round((confidenceOverall?.components.pauseScore ?? 0) * 100)}%`
                : t("confidenceNA")}
            </p>
          </div>
        </div>
        {confidenceAvailable && confidenceHintKeys.length > 0 ? (
          <ul>
            {confidenceHintKeys.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card stack" style={{ marginBottom: "24px" }}>
        <h2>{t("perQuestionDetail")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t("tableQuestion")}</th>
              <th>{t("tableSummary")}</th>
              <th>{t("tableDelivery")}</th>
              <th>{t("tableConfidence")}</th>
            </tr>
          </thead>
          <tbody>
            {session.turns.map((turn) => (
              <tr key={turn.id}>
                <td>
                  {turn.question}
                </td>
                <td>
                  {turn.evaluation?.summary
                    ? turn.evaluation.summary
                    : "-"}
                </td>
                <td>{turn.evaluation?.scores.delivery ?? "-"}</td>
                <td>
                  {(() => {
                    const entry = confidenceByTurn.get(turn.id);
                    if (!entry) return t("confidenceNA");
                    return entry.durationSec > 0 ? entry.score : t("confidenceNA");
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card stack">
        <h2>{t("topFocusAreas")}</h2>
        {focusAreas.length ? (
          <ul>
            {focusAreas.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="tiny">{t("noFocusAreas")}</p>
        )}
      </section>
    </main>
  );
}
