"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMediaStream } from "@/hooks/useMediaStream";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useAnswerRecorder } from "@/hooks/useAnswerRecorder";
import { useVoiceInterviewer } from "@/hooks/useVoiceInterviewer";
import { buildPersonaPlexPrompt } from "@/lib/personaplex/prompt";
import { transcribeAudioBlob } from "@/lib/voice/transcribeClient";
import { getSettings, type InterviewSettings } from "@/lib/storage/session";
import type { InterviewConfig } from "@/lib/schema/interview";

type MessageRole = "coach" | "user" | "system";

type CallMessage = {
  id: string;
  role: MessageRole;
  text: string;
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function PersonaPlexPage() {
  const router = useRouter();
  const [settings] = useState<InterviewSettings>(() => getSettings());
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [answerElapsed, setAnswerElapsed] = useState(0);
  const [answerStartedAt, setAnswerStartedAt] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const previousTurnsRef = useRef<Array<{ question: string; answer: string }>>([]);

  const { stream, error, request } = useMediaStream();
  const speech = useSpeechToText("EN");
  const recorder = useAnswerRecorder();

  const interviewConfig = useMemo<InterviewConfig>(() => {
    return {
      category: settings.category,
      difficulty: settings.difficulty,
      interviewType: settings.interviewType,
      subtopics: settings.subtopics,
      jobDescription: settings.jobDescription,
      questionCount: settings.questionCount,
      language: "EN",
      storeLocal: settings.storeLocal
    };
  }, [settings]);

  const personaPlexPrompt = useMemo(() => buildPersonaPlexPrompt(settings), [settings]);

  const voice = useVoiceInterviewer({
    enabled: true,
    stream,
    interviewConfig,
    onWarning: setWarning
  });

  const liveTranscript = useMemo(() => {
    return [speech.transcript, speech.interimTranscript].filter(Boolean).join(" ").trim();
  }, [speech.interimTranscript, speech.transcript]);

  const connectionLabel =
    voice.connectionState === "connected"
      ? "Live"
      : voice.connectionState === "reconnecting"
        ? "Reconnecting..."
        : voice.connectionState === "connecting"
          ? "Connecting..."
          : voice.connectionState === "offline"
            ? "Offline"
            : "Error";

  const pushMessage = useCallback((role: MessageRole, text: string) => {
    setMessages((prev) => [...prev, { id: createId(), role, text }]);
  }, []);

  useEffect(() => {
    request().catch(() => undefined);
  }, [request]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!isStarted) return;
    const timer = window.setInterval(() => {
      setSessionElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isStarted]);

  useEffect(() => {
    if (!isRecording || !answerStartedAt) return;
    const timer = window.setInterval(() => {
      setAnswerElapsed(Math.max(0, Math.floor((Date.now() - answerStartedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [answerStartedAt, isRecording]);

  const startLiveDialog = useCallback(async () => {
    if (isStarted) return;
    setWarning(null);
    setIsCoachThinking(true);

    const result = await voice.requestOpeningQuestion({
      topic: personaPlexPrompt,
      previous: []
    });

    if (result.text) {
      setLastQuestion(result.text);
      pushMessage("coach", result.text);
      setIsStarted(true);
      setSessionElapsed(0);
    } else {
      pushMessage("system", "PersonaPlex did not return text. Please retry.");
    }

    setIsCoachThinking(false);
  }, [isStarted, personaPlexPrompt, pushMessage, voice]);

  const startAnswer = useCallback(async () => {
    if (!isStarted || isRecording) return;
    const granted = stream ?? (await request());
    if (!granted) return;

    setWarning(null);
    speech.reset();
    voice.reset();
    const recorderStarted = recorder.start(granted);
    if (!speech.isSupported && !recorderStarted) {
      setWarning(
        "Live transcript is unavailable and audio fallback is not supported in this browser."
      );
    } else if (!speech.isSupported) {
      setWarning("Live transcript is unavailable. We will transcribe your recording after stop.");
    }
    await voice.startCapture();
    speech.start();
    setAnswerElapsed(0);
    setAnswerStartedAt(Date.now());
    setIsRecording(true);
  }, [isRecording, isStarted, recorder, request, speech, stream, voice]);

  const requestNextCoachTurn = useCallback(
    async (answer: string) => {
      const previous = answer
        ? [...previousTurnsRef.current, { question: lastQuestion || "Interview question", answer }]
        : [...previousTurnsRef.current];
      previousTurnsRef.current = previous.slice(-6);

      const result = await voice.requestCoachTurn({
        topic: personaPlexPrompt,
        previous: previousTurnsRef.current
      });

      if (result.text) {
        setLastQuestion(result.text);
        pushMessage("coach", result.text);
      } else {
        pushMessage("system", "No coach response received yet. Try nudge or retry connection.");
      }
    },
    [lastQuestion, personaPlexPrompt, pushMessage, voice]
  );

  const stopAnswer = useCallback(async () => {
    if (!isRecording) return;

    setIsRecording(false);
    const recordedAudioPromise = recorder.stop();
    speech.stop();
    voice.stopCapture();

    const recordedAudio = await recordedAudioPromise;
    let transcript = liveTranscript.trim();
    if (!transcript && recordedAudio) {
      const recovered = await transcribeAudioBlob(recordedAudio, "en");
      transcript = recovered.transcript;
      if (!transcript && recovered.error) {
        setWarning(`Transcription fallback failed: ${recovered.error}`);
      }
    }
    transcript = transcript || "(No speech recognized)";
    pushMessage("user", transcript);

    setIsCoachThinking(true);
    await requestNextCoachTurn(transcript);
    setIsCoachThinking(false);
  }, [isRecording, liveTranscript, pushMessage, recorder, requestNextCoachTurn, speech, voice]);

  const nudgeCoach = useCallback(async () => {
    if (!isStarted || isRecording || isCoachThinking) return;
    setIsCoachThinking(true);
    await requestNextCoachTurn("");
    setIsCoachThinking(false);
  }, [isCoachThinking, isRecording, isStarted, requestNextCoachTurn]);

  const retryConnection = useCallback(() => {
    voice.retryNow();
  }, [voice]);

  const leavePage = useCallback(() => {
    speech.stop();
    void recorder.stop();
    voice.stopCapture();
    router.push("/");
  }, [recorder, router, speech, voice]);

  return (
    <main className="page call-room-page">
      <section className="call-room shell">
        <header className="call-header">
          <div>
            <h1>PersonaPlex Live</h1>
            <p className="tiny">
              {settings.category} · {settings.difficulty} · {settings.interviewType}
            </p>
          </div>
          <div className="call-session-timer">{formatClock(sessionElapsed)}</div>
        </header>

        <div className={`connection-banner state-${voice.connectionState}`}>
          <span>{connectionLabel}</span>
          {voice.queueSize > 0 && <small>sending... ({voice.queueSize})</small>}
          {(voice.connectionState === "reconnecting" ||
            voice.connectionState === "offline" ||
            voice.connectionState === "error") && (
            <button className="btn btn-ghost" onClick={retryConnection}>
              Retry now
            </button>
          )}
        </div>

        <details className="prompt-box">
          <summary>Generated PersonaPlex Prompt</summary>
          <pre>{personaPlexPrompt}</pre>
        </details>

        <div className="call-video-row">
          <article className="call-tile call-user">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="tile-meta">
              <strong>You</strong>
              <span className="tiny">{isRecording ? "Recording" : "Mic idle"}</span>
            </div>
          </article>

          <article className={`call-tile call-coach ${voice.isPlaying ? "is-speaking" : ""}`}>
            <div className="coach-avatar">
              <Image
                src="/mushivo-logo.png"
                alt="mushivo.ai"
                width={110}
                height={110}
                className="coach-logo"
              />
            </div>
            <div className="tile-meta">
              <strong>mushivo.ai</strong>
              <span className="tiny">
                {isCoachThinking ? "Thinking..." : voice.isPlaying ? "Speaking..." : "Ready"}
              </span>
            </div>
          </article>
        </div>

        <section className="call-chat-card">
          <div className="chat-log" role="log" aria-live="polite">
            {messages.length === 0 && (
              <p className="chat-empty">Start the live dialog to receive the first question.</p>
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
            {!isStarted && (
              <button
                className="btn btn-primary"
                onClick={startLiveDialog}
                disabled={isCoachThinking}
              >
                Start live dialog
              </button>
            )}

            {isStarted && (
              <button
                className={`btn ${isRecording ? "btn-warn" : "btn-primary"}`}
                onClick={isRecording ? stopAnswer : startAnswer}
                disabled={isCoachThinking}
              >
                {isRecording ? "Stop answer" : "Start answer"}
              </button>
            )}

            <button
              className="btn btn-ghost"
              onClick={nudgeCoach}
              disabled={!isStarted || isCoachThinking || isRecording}
            >
              Nudge coach
            </button>

            <div className="metric-pill">
              <span>Answer timer</span>
              <strong>{formatClock(answerElapsed)}</strong>
            </div>

            <button className="btn btn-ghost" onClick={leavePage}>
              Back to setup
            </button>
          </div>

          {(warning || error) && <p className="call-warning">{warning ?? error}</p>}
        </section>
      </section>
    </main>
  );
}
