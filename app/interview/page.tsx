"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import VideoPanel from "@/components/VideoPanel";
import MetricsPanel from "@/components/MetricsPanel";
import ChatPanel from "@/components/ChatPanel";
import { useMediaStream } from "@/hooks/useMediaStream";
import { useAudioMetrics } from "@/hooks/useAudioMetrics";
import { useFaceMetrics } from "@/hooks/useFaceMetrics";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useVoiceInterviewer } from "@/hooks/useVoiceInterviewer";
import { getTopicForStep } from "@/lib/interview/topics";
import { useUi } from "@/components/UiProvider";
import { computeConfidenceOverall } from "@/lib/metrics/confidence";
import type { UiCopyKey } from "@/lib/i18n";
import {
  createSession,
  getSession,
  getSettings,
  saveSettings,
  saveSession,
  type DeliverySignals,
  type InterviewSession,
  type InterviewSettings,
  type InterviewTurn
} from "@/lib/storage/session";

type InterviewStatus =
  | "idle"
  | "asking"
  | "answering"
  | "evaluating"
  | "next"
  | "finished";

const FILLERS = ["um", "uh", "like", "you know", "sort of"];

function countWords(text: string) {
  return text
    .trim()
    .split(/[\s,.!?;:"'()]+/)
    .filter(Boolean).length;
}

function countFillers(text: string) {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[\s,.!?;:"'()]+/).filter(Boolean);
  let count = 0;
  for (const filler of FILLERS) {
    if (filler.includes(" ")) {
      const occurrences = lower.split(filler).length - 1;
      count += Math.max(0, occurrences);
    } else {
      count += tokens.filter((token) => token === filler).length;
    }
  }
  return count;
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function createTurn(topic: string, question: string): InterviewTurn {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return {
    id,
    topic,
    question,
    transcript: "",
    signals: {
      wpm: 0,
      pauses_sec: 0,
      filler_count: 0,
      eye_contact_pct: 0,
      smile_proxy: 0
    }
  };
}

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
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateNextFocus(turns: InterviewTurn[]) {
  const counts = new Map<string, number>();
  turns.forEach((turn) => {
    turn.evaluation?.next_focus?.forEach((item) => {
      if (!item) return;
      counts.set(item, (counts.get(item) ?? 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([item]) => item)
    .slice(0, 6);
}

function uniqueImprovements(turns: InterviewTurn[]) {
  const items = new Set<string>();
  turns.forEach((turn) => {
    turn.evaluation?.improvements?.forEach((item) => {
      if (item) items.add(item);
    });
  });
  return Array.from(items).slice(0, 6);
}

export default function InterviewPage() {
  const router = useRouter();
  const { t } = useUi();
  const [session, setSession] = useState<InterviewSession>(() => {
    const stored = getSession();
    if (stored) return stored;
    return createSession(getSettings());
  });
  const [phase, setPhase] = useState<"setup" | "interview">(() =>
    session.turns.length > 0 && !session.finishedAt ? "interview" : "setup"
  );
  const [draftSettings, setDraftSettings] = useState<InterviewSettings>(() => ({
    ...getSettings(),
    language: "EN"
  }));
  const [status, setStatus] = useState<InterviewStatus>(() => {
    if (session.turns.length > 0) {
      const last = session.turns[session.turns.length - 1];
      return last.evaluation ? "next" : "next";
    }
    return "idle";
  });
  const [isAnswering, setIsAnswering] = useState(false);
  const [answerStartedAt, setAnswerStartedAt] = useState<number | null>(null);
  const [answerElapsed, setAnswerElapsed] = useState(0);
  const [showSummary, setShowSummary] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, error, request } = useMediaStream();
  const audio = useAudioMetrics(stream, isAnswering);
  const face = useFaceMetrics(videoRef, isAnswering);
  const speech = useSpeechToText(session.settings.language);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const voiceEnabled = true;
  const voice = useVoiceInterviewer({
    enabled: voiceEnabled,
    stream,
    onWarning: () => {
      setVoiceWarning(t("voiceServerUnavailable"));
    }
  });

  useEffect(() => {
    if (voice.status === "ready") {
      setVoiceWarning(null);
    }
  }, [voice.status]);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    if (!isAnswering || !answerStartedAt) return;
    const interval = window.setInterval(() => {
      setAnswerElapsed(
        Math.max(0, Math.floor((Date.now() - answerStartedAt) / 1000))
      );
    }, 250);
    return () => window.clearInterval(interval);
  }, [isAnswering, answerStartedAt]);

  const liveTranscript = useMemo(() => {
    const combined = [speech.transcript, speech.interimTranscript]
      .filter(Boolean)
      .join(" ")
      .trim();
    return combined;
  }, [speech.transcript, speech.interimTranscript]);

  const liveWordCount = useMemo(
    () => countWords(liveTranscript),
    [liveTranscript]
  );

  const wpm = useMemo(() => {
    if (!answerStartedAt) return 0;
    const minutes = answerElapsed / 60;
    if (minutes <= 0) return 0;
    return liveWordCount / minutes;
  }, [answerElapsed, answerStartedAt, liveWordCount]);

  const fillerCount = useMemo(
    () => countFillers(liveTranscript),
    [liveTranscript]
  );

  const totalQuestions = session.settings.questionCount;

  const handleBeginInterview = () => {
    const settings: InterviewSettings = {
      ...draftSettings,
      language: "EN"
    };
    saveSettings(settings);
    const freshSession = createSession(settings);
    saveSession(freshSession);
    setSession(freshSession);
    setStatus("idle");
    setPhase("interview");
    setIsAnswering(false);
    setAnswerElapsed(0);
    setAnswerStartedAt(null);
    audio.reset();
    speech.reset();
    setShowSummary(false);
    setVoiceWarning(null);
  };

  const handleNewSession = () => {
    setPhase("setup");
    setShowSummary(false);
    setStatus("idle");
    setIsAnswering(false);
    setAnswerElapsed(0);
    setAnswerStartedAt(null);
    audio.reset();
    speech.reset();
    setDraftSettings((prev) => ({
      ...getSettings(),
      language: "EN",
      storeLocal: prev.storeLocal
    }));
  };

  const handleNextQuestion = async () => {
    if (status === "asking" || status === "answering" || status === "evaluating") {
      return;
    }
    if (session.turns.length >= totalQuestions) return;
    if (session.turns.some((turn) => !turn.evaluation)) return;
    if (!voice.isReady) {
      setVoiceWarning(t("voiceServerUnavailable"));
      return;
    }

    setStatus("asking");
    const topic = getTopicForStep(session.settings, session.turns.length);
    const previous = session.turns.slice(-2).map((turn) => ({
      question: turn.question,
      answer: turn.transcript
    }));

    const result = await voice.requestQuestion({
      role: session.settings.role,
      level: session.settings.level,
      topic,
      previous
    });

    const questionText = result.text?.trim() ?? "";
    if (!questionText) {
      setVoiceWarning(t("voiceServerUnavailable"));
      setStatus("next");
      return;
    }

    setVoiceWarning(null);
    const newTurn = createTurn(topic, questionText);
    setSession((prev) => ({
      ...prev,
      turns: [...prev.turns, newTurn]
    }));
    setStatus("next");
  };

  const handleStartAnswer = async () => {
    if (!session.turns.length) return;
    if (status !== "next") return;
    const granted = await request();
    if (!granted) return;
    audio.reset();
    speech.reset();
    setAnswerElapsed(0);
    setAnswerStartedAt(Date.now());
    setIsAnswering(true);
    speech.start();
    if (voice.isReady) {
      voice.reset();
      voice.startCapture();
    }
    setStatus("answering");
  };

  const handleStopEvaluate = async () => {
    if (status !== "answering") return;
    setStatus("evaluating");
    setIsAnswering(false);
    speech.stop();
    if (voice.isReady) {
      voice.stopCapture();
    }

    const transcript = liveTranscript.trim();
    const signals: DeliverySignals = {
      wpm: Number.isFinite(wpm) ? Number(wpm.toFixed(1)) : 0,
      pauses_sec: Number(audio.pauseSeconds.toFixed(1)),
      filler_count: fillerCount,
      eye_contact_pct: Number(face.eyeContactPct.toFixed(1)),
      smile_proxy: Number(face.smileProxy.toFixed(2)),
      duration_sec: Math.max(0, answerElapsed)
    };

    const lastIndex = session.turns.length - 1;
    const currentTurn = session.turns[lastIndex];
    let evaluation = null;
    try {
      const res = await fetch("/api/ai/evaluator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: session.settings.role,
          level: session.settings.level,
          language: session.settings.language,
          question: currentTurn.question,
          transcript,
          signals
        })
      });
      evaluation = await res.json();
    } catch {
      evaluation = null;
    }

    setSession((prev) => {
      const updated = [...prev.turns];
      if (updated[lastIndex]) {
        updated[lastIndex] = {
          ...updated[lastIndex],
          transcript,
          signals,
          evaluation: evaluation ?? undefined
        };
      }
      return { ...prev, turns: updated };
    });

    if (session.turns.length >= totalQuestions) {
      setStatus("finished");
    } else {
      setStatus("next");
    }
  };

  const handleFinish = () => {
    setSession((prev) => ({
      ...prev,
      finishedAt: new Date().toISOString()
    }));
    setStatus("finished");
    setShowSummary(true);
  };

  const canFinish =
    session.turns.length >= totalQuestions &&
    session.turns.every((turn) => Boolean(turn.evaluation));

  const averages = useMemo(() => {
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
  }, [session.turns]);

  const scoreLabels = useMemo(
    () => ({
      clarity: t("scoreClarity"),
      depth: t("scoreDepth"),
      evidence: t("scoreEvidence"),
      tradeoffs: t("scoreTradeoffs"),
      relevance: t("scoreRelevance"),
      delivery: t("scoreDelivery")
    }),
    [t]
  );

  const totalScore = useMemo(() => {
    const scoreValues: number[] = [];
    session.turns.forEach((turn) => {
      const scores = turn.evaluation?.scores;
      if (!scores) return;
      SCORE_KEYS.forEach((key) => scoreValues.push(scores[key]));
    });
    const avg = average(scoreValues);
    return Math.round((avg / 5) * 100);
  }, [session.turns]);

  const confidenceOverall = useMemo(() => {
    if (!session.turns.length) return null;
    return computeConfidenceOverall(session.turns);
  }, [session.turns]);

  const speechStats = useMemo(() => {
    const turns = session.turns.filter((turn) => turn.signals);
    return {
      answered: turns.length,
      avgWpm: average(turns.map((turn) => turn.signals?.wpm ?? 0)),
      avgFillers: average(turns.map((turn) => turn.signals?.filler_count ?? 0)),
      avgPauses: average(turns.map((turn) => turn.signals?.pauses_sec ?? 0))
    };
  }, [session.turns]);

  const focusAreas = useMemo(
    () => aggregateNextFocus(session.turns),
    [session.turns]
  );

  const improvements = useMemo(
    () => uniqueImprovements(session.turns),
    [session.turns]
  );

  const confidenceHintKeys = useMemo<UiCopyKey[]>(() => {
    if (!confidenceOverall) return [];
    const components = confidenceOverall.components;
    const items: Array<{ value: number; hint: UiCopyKey }> = [
      { value: components.wpmScore, hint: "confidenceHintPace" },
      { value: components.fillerScore, hint: "confidenceHintFillers" },
      { value: components.pauseScore, hint: "confidenceHintPauses" }
    ];
    const sorted = [...items].sort((a, b) => a.value - b.value);
    const low = sorted.filter((item) => item.value < 0.8);
    const picked = (low.length ? low : sorted.slice(0, 1)).slice(0, 3);
    return picked.map((item) => item.hint);
  }, [confidenceOverall]);

  if (phase === "setup") {
    return (
      <main className="page page-tight">
        <section className="setup-page">
          <div className="card setup-card stack">
            <span className="badge">{t("brandBadge")}</span>
            <h1>{t("setupTitle")}</h1>
            <p className="tiny">{t("setupSubtitle")}</p>
            <div className="form-grid">
              <label>
                {t("roleLabel")}
                <select
                  value={draftSettings.role}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      role: e.target.value as InterviewSettings["role"]
                    }))
                  }
                >
                  <option value="Frontend">{t("roleFrontend")}</option>
                  <option value="PM">{t("rolePM")}</option>
                </select>
              </label>
              <label>
                {t("levelLabel")}
                <select
                  value={draftSettings.level}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      level: e.target.value as InterviewSettings["level"]
                    }))
                  }
                >
                  <option value="Junior">{t("levelJunior")}</option>
                  <option value="Mid">{t("levelMid")}</option>
                  <option value="Senior">{t("levelSenior")}</option>
                </select>
              </label>
              <label>
                {t("questionCountLabel")}
                <select
                  value={draftSettings.questionCount}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      questionCount: Number(e.target.value)
                    }))
                  }
                >
                  <option value={5}>{t("questionsShort")}</option>
                  <option value={8}>{t("questionsStandard")}</option>
                  <option value={12}>{t("questionsDeep")}</option>
                </select>
              </label>
            </div>
            <div className="controls">
              <button
                className="btn btn-primary"
                onClick={handleBeginInterview}
                disabled={!voice.isReady}
              >
                {t("setupStart")}
              </button>
            </div>
            {voiceEnabled && voice.status === "connecting" && (
              <p className="tiny">{t("voiceConnecting")}</p>
            )}
            {voiceWarning && <p className="tiny">{voiceWarning}</p>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page page-tight">
      <div className="interview-grid">
        <div className="interview-meta stack">
          <span className="badge">
            {session.settings.role} - {session.settings.level} - {totalQuestions}Q
          </span>
          <h1>{t("interviewSessionTitle")}</h1>
          <p className="tiny">{t("interviewDisclaimer")}</p>
          {voiceEnabled && voice.status === "connecting" && (
            <p className="tiny">{t("voiceConnecting")}</p>
          )}
          {voiceEnabled && voice.isPlaying && (
            <p className="tiny">{t("voicePlayingQuestion")}</p>
          )}
          {voiceWarning && <p className="tiny">{voiceWarning}</p>}
        </div>

        <div className="interview-timer">
          <div className="card timer-card">
            <h3>{t("answerTimerTitle")}</h3>
            <p className="timer">{formatTimer(answerElapsed)}</p>
            <p className="tiny">{t("answerTimerHint")}</p>
          </div>
        </div>

        <div className="interview-logo">
          <div className="logo-block">
            <span className="brand-dot" />
            <div>
              <p className="logo-title">Interview Coach</p>
              <p className="tiny">PersonaPlex</p>
            </div>
          </div>
        </div>

        <div className="interview-left stack">
          <VideoPanel
            stream={stream}
            videoRef={videoRef}
            onRequestPermissions={request}
            error={error}
            isCalibrating={face.isCalibrating}
          />
          <MetricsPanel
            rms={audio.rms}
            wpm={wpm}
            pauseSeconds={audio.pauseSeconds}
            fillerCount={fillerCount}
            isCalibrating={face.isCalibrating}
          />
          <div className="card stack transcript-card">
            <h3>{t("transcriptTitle")}</h3>
            <p className="tiny">
              {speech.isSupported
                ? t("transcriptHintSupported")
                : t("transcriptHintUnsupported")}
            </p>
            <textarea
              rows={6}
              value={speech.isListening ? liveTranscript : speech.transcript}
              onChange={(e) => speech.setManualTranscript(e.target.value)}
              disabled={speech.isListening}
              placeholder={t("transcriptPlaceholder")}
            />
          </div>
        </div>

        <div className="interview-center" />

        <div className="interview-right stack">
          <ChatPanel
            turns={session.turns}
            status={status}
            totalQuestions={totalQuestions}
            onNextQuestion={handleNextQuestion}
            onStartAnswer={handleStartAnswer}
            onStopEvaluate={handleStopEvaluate}
            onFinish={handleFinish}
            isListening={speech.isListening}
            canFinish={canFinish}
          />
        </div>
      </div>

      {showSummary && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowSummary(false)}
        >
          <div
            className="modal summary-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>{t("summaryTitle")}</h2>
                <p className="tiny">{t("summarySubtitle")}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t("summaryClose")}
                onClick={() => setShowSummary(false)}
              >
                X
              </button>
            </div>

            <section className="summary-grid">
              <div className="score-card summary-total">
                <h4>{t("summaryTotalScore")}</h4>
                <p>{Number.isFinite(totalScore) ? totalScore : 0}</p>
              </div>
              <div className="score-card">
                <h4>{t("summaryQuestions")}</h4>
                <p>{speechStats.answered}</p>
              </div>
              <div className="score-card">
                <h4>{t("summaryAvgWpm")}</h4>
                <p>{speechStats.avgWpm.toFixed(0)}</p>
              </div>
              <div className="score-card">
                <h4>{t("summaryAvgFillers")}</h4>
                <p>{speechStats.avgFillers.toFixed(1)}</p>
              </div>
              <div className="score-card">
                <h4>{t("summaryAvgPauses")}</h4>
                <p>{speechStats.avgPauses.toFixed(1)}</p>
              </div>
              <div className="score-card">
                <h4>{t("summaryConfidence")}</h4>
                <p>{confidenceOverall ? confidenceOverall.score : t("confidenceNA")}</p>
              </div>
            </section>

            <section className="card stack">
              <h3>{t("averageScores")}</h3>
              <div className="score-grid">
                {SCORE_KEYS.map((key) => (
                  <div key={key} className="score-card">
                    <h4>{scoreLabels[key]}</h4>
                    <p>{averages[key]?.toFixed(1) ?? "0.0"}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="card stack">
              <h3>{t("summaryFeedbackTitle")}</h3>
              <div className="summary-feedback">
                <div>
                  <h4>{t("confidenceWhyTitle")}</h4>
                  {confidenceHintKeys.length ? (
                    <ul>
                      {confidenceHintKeys.map((item) => (
                        <li key={item}>{t(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="tiny">{t("confidenceNA")}</p>
                  )}
                </div>
                <div>
                  <h4>{t("topFocusAreas")}</h4>
                  {focusAreas.length ? (
                    <ul>
                      {focusAreas.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="tiny">{t("noFocusAreas")}</p>
                  )}
                </div>
                {improvements.length ? (
                  <div>
                    <h4>{t("issuesLabel")}</h4>
                    <ul>
                      {improvements.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>

            <div className="controls">
              <button className="btn btn-ghost" onClick={handleNewSession}>
                {t("summaryNewSession")}
              </button>
              <button className="btn btn-primary" onClick={() => router.push("/report")}>
                {t("summaryViewReport")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
