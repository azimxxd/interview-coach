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
import {
  createSession,
  getSession,
  getSettings,
  saveSession,
  type DeliverySignals,
  type InterviewSession,
  type InterviewTurn
} from "@/lib/storage/session";

type InterviewStatus =
  | "idle"
  | "asking"
  | "answering"
  | "evaluating"
  | "next"
  | "finished";

const TOTAL_QUESTIONS = 8;

const FILLERS = {
  EN: ["um", "uh", "like", "you know", "sort of"],
  RU: ["ээ", "эм", "ну", "типа", "короче", "как бы"]
};

function countWords(text: string) {
  return text
    .trim()
    .split(/[\s,.!?;:"'()]+/)
    .filter(Boolean).length;
}

function countFillers(text: string, language: "EN" | "RU") {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[\s,.!?;:"'()]+/).filter(Boolean);
  let count = 0;
  for (const filler of FILLERS[language]) {
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

export default function InterviewPage() {
  const router = useRouter();
  const { t } = useUi();
  const [session, setSession] = useState<InterviewSession>(() => {
    const stored = getSession();
    if (stored) return stored;
    return createSession(getSettings());
  });
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, error, request } = useMediaStream();
  const audio = useAudioMetrics(stream, isAnswering);
  const face = useFaceMetrics(videoRef, isAnswering);
  const speech = useSpeechToText(session.settings.language);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const voiceEnabled = Boolean(session.settings.voiceInterviewer);
  const voice = useVoiceInterviewer({
    enabled: voiceEnabled,
    language: session.settings.language,
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
    () => countFillers(liveTranscript, session.settings.language),
    [liveTranscript, session.settings.language]
  );

  const handleNextQuestion = async () => {
    if (status === "asking" || status === "answering" || status === "evaluating") {
      return;
    }
    if (session.turns.length >= TOTAL_QUESTIONS) return;
    if (session.turns.some((turn) => !turn.evaluation)) return;

    setStatus("asking");
    const topic = getTopicForStep(session.settings, session.turns.length);
    const previous = session.turns.slice(-2).map((turn) => ({
      question: turn.question,
      answer: turn.transcript
    }));

    let questionText = "";
    let usedVoice = false;

    if (voiceEnabled && voice.isReady) {
      const result = await voice.requestQuestion({
        role: session.settings.role,
        level: session.settings.level,
        topic,
        previous
      });
      if (result.text) questionText = result.text;
      usedVoice = result.usedVoice;
    } else if (voiceEnabled) {
      setVoiceWarning(t("voiceServerUnavailable"));
    }

    if (!questionText) {
      try {
        const res = await fetch("/api/ai/interviewer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: session.settings.role,
            level: session.settings.level,
            language: session.settings.language,
            topic,
            previous
          })
        });
        questionText = (await res.text()).trim();
      } catch {
        questionText = topic;
      }
      if (voiceEnabled && !usedVoice) {
        setVoiceWarning(t("voiceServerUnavailable"));
      }
    }

    const newTurn = createTurn(topic, questionText || topic);
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
    if (voiceEnabled && voice.isReady) {
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
    if (voiceEnabled && voice.isReady) {
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

    if (session.turns.length >= TOTAL_QUESTIONS) {
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
    router.push("/report");
  };

  const canFinish =
    session.turns.length >= TOTAL_QUESTIONS &&
    session.turns.every((turn) => Boolean(turn.evaluation));

  return (
    <main className="page page-tight">
      <header className="stack" style={{ marginBottom: "20px" }}>
        <span className="badge">
          {session.settings.role} - {session.settings.level} -{" "}
          {session.settings.language}
        </span>
        <h1>{t("interviewSessionTitle")}</h1>
        <p className="tiny">{t("interviewDisclaimer")}</p>
        {voiceEnabled && voice.status === "connecting" && (
          <p className="tiny">{t("voiceConnecting")}</p>
        )}
        {voiceEnabled && voice.isPlaying && (
          <p className="tiny">{t("voicePlayingQuestion")}</p>
        )}
        {voiceEnabled && voiceWarning && (
          <p className="tiny">{voiceWarning}</p>
        )}
      </header>

      <div className="two-col">
        <div className="stack">
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
        </div>
        <div className="stack">
          <ChatPanel
            turns={session.turns}
            status={status}
            totalQuestions={TOTAL_QUESTIONS}
            onNextQuestion={handleNextQuestion}
            onStartAnswer={handleStartAnswer}
            onStopEvaluate={handleStopEvaluate}
            onFinish={handleFinish}
            isListening={speech.isListening}
            canFinish={canFinish}
          />
          <div className="card stack">
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
          <div className="card">
            <h3>{t("answerTimerTitle")}</h3>
            <p className="timer">{formatTimer(answerElapsed)}</p>
            <p className="tiny">{t("answerTimerHint")}</p>
          </div>
        </div>
      </div>
    </main>
  );
}

