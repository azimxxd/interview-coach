"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaStream } from "@/hooks/useMediaStream";
import { useAudioMetrics } from "@/hooks/useAudioMetrics";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useVoiceInterviewer } from "@/hooks/useVoiceInterviewer";
import { getTopicForStep } from "@/lib/interview/topics";
import {
  getSession,
  saveSession,
  type DeliverySignals,
  type InterviewSession,
  type InterviewTurn
} from "@/lib/storage/session";

type MessageRole = "coach" | "user" | "system";

type CallMessage = {
  id: string;
  role: MessageRole;
  text: string;
};

type LastMetrics = {
  wpm: number;
  filler: number;
  pauses: number;
};

const FILLERS = ["um", "uh", "like", "you know", "sort of"];
const COACH_WAIT_MS = 180000;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

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
      count += Math.max(0, lower.split(filler).length - 1);
    } else {
      count += tokens.filter((token) => token === filler).length;
    }
  }
  return count;
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function createTurn(topic: string, question: string): InterviewTurn {
  return {
    id: createId(),
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
  const [session, setSession] = useState<InterviewSession | null>(() => getSession());
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [answerElapsed, setAnswerElapsed] = useState(0);
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [answerStartedAt, setAnswerStartedAt] = useState<number | null>(null);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [lastMetrics, setLastMetrics] = useState<LastMetrics>({
    wpm: 0,
    filler: 0,
    pauses: 0
  });

  const videoRef = useRef<HTMLVideoElement>(null);

  const { stream, error, request } = useMediaStream();
  const audio = useAudioMetrics(stream, isRecording);
  const speech = useSpeechToText("EN");

  const handleVoiceWarning = useCallback((message: string) => {
    setVoiceWarning(message);
  }, []);

  const voice = useVoiceInterviewer({
    enabled: true,
    stream,
    onWarning: handleVoiceWarning
  });

  const liveTranscript = useMemo(() => {
    return [speech.transcript, speech.interimTranscript].filter(Boolean).join(" ").trim();
  }, [speech.interimTranscript, speech.transcript]);

  const liveWordCount = useMemo(() => countWords(liveTranscript), [liveTranscript]);
  const liveFillerCount = useMemo(() => countFillers(liveTranscript), [liveTranscript]);

  const liveWpm = useMemo(() => {
    if (!answerStartedAt || answerElapsed <= 0) return 0;
    const minutes = answerElapsed / 60;
    return minutes > 0 ? liveWordCount / minutes : 0;
  }, [answerElapsed, answerStartedAt, liveWordCount]);

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  useEffect(() => {
    if (!session) return;
    saveSession(session);
  }, [session]);

  useEffect(() => {
    request().catch(() => undefined);
  }, [request]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (isDone) return;
    const timer = window.setInterval(() => {
      setSessionElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isDone]);

  useEffect(() => {
    if (!isRecording || !answerStartedAt) return;
    const timer = window.setInterval(() => {
      setAnswerElapsed(Math.max(0, Math.floor((Date.now() - answerStartedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [answerStartedAt, isRecording]);

  const pushMessage = (role: MessageRole, text: string) => {
    setMessages((prev) => [...prev, { id: createId(), role, text }]);
  };

  const askCoach = async (step: number, opening = false) => {
    if (!session) return false;

    setIsCoachThinking(true);
    setVoiceWarning(null);

    const topic = getTopicForStep(session.settings, step);
    const previous = session.turns.slice(-2).map((turn) => ({
      question: turn.question,
      answer: turn.transcript
    }));

    const result = opening
      ? await voice.requestOpeningQuestion({
          role: session.settings.role,
          level: session.settings.level,
          topic,
          previous
        })
      : await voice.requestCoachTurn(
          {
            role: session.settings.role,
            level: session.settings.level,
            topic,
            previous
          },
          { timeoutMs: COACH_WAIT_MS }
        );

    const question = result.text?.trim() ?? "";
    if (!question) {
      setIsCoachThinking(false);
      setVoiceWarning(
        "PersonaPlex has not returned text yet. In CPU mode, a turn can take 2-3 minutes. Wait, then press Retry coach."
      );
      return false;
    }

    pushMessage("coach", question);
    setQuestionCount((prev) => prev + 1);
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        turns: [...prev.turns, createTurn(topic, question)]
      };
    });

    setIsCoachThinking(false);
    return true;
  };

  useEffect(() => {
    if (!session) return;
    if (isDone) return;
    if (!voice.isReady) return;
    if (questionCount > 0 || isCoachThinking) return;

    askCoach(0, true).catch(() => {
      setIsCoachThinking(false);
      setVoiceWarning("Unable to request opening question from PersonaPlex.");
    });
  }, [isCoachThinking, isDone, questionCount, session, voice.isReady]);

  const startAnswer = async () => {
    if (!session || isDone || isRecording || isCoachThinking) return;
    if (!voice.isReady) {
      setVoiceWarning("PersonaPlex voice server is not ready.");
      return;
    }
    if (questionCount === 0) {
      setVoiceWarning("Wait for the coach question first.");
      return;
    }

    const granted = stream ?? (await request());
    if (!granted) return;

    setVoiceWarning(null);
    audio.reset();
    speech.reset();
    voice.reset();
    await voice.startCapture();
    speech.start();
    setAnswerElapsed(0);
    setAnswerStartedAt(Date.now());
    setIsRecording(true);
  };

  const stopAnswer = async () => {
    if (!session || !isRecording) return;

    const finalTranscriptSnapshot = liveTranscript.trim();
    setIsRecording(false);
    speech.stop();
    voice.stopCapture();

    const transcript = finalTranscriptSnapshot || "(No speech recognized)";
    const signals: DeliverySignals = {
      wpm: Number.isFinite(liveWpm) ? Number(liveWpm.toFixed(1)) : 0,
      pauses_sec: Number(audio.pauseSeconds.toFixed(1)),
      filler_count: liveFillerCount,
      eye_contact_pct: 0,
      smile_proxy: 0,
      duration_sec: Math.max(0, answerElapsed)
    };

    setLastMetrics({
      wpm: signals.wpm,
      filler: signals.filler_count,
      pauses: signals.pauses_sec
    });

    pushMessage("user", transcript);

    setSession((prev) => {
      if (!prev) return prev;
      const updatedTurns = [...prev.turns];
      const lastIndex = updatedTurns.length - 1;
      if (updatedTurns[lastIndex]) {
        updatedTurns[lastIndex] = {
          ...updatedTurns[lastIndex],
          transcript,
          signals
        };
      }
      return { ...prev, turns: updatedTurns };
    });

    const total = session.settings.questionCount;
    if (questionCount >= total) {
      setIsDone(true);
      pushMessage("system", "Interview complete.");
      return;
    }

    await askCoach(questionCount, false);
  };

  const endSession = () => {
    setIsDone(true);
    setIsRecording(false);
    speech.stop();
    voice.stopCapture();
    voice.reset();
    setSession((prev) => {
      if (!prev) return prev;
      return { ...prev, finishedAt: new Date().toISOString() };
    });
  };

  const leaveInterview = () => {
    router.push("/");
  };

  const retryCoach = async () => {
    if (!session || isCoachThinking || isRecording || isDone || !voice.isReady) return;
    const step = Math.max(0, questionCount);
    await askCoach(step, questionCount === 0);
  };

  if (!session) {
    return <main className="page page-tight">Preparing interview...</main>;
  }

  const displayWpm = isRecording ? liveWpm : lastMetrics.wpm;
  const displayFillers = isRecording ? liveFillerCount : lastMetrics.filler;
  const displayPauses = isRecording ? audio.pauseSeconds : lastMetrics.pauses;

  return (
    <main className="page call-room-page">
      <section className="call-room shell">
        <header className="call-header">
          <div>
            <h1>Interview Call</h1>
            <p className="tiny">
              {session.settings.role} · {session.settings.level} · {questionCount}/
              {session.settings.questionCount} questions
            </p>
          </div>
          <div className="call-session-timer">{formatClock(sessionElapsed)}</div>
        </header>

        <div className="call-video-row">
          <article className="call-tile call-user">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="tile-meta">
              <strong>You</strong>
              <span className="tiny">{isRecording ? "Recording" : "Mic idle"}</span>
            </div>
          </article>

          <article className={`call-tile call-coach ${voice.isPlaying ? "is-speaking" : ""}`}>
            <div className="coach-avatar">Coach</div>
            <div className="tile-meta">
              <strong>PersonaPlex Coach</strong>
              {isCoachThinking && <span className="tiny">Thinking...</span>}
            </div>
          </article>
        </div>

        <div className="call-metrics-row">
          <div className="metric-pill">
            <span>Session</span>
            <strong>{formatClock(sessionElapsed)}</strong>
          </div>
          <div className="metric-pill">
            <span>Answer</span>
            <strong>{formatClock(answerElapsed)}</strong>
          </div>
          <div className="metric-pill">
            <span>WPM</span>
            <strong>{displayWpm.toFixed(0)}</strong>
          </div>
          <div className="metric-pill">
            <span>Fillers</span>
            <strong>{displayFillers}</strong>
          </div>
          <div className="metric-pill">
            <span>Pauses</span>
            <strong>{displayPauses.toFixed(1)}s</strong>
          </div>
          <div className="metric-pill">
            <span>Mic</span>
            <strong>{audio.rms.toFixed(2)}</strong>
          </div>
        </div>

        <section className="call-chat-card">
          <div className="chat-log" role="log" aria-live="polite">
            {messages.length === 0 && (
              <p className="chat-empty">Waiting for coach question...</p>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`chat-row role-${message.role}`}>
                <div className="chat-bubble">{message.text}</div>
              </div>
            ))}

            {isRecording && liveTranscript && (
              <div className="chat-row role-user">
                <div className="chat-bubble chat-live">{liveTranscript}</div>
              </div>
            )}
          </div>

          <div className="chat-actions">
            <button
              className={`btn ${isRecording ? "btn-warn" : "btn-primary"}`}
              onClick={isRecording ? stopAnswer : startAnswer}
              disabled={isCoachThinking || isDone}
            >
              {isRecording ? "Stop answer" : "Start answer"}
            </button>

            {voiceWarning && (
              <button
                className="btn btn-ghost"
                onClick={retryCoach}
                disabled={isCoachThinking || isRecording || isDone || !voice.isReady}
              >
                Retry coach
              </button>
            )}

            <button className="btn btn-ghost" onClick={endSession} disabled={isDone}>
              End session
            </button>
            <button className="btn btn-ghost" onClick={leaveInterview}>
              Back to setup
            </button>
          </div>

          {(voiceWarning || error) && (
            <p className="call-warning">{voiceWarning ?? error}</p>
          )}
        </section>
      </section>
    </main>
  );
}
