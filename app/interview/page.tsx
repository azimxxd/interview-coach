"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMediaStream } from "@/hooks/useMediaStream";
import { useAudioMetrics } from "@/hooks/useAudioMetrics";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useAnswerRecorder } from "@/hooks/useAnswerRecorder";
import { appendCompletedSession } from "@/lib/storage/history";
import { transcribeAudioBlob } from "@/lib/voice/transcribeClient";
import {
  getSession,
  saveSession,
  type DeliverySignals,
  type FollowupTurn,
  type InterviewSession,
  type InterviewTurn,
  type SessionSummary
} from "@/lib/storage/session";
import type { AnswerRubric, InterviewConfig } from "@/lib/schema/interview";

type PanelTab = "question" | "transcript";

type LastMetrics = {
  wpm: number;
  fillerCount: number;
  topFillers: Array<{ token: string; count: number }>;
  hasTranscriptMetrics: boolean;
  pauseSeconds: number;
  pauseCount: number;
  longestPauseMs: number;
  micLevel: number;
};

const FILLERS = ["um", "uh", "like", "you know", "sort of", "actually", "basically"];
const KOKORO_REPEAT_REQUEST_TIMEOUT_MS = 12000;

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

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function countFillersDetailed(text: string) {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[\s,.!?;:"'()]+/).filter(Boolean);
  const counts = new Map<string, number>();

  for (const filler of FILLERS) {
    let count = 0;
    if (filler.includes(" ")) {
      count = Math.max(0, lower.split(filler).length - 1);
    } else {
      count = tokens.filter((token) => token === filler).length;
    }
    if (count > 0) {
      counts.set(filler, count);
    }
  }

  const top = Array.from(counts.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count);

  const total = top.reduce((sum, item) => sum + item.count, 0);
  return { total, top: top.slice(0, 3) };
}

function buildMicStatus(rms: number) {
  if (rms < 0.01) return { label: "Muted", icon: "◼" };
  if (rms < 0.03) return { label: "Low", icon: "◑" };
  return { label: "OK", icon: "◉" };
}

function wpmLabel(wpm: number) {
  if (wpm <= 0) return "-";
  if (wpm < 130) return "too slow";
  if (wpm > 150) return "too fast";
  return "ok";
}

function createSignals(): DeliverySignals {
  return {
    wpm: 0,
    pauses_sec: 0,
    filler_count: 0,
    eye_contact_pct: 0,
    smile_proxy: 0,
    duration_sec: 0
  };
}

function createPrimaryTurn(question: string, topic: string): InterviewTurn {
  return {
    id: createId(),
    topic,
    question,
    transcript: "",
    signals: createSignals(),
    followups: []
  };
}

function createFollowupTurn(question: string): FollowupTurn {
  return {
    id: createId(),
    question,
    transcript: "",
    signals: createSignals()
  };
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function collectRubrics(session: InterviewSession) {
  return session.turns.flatMap((turn) => {
    const current = turn.rubric ? [turn.rubric] : [];
    const followups = turn.followups.flatMap((followup) => (followup.rubric ? [followup.rubric] : []));
    return [...current, ...followups];
  });
}

function buildSummary(session: InterviewSession): SessionSummary {
  const rubrics = collectRubrics(session);
  const averages = rubrics.map((rubric) =>
    average([
      rubric.scores.clarity,
      rubric.scores.correctness,
      rubric.scores.depth,
      rubric.scores.structure,
      rubric.scores.confidence
    ])
  );

  const overallScore = Number(average(averages).toFixed(2));

  const strengthCounts = new Map<string, number>();
  const weaknessCounts = new Map<string, number>();

  for (const rubric of rubrics) {
    rubric.what_was_good.forEach((item) => {
      strengthCounts.set(item, (strengthCounts.get(item) ?? 0) + 1);
    });
    rubric.what_to_improve.forEach((item) => {
      weaknessCounts.set(item, (weaknessCounts.get(item) ?? 0) + 1);
    });
  }

  const topStrengths = Array.from(strengthCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([item]) => item)
    .slice(0, 3);

  const topWeaknesses = Array.from(weaknessCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([item]) => item)
    .slice(0, 3);

  const nextDifficulty =
    overallScore >= 4.2
      ? session.settings.difficulty === "Junior"
        ? "Mid"
        : "Senior"
      : overallScore < 2.8
        ? "Junior"
        : session.settings.difficulty;

  const recommendedNextConfig = {
    category: session.settings.category,
    interviewType:
      overallScore < 3
        ? "Behavioral (STAR)"
        : session.settings.interviewType === "Technical Q&A"
          ? "Debugging"
          : session.settings.interviewType,
    difficulty: nextDifficulty,
    questionCount: 5,
    subtopics: session.settings.subtopics.slice(0, 3)
  };

  return {
    overallScore,
    topStrengths,
    topWeaknesses,
    recommendedNextConfig
  };
}

async function postInterviewAction<T>(payload: unknown): Promise<T> {
  const response = await fetch("/api/interview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Interview action failed.");
  }

  return (await response.json()) as T;
}

function buildHint(interviewType: InterviewConfig["interviewType"]) {
  if (interviewType === "Behavioral (STAR)") {
    return "Use STAR: Situation, Task, Action, Result. Keep each step to 1-2 sentences.";
  }
  if (interviewType === "System Design") {
    return "Start with requirements, then architecture, then tradeoffs and scaling risks.";
  }
  if (interviewType === "Debugging") {
    return "State reproducible steps, likely hypotheses, instrumentation, and how you confirm the fix.";
  }
  return "Answer in a clear sequence: approach, key decisions, tradeoffs, and one concrete example.";
}

function normalizeTextForSpeech(input: string) {
  return input
    .replace(/\bQ&A\b/gi, "Q and A")
    .replace(/\bA11y\b/gi, "accessibility")
    .replace(/\bTS\b/gi, "TypeScript")
    .replace(/\bJS\b/gi, "JavaScript")
    .replace(/\bCI\/CD\b/gi, "CI and CD")
    .replace(/&/g, " and ")
    .trim();
}

function base64ToWavBlob(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export default function InterviewPage() {
  const router = useRouter();
  const [session, setSession] = useState<InterviewSession | null>(() => getSession());
  const [phase, setPhase] = useState<"soundcheck" | "interview" | "summary">("soundcheck");
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [answerElapsed, setAnswerElapsed] = useState(0);
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [answerStartedAt, setAnswerStartedAt] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [soundcheckCountdown, setSoundcheckCountdown] = useState(10);
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [followupIndex, setFollowupIndex] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("question");
  const [manualTranscript, setManualTranscript] = useState("");
  const [manualCoachSpeaking, setManualCoachSpeaking] = useState(false);
  const [isRepeatLoading, setIsRepeatLoading] = useState(false);
  const [lastMetrics, setLastMetrics] = useState<LastMetrics>({
    wpm: 0,
    fillerCount: 0,
    topFillers: [],
    hasTranscriptMetrics: false,
    pauseSeconds: 0,
    pauseCount: 0,
    longestPauseMs: 0,
    micLevel: 0
  });

  const sessionRef = useRef<InterviewSession | null>(session);
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveTranscriptRef = useRef("");
  const repeatAudioRef = useRef<HTMLAudioElement | null>(null);
  const repeatAudioUrlRef = useRef<string | null>(null);
  const repeatRequestInFlightRef = useRef(false);
  const lastRepeatCacheRef = useRef<{ text: string; audioBase64: string } | null>(null);

  const stopRepeatAudio = useCallback(() => {
    const existingAudio = repeatAudioRef.current;
    if (existingAudio) {
      existingAudio.pause();
      existingAudio.src = "";
      repeatAudioRef.current = null;
    }
    const existingUrl = repeatAudioUrlRef.current;
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl);
      repeatAudioUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      stopRepeatAudio();
    };
  }, [stopRepeatAudio]);

  const { stream, error, request } = useMediaStream();
  const audio = useAudioMetrics(stream, isRecording || phase === "soundcheck");
  const speech = useSpeechToText("EN");
  const recorder = useAnswerRecorder();

  const interviewConfig = useMemo<InterviewConfig>(() => {
    const settings = session?.settings;
    return {
      category: settings?.category ?? "Frontend",
      difficulty: settings?.difficulty ?? "Junior",
      interviewType: settings?.interviewType ?? "Technical Q&A",
      subtopics: settings?.subtopics ?? [],
      jobDescription: settings?.jobDescription ?? "",
      questionCount: settings?.questionCount ?? 8,
      language: "EN",
      storeLocal: settings?.storeLocal ?? false
    };
  }, [session]);

  const liveTranscript = useMemo(() => {
    return [speech.transcript, speech.interimTranscript].filter(Boolean).join(" ").trim();
  }, [speech.interimTranscript, speech.transcript]);

  useEffect(() => {
    liveTranscriptRef.current = liveTranscript;
  }, [liveTranscript]);

  const liveTranscriptForMetrics = useMemo(() => {
    const typed = manualTranscript.trim();
    return typed || liveTranscript;
  }, [liveTranscript, manualTranscript]);

  const fillerLive = useMemo(
    () => countFillersDetailed(liveTranscriptForMetrics),
    [liveTranscriptForMetrics]
  );

  const liveWordCount = useMemo(
    () => countWords(liveTranscriptForMetrics),
    [liveTranscriptForMetrics]
  );

  const liveWpm = useMemo(() => {
    if (!answerStartedAt || answerElapsed <= 0) return 0;
    const minutes = answerElapsed / 60;
    return minutes > 0 ? liveWordCount / minutes : 0;
  }, [answerElapsed, answerStartedAt, liveWordCount]);

  const currentTurn = useMemo(() => {
    if (!session) return null;
    const turn = session.turns[primaryIndex];
    if (!turn) return null;
    if (followupIndex === null) {
      return {
        kind: "primary" as const,
        question: turn.question,
        transcript: turn.transcript,
        rubric: turn.rubric,
        hint: turn.hint,
        followups: turn.followups
      };
    }
    const followup = turn.followups[followupIndex];
    if (!followup) return null;
    return {
      kind: "followup" as const,
      question: followup.question,
      transcript: followup.transcript,
      rubric: followup.rubric,
      hint: followup.hint,
      followups: turn.followups
    };
  }, [followupIndex, primaryIndex, session]);

  const displayWpm = isRecording ? liveWpm : lastMetrics.wpm;
  const displayFillers = isRecording ? fillerLive.total : lastMetrics.fillerCount;
  const displayTopFillers = isRecording ? fillerLive.top : lastMetrics.topFillers;
  const hasLiveTranscriptMetrics = countWords(liveTranscriptForMetrics) > 0;
  const hasDisplayTranscriptMetrics = isRecording
    ? hasLiveTranscriptMetrics
    : lastMetrics.hasTranscriptMetrics;
  const displayTopFillersLabel = !hasDisplayTranscriptMetrics
    ? "Needs transcript to detect fillers"
    : displayTopFillers.length
      ? displayTopFillers.map((item) => `${item.token}(${item.count})`).join(", ")
      : "none";
  const displayPauseSeconds = isRecording ? audio.pauseSeconds : lastMetrics.pauseSeconds;
  const displayPauseCount = isRecording ? audio.pauseCount : lastMetrics.pauseCount;
  const displayLongestPauseMs = isRecording ? audio.longestPauseMs : lastMetrics.longestPauseMs;
  const micValue = isRecording ? audio.rms : lastMetrics.micLevel;
  const micStatus = buildMicStatus(micValue);

  const coachStatus = isCoachThinking
    ? "Coach is thinking..."
    : manualCoachSpeaking
      ? "Coach is speaking..."
      : "Coach is ready.";

  const persistSession = useCallback((next: InterviewSession) => {
    sessionRef.current = next;
    setSession(next);
    saveSession(next);
  }, []);

  const updateSession = useCallback(
    (updater: (current: InterviewSession) => InterviewSession) => {
      const current = sessionRef.current;
      if (!current) return null;
      const next = updater(current);
      persistSession(next);
      return next;
    },
    [persistSession]
  );

  const finalizeSession = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;

    const finished: InterviewSession = {
      ...current,
      finishedAt: new Date().toISOString(),
      summary: buildSummary(current)
    };

    persistSession(finished);
    appendCompletedSession(finished);
    speech.stop();
    void recorder.stop();
    setIsRecording(false);
    setPhase("summary");
  }, [persistSession, recorder, speech]);

  const moveToNextPrimary = useCallback(
    (nextPrimary: number) => {
      const current = sessionRef.current;
      if (!current) return;
      if (nextPrimary >= current.settings.questionCount || nextPrimary >= current.turns.length) {
        finalizeSession();
        return;
      }
      setPrimaryIndex(nextPrimary);
      setFollowupIndex(null);
      setPanelTab("question");
    },
    [finalizeSession]
  );

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  useEffect(() => {
    request().catch(() => undefined);
  }, [request]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (phase !== "interview") return;
    const timer = window.setInterval(() => {
      setSessionElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!isRecording || !answerStartedAt) return;
    const timer = window.setInterval(() => {
      setAnswerElapsed(Math.max(0, Math.floor((Date.now() - answerStartedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [answerStartedAt, isRecording]);

  useEffect(() => {
    if (phase !== "soundcheck") return;
    if (soundcheckCountdown <= 0) return;
    const timer = window.setTimeout(() => {
      setSoundcheckCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, soundcheckCountdown]);

  const fetchPrimaryQuestions = useCallback(async () => {
    if (!sessionRef.current) return;
    setIsCoachThinking(true);

    try {
      const count = sessionRef.current.settings.questionCount;
      let questions: string[] = [];

      try {
        const payload = await postInterviewAction<{ questions: string[] }>({
          action: "generate_primary_questions",
          config: interviewConfig,
          count
        });
        questions = payload.questions.slice(0, count);
      } catch {
        setWarning("Unable to fetch AI questions. Using local fallback questions.");
      }

      const topics = interviewConfig.subtopics.length
        ? interviewConfig.subtopics
        : [interviewConfig.category];

      const turns = Array.from({ length: count }, (_, index) => {
        const question =
          questions[index] ?? `How would you approach ${topics[index % topics.length]} in this role?`;
        const topic = topics[index % topics.length] ?? interviewConfig.category;
        return createPrimaryTurn(question, topic);
      });

      const next = updateSession((current) => ({
        ...current,
        turns
      }));

      if (!next) {
        throw new Error("Unable to prepare session.");
      }

      setPrimaryIndex(0);
      setFollowupIndex(null);
      setPanelTab("question");
    } finally {
      setIsCoachThinking(false);
    }
  }, [interviewConfig, updateSession]);

  const startInterviewFlow = useCallback(async () => {
    if (!sessionRef.current) return;
    setWarning(null);
    const granted = stream ?? (await request());
    if (!granted) return;
    setPhase("interview");
    setSessionElapsed(0);
    await fetchPrimaryQuestions();
  }, [fetchPrimaryQuestions, request, stream]);

  const startAnswer = useCallback(async () => {
    if (!currentTurn || isRecording || phase !== "interview") return;
    const granted = stream ?? (await request());
    if (!granted) return;

    setWarning(null);
    audio.reset();
    speech.reset();
    setManualTranscript("");
    const recorderStarted = recorder.start(granted);
    if (!speech.isSupported && !recorderStarted) {
      setWarning(
        "Live transcription is unavailable and audio fallback is not supported in this browser. Type your answer in the Transcript tab, then stop answer."
      );
    } else if (!speech.isSupported) {
      setWarning(
        "Live transcript is unavailable in this browser. We will transcribe your recording after you stop answer."
      );
    }
    speech.start();
    setAnswerElapsed(0);
    setAnswerStartedAt(Date.now());
    setIsRecording(true);
    setPanelTab("transcript");
  }, [audio, currentTurn, isRecording, phase, recorder, request, speech, stream]);

  const stopAnswer = useCallback(async () => {
    if (!currentTurn || !sessionRef.current || !isRecording) return;

    const activePrimary = primaryIndex;
    const activeFollowup = followupIndex;

    setIsRecording(false);
    const recordedAudioPromise = recorder.stop();
    speech.stop();

    await new Promise((resolve) => window.setTimeout(resolve, 260));

    const recordedAudio = await recordedAudioPromise;
    const autoTranscript = liveTranscriptRef.current.trim();
    const typedTranscript = manualTranscript.trim();
    let transcript = typedTranscript || autoTranscript;
    let usedServerTranscription = false;
    let transcriptionFallbackError: string | null = null;
    if (!transcript && recordedAudio) {
      const recovered = await transcribeAudioBlob(recordedAudio, "en");
      if (recovered.transcript) {
        transcript = recovered.transcript;
        usedServerTranscription = true;
      } else if (recovered.error) {
        transcriptionFallbackError = recovered.error;
      }
    }
    transcript = transcript || "(No speech recognized)";
    const filler = countFillersDetailed(transcript);

    if (!typedTranscript && !autoTranscript && !usedServerTranscription) {
      if (transcriptionFallbackError) {
        setWarning(`Transcription fallback failed: ${transcriptionFallbackError}`);
      } else if (speech.lastError) {
        setWarning(`Transcription issue: ${speech.lastError}`);
      } else {
        setWarning(
          "No speech transcript captured. If your mic is working, continue speaking for a few seconds before stopping, or type your answer in the Transcript tab."
        );
      }
    }

    const transcriptForMetrics = transcript === "(No speech recognized)" ? "" : transcript;
    const measuredWpm =
      answerElapsed > 0
        ? Number((countWords(transcriptForMetrics) / (answerElapsed / 60)).toFixed(1))
        : 0;
    const hasTranscriptMetrics = countWords(transcriptForMetrics) > 0;

    const signals: DeliverySignals = {
      wpm: Number.isFinite(measuredWpm) ? measuredWpm : 0,
      pauses_sec: Number(audio.pauseSeconds.toFixed(1)),
      filler_count: filler.total,
      eye_contact_pct: 0,
      smile_proxy: 0,
      duration_sec: Math.max(0, answerElapsed)
    };

    setLastMetrics({
      wpm: signals.wpm,
      fillerCount: filler.total,
      topFillers: filler.top,
      hasTranscriptMetrics,
      pauseSeconds: signals.pauses_sec,
      pauseCount: audio.pauseCount,
      longestPauseMs: audio.longestPauseMs,
      micLevel: audio.rms
    });

    const currentQuestion = currentTurn.question;

    updateSession((current) => {
      const turns = [...current.turns];
      const turn = { ...turns[activePrimary] };

      if (activeFollowup === null) {
        turns[activePrimary] = {
          ...turn,
          transcript,
          signals
        };
      } else {
        const followups = [...turn.followups];
        const followup = followups[activeFollowup];
        if (followup) {
          followups[activeFollowup] = {
            ...followup,
            transcript,
            signals
          };
        }
        turns[activePrimary] = {
          ...turn,
          followups
        };
      }

      return {
        ...current,
        turns
      };
    });

    setIsCoachThinking(true);

    try {
      const rubric = await postInterviewAction<AnswerRubric>({
        action: "score_answer",
        config: interviewConfig,
        question: currentQuestion,
        transcript,
        metadata: {
          wpm: signals.wpm,
          fillerCount: filler.total,
          topFillers: filler.top,
          pauseCount: audio.pauseCount,
          longestPauseMs: audio.longestPauseMs,
          micLevel: audio.rms
        }
      });

      updateSession((current) => {
        const turns = [...current.turns];
        const turn = { ...turns[activePrimary] };

        if (activeFollowup === null) {
          turns[activePrimary] = {
            ...turn,
            rubric
          };
        } else {
          const followups = [...turn.followups];
          const followup = followups[activeFollowup];
          if (followup) {
            followups[activeFollowup] = {
              ...followup,
              rubric
            };
          }
          turns[activePrimary] = {
            ...turn,
            followups
          };
        }

        return {
          ...current,
          turns
        };
      });

      if (activeFollowup === null) {
        const followupResult = await postInterviewAction<{ followups: string[] }>({
          action: "generate_followups",
          config: interviewConfig,
          originalQuestion: currentQuestion,
          transcript,
          alreadyAsked: 0
        });

        updateSession((current) => {
          const turns = [...current.turns];
          const turn = { ...turns[activePrimary] };
          const generated = followupResult.followups
            .slice(0, 2)
            .map((question) => createFollowupTurn(question));

          turns[activePrimary] = {
            ...turn,
            followups: generated
          };

          return {
            ...current,
            turns
          };
        });

        if (followupResult.followups.length) {
          setFollowupIndex(0);
        } else {
          moveToNextPrimary(activePrimary + 1);
        }
      } else {
        const current = sessionRef.current;
        const followupCount = current?.turns[activePrimary]?.followups.length ?? 0;
        const nextFollowup = activeFollowup + 1;
        if (nextFollowup < followupCount) {
          setFollowupIndex(nextFollowup);
        } else {
          moveToNextPrimary(activePrimary + 1);
        }
      }
    } catch {
      setWarning("Unable to score answer right now. You can continue to the next question.");
      moveToNextPrimary(activePrimary + 1);
    } finally {
      setIsCoachThinking(false);
      setPanelTab("question");
    }
  }, [
    answerElapsed,
    audio.longestPauseMs,
    audio.pauseCount,
    audio.pauseSeconds,
    audio.rms,
    currentTurn,
    followupIndex,
    interviewConfig,
    isRecording,
    manualTranscript,
    moveToNextPrimary,
    primaryIndex,
    recorder,
    speech,
    updateSession
  ]);

  const skipCurrent = useCallback(() => {
    if (!currentTurn || !sessionRef.current || isRecording) return;

    const activePrimary = primaryIndex;
    const activeFollowup = followupIndex;

    updateSession((current) => {
      const turns = [...current.turns];
      const turn = { ...turns[activePrimary] };

      if (activeFollowup === null) {
        turns[activePrimary] = {
          ...turn,
          transcript: "(Skipped)",
          signals: createSignals()
        };
      } else {
        const followups = [...turn.followups];
        const followup = followups[activeFollowup];
        if (followup) {
          followups[activeFollowup] = {
            ...followup,
            transcript: "(Skipped)",
            signals: createSignals()
          };
        }
        turns[activePrimary] = {
          ...turn,
          followups
        };
      }

      return {
        ...current,
        turns
      };
    });

    if (activeFollowup === null) {
      moveToNextPrimary(activePrimary + 1);
    } else {
      const current = sessionRef.current;
      const totalFollowups = current?.turns[activePrimary]?.followups.length ?? 0;
      if (activeFollowup + 1 < totalFollowups) {
        setFollowupIndex(activeFollowup + 1);
      } else {
        moveToNextPrimary(activePrimary + 1);
      }
    }
  }, [currentTurn, followupIndex, isRecording, moveToNextPrimary, primaryIndex, updateSession]);

  const askForHint = useCallback(() => {
    if (!currentTurn || !sessionRef.current) return;

    const activePrimary = primaryIndex;
    const activeFollowup = followupIndex;
    const hint = buildHint(interviewConfig.interviewType);

    updateSession((current) => {
      const turns = [...current.turns];
      const turn = { ...turns[activePrimary] };

      if (activeFollowup === null) {
        turns[activePrimary] = {
          ...turn,
          hint
        };
      } else {
        const followups = [...turn.followups];
        const followup = followups[activeFollowup];
        if (followup) {
          followups[activeFollowup] = {
            ...followup,
            hint
          };
        }
        turns[activePrimary] = {
          ...turn,
          followups
        };
      }

      return {
        ...current,
        turns
      };
    });
  }, [currentTurn, followupIndex, interviewConfig.interviewType, primaryIndex, updateSession]);

  const playRepeatAudioFromBase64 = useCallback(
    async (audioBase64: string) => {
      stopRepeatAudio();
      const url = URL.createObjectURL(base64ToWavBlob(audioBase64));
      repeatAudioUrlRef.current = url;
      const audioEl = new Audio(url);
      repeatAudioRef.current = audioEl;

      audioEl.onplay = () => {
        setManualCoachSpeaking(true);
        setWarning(null);
      };
      audioEl.onended = () => {
        setManualCoachSpeaking(false);
        stopRepeatAudio();
      };
      audioEl.onerror = () => {
        setManualCoachSpeaking(false);
        stopRepeatAudio();
      };

      await audioEl.play();
      return true;
    },
    [stopRepeatAudio]
  );

  const playKokoroRepeat = useCallback(
    async (text: string) => {
      let timeout: number | null = null;
      try {
        if (repeatRequestInFlightRef.current) {
          return false;
        }

        const cached = lastRepeatCacheRef.current;
        if (cached && cached.text === text && cached.audioBase64) {
          return await playRepeatAudioFromBase64(cached.audioBase64);
        }

        repeatRequestInFlightRef.current = true;
        setIsRepeatLoading(true);
        const controller = new AbortController();
        timeout = window.setTimeout(
          () => controller.abort(),
          KOKORO_REPEAT_REQUEST_TIMEOUT_MS
        );
        const response = await fetch("/api/interview/repeat-tts", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text
          })
        });
        if (timeout !== null) {
          window.clearTimeout(timeout);
          timeout = null;
        }

        if (!response.ok) {
          let message = "Kokoro repeat TTS failed.";
          try {
            const details = (await response.json()) as { error?: unknown };
            if (typeof details.error === "string" && details.error.trim()) {
              message = `Kokoro repeat TTS failed: ${details.error.trim()}`;
            }
          } catch {
            // Keep generic message.
          }
          console.warn(message);
          setWarning(message);
          return false;
        }

        const payload = (await response.json()) as {
          audio_base64?: unknown;
        };

        if (typeof payload.audio_base64 !== "string" || !payload.audio_base64.trim()) {
          setWarning("Kokoro repeat TTS failed: Kokoro returned empty audio.");
          return false;
        }

        lastRepeatCacheRef.current = {
          text,
          audioBase64: payload.audio_base64
        };
        return await playRepeatAudioFromBase64(payload.audio_base64);
      } catch {
        const message = "Kokoro repeat TTS timed out or failed.";
        console.warn(message);
        setWarning(message);
        return false;
      } finally {
        if (timeout !== null) {
          window.clearTimeout(timeout);
        }
        repeatRequestInFlightRef.current = false;
        setIsRepeatLoading(false);
      }
    },
    [playRepeatAudioFromBase64]
  );

  const repeatQuestion = useCallback(async () => {
    if (!currentTurn || isRepeatLoading) return;
    const normalizedText = normalizeTextForSpeech(currentTurn.question);
    await playKokoroRepeat(normalizedText);
  }, [currentTurn, isRepeatLoading, playKokoroRepeat]);

  const leaveInterview = useCallback(() => {
    stopRepeatAudio();
    router.push("/");
  }, [router, stopRepeatAudio]);

  if (!session) {
    return <main className="page page-tight">Preparing interview...</main>;
  }

  return (
    <main className="page call-room-page">
      <section className="call-room shell">
        <header className="call-header">
          <div>
            <h1>Interview Call</h1>
            <p className="tiny">
              {session.settings.category} · {session.settings.difficulty} · {primaryIndex + 1}/
              {session.settings.questionCount}
            </p>
          </div>
          <div className="call-session-timer">{formatClock(sessionElapsed)}</div>
        </header>

        <div className="call-video-row">
          <article className="call-tile call-user">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="tile-meta">
              <strong>You</strong>
              <span className="tiny">
                {phase === "soundcheck" ? "Soundcheck" : isRecording ? "Recording" : "Mic idle"}
              </span>
            </div>
          </article>

          <article className={`call-tile call-coach ${manualCoachSpeaking ? "is-speaking" : ""}`}>
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
              <span className="tiny">{coachStatus}</span>
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
            <strong>{hasDisplayTranscriptMetrics ? displayWpm.toFixed(0) : "N/A"}</strong>
            <small>
              {hasDisplayTranscriptMetrics
                ? `130-150 target · ${wpmLabel(displayWpm)}`
                : "Needs transcript (Chrome/Edge, OpenAI fallback, or typed text)"}
            </small>
          </div>
          <div className="metric-pill">
            <span>Fillers</span>
            <strong>{hasDisplayTranscriptMetrics ? displayFillers : "N/A"}</strong>
            <small>{displayTopFillersLabel}</small>
          </div>
          <div className="metric-pill">
            <span>Pauses</span>
            <strong>{displayPauseSeconds.toFixed(1)}s</strong>
            <small>
              {displayPauseCount} over threshold · longest {(displayLongestPauseMs / 1000).toFixed(1)}s
            </small>
          </div>
          <div className="metric-pill">
            <span>Mic</span>
            <strong>
              {micStatus.icon} {micStatus.label}
            </strong>
          </div>
        </div>

        {phase === "soundcheck" && (
          <section className="call-chat-card stack">
            <h3>Pre-call soundcheck ({soundcheckCountdown}s)</h3>
            <p className="tiny">
              Mic status: {buildMicStatus(audio.rms).label}. Quick tips before Q1:
            </p>
            <ul>
              <li>Face a light source so your face is clear.</li>
              <li>Keep your camera at eye level.</li>
              <li>Use a headset to reduce echo and noise.</li>
            </ul>
            <div className="controls">
              <button className="btn btn-primary" onClick={startInterviewFlow}>
                Start interview
              </button>
              <button className="btn btn-ghost" onClick={leaveInterview}>
                Back to setup
              </button>
            </div>
          </section>
        )}

        {phase === "interview" && currentTurn && (
          <section className="call-chat-card stack">
            <div className="question-header">
              <h3>Current Question</h3>
              <span className="tiny">
                Q {primaryIndex + 1}/{session.settings.questionCount}
                {followupIndex !== null ? ` · Follow-up ${followupIndex + 1}` : ""}
              </span>
            </div>

            <div className="question-tabs">
              <button
                className={`btn btn-ghost ${panelTab === "question" ? "is-active" : ""}`}
                onClick={() => setPanelTab("question")}
              >
                Question
              </button>
              <button
                className={`btn btn-ghost ${panelTab === "transcript" ? "is-active" : ""}`}
                onClick={() => setPanelTab("transcript")}
              >
                Transcript
              </button>
            </div>

            {panelTab === "question" ? (
              <div className="current-question-text">{currentTurn.question}</div>
            ) : (
              <div className="transcript-block stack">
                {isRecording && liveTranscript ? (
                  <div>{liveTranscript}</div>
                ) : currentTurn.transcript ? (
                  <div>{currentTurn.transcript}</div>
                ) : (
                  <div>No transcript yet.</div>
                )}
                <textarea
                  rows={5}
                  value={manualTranscript}
                  placeholder="If live transcript misses your speech, type your answer here before stopping."
                  onChange={(event) => setManualTranscript(event.target.value)}
                />
                {!speech.isSupported && (
                  <p className="tiny">
                    Browser speech recognition is unavailable in this browser.
                  </p>
                )}
                {speech.lastError && <p className="tiny">Speech error: {speech.lastError}</p>}
              </div>
            )}

            {currentTurn.hint && <p className="hint-text">Hint: {currentTurn.hint}</p>}

            {currentTurn.rubric && (
              <div className="rubric-card">
                <h4>Rubric feedback</h4>
                <div className="rubric-grid">
                  {Object.entries(currentTurn.rubric.scores).map(([key, value]) => (
                    <div key={key} className="rubric-score-pill">
                      <span>{key}</span>
                      <strong>{value}/5</strong>
                    </div>
                  ))}
                </div>
                <div className="rubric-columns">
                  <div>
                    <strong>What was good</strong>
                    <ul>
                      {currentTurn.rubric.what_was_good.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>What to improve</strong>
                    <ul>
                      {currentTurn.rubric.what_to_improve.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <strong>Ideal answer outline</strong>
                <ul>
                  {currentTurn.rubric.ideal_answer_outline.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {session.turns[primaryIndex]?.followups.length > 0 && (
              <div className="followup-list stack">
                <strong>Follow-ups</strong>
                {session.turns[primaryIndex].followups.map((followup, index) => (
                  <div key={followup.id} className="followup-item">
                    <div>
                      F{index + 1}: {followup.question}
                    </div>
                    <small>{followup.transcript ? "Answered" : "Pending"}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="chat-actions">
              <button
                className={`btn ${isRecording ? "btn-warn" : "btn-primary"}`}
                onClick={isRecording ? stopAnswer : startAnswer}
                disabled={isCoachThinking}
              >
                {isRecording ? "Stop answer" : "Start answer"}
              </button>
              <button className="btn btn-ghost" onClick={skipCurrent} disabled={isRecording}>
                Skip
              </button>
              <button
                className="btn btn-ghost"
                onClick={repeatQuestion}
                disabled={isRepeatLoading}
              >
                {isRepeatLoading ? "Repeating..." : "Repeat"}
              </button>
              <button className="btn btn-ghost" onClick={askForHint} disabled={isRecording}>
                Ask for hint
              </button>
              <button className="btn btn-ghost" onClick={finalizeSession}>
                End session
              </button>
            </div>
          </section>
        )}

        {phase === "interview" && !currentTurn && (
          <section className="call-chat-card stack">
            <p className="tiny">Preparing questions...</p>
          </section>
        )}

        {phase === "summary" && session.summary && (
          <section className="call-chat-card stack">
            <h3>Session summary</h3>
            <p className="tiny">Overall score: {session.summary.overallScore.toFixed(2)} / 5</p>

            <div className="rubric-columns">
              <div>
                <strong>Top strengths</strong>
                <ul>
                  {session.summary.topStrengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Top weaknesses</strong>
                <ul>
                  {session.summary.topWeaknesses.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="summary-recommendation">
              <strong>Recommended next practice set</strong>
              <p className="tiny">
                {session.summary.recommendedNextConfig.category} · {session.summary.recommendedNextConfig.interviewType} · {session.summary.recommendedNextConfig.difficulty} · {session.summary.recommendedNextConfig.questionCount} questions
              </p>
            </div>

            <div className="controls">
              <button className="btn btn-primary" onClick={() => router.push("/history")}>
                View history
              </button>
              <button className="btn btn-ghost" onClick={() => router.push("/")}>
                New interview
              </button>
            </div>
          </section>
        )}

        {(warning || error) && <p className="call-warning">{warning ?? error}</p>}
      </section>
    </main>
  );
}
