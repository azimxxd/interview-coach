"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionManager, type ConnectionState } from "@/lib/voice/connectionManager";
import type { InterviewConfig } from "@/lib/schema/interview";

type VoiceClientMessage =
  | {
      type: "hello";
      sessionId: string;
      lang: "en";
      mode: "interviewer";
      role?: string;
      level?: string;
      topic?: string;
    }
  | {
      type: "context";
      role: string;
      level: string;
      topic: string;
      previous?: Array<{ question: string; answer: string }>;
    }
  | {
      type: "audio";
      format: "pcm16";
      sampleRate: number;
      channels: 1;
      data: string;
    }
  | { type: "end_utterance" }
  | { type: "reset" };

type VoiceServerMessage =
  | { type: "ready" }
  | {
      type: "audio_out";
      format: "pcm16";
      sampleRate: number;
      channels: 1;
      data: string;
    }
  | { type: "text_out"; text: string }
  | { type: "error"; message: string };

type VoiceContext = {
  topic: string;
  previous?: Array<{ question: string; answer: string }>;
};

type VoiceInterviewerConfig = {
  enabled: boolean;
  stream: MediaStream | null;
  interviewConfig: InterviewConfig;
  onWarning: (message: string) => void;
};

type RequestCoachTurnOptions = {
  timeoutMs?: number;
  silenceMs?: number;
};

const DEFAULT_WAIT_MS = 180000;
const DEFAULT_SILENCE_MS = 1200;
const AUDIO_TEXT_GRACE_MS = 6000;

function base64ToInt16(base64: string) {
  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function downsampleTo16k(buffer: Float32Array, inputRate: number) {
  if (inputRate === 16000) return buffer;
  const ratio = inputRate / 16000;
  const length = Math.floor(buffer.length / ratio);
  const result = new Float32Array(length);
  let offset = 0;
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(offset);
    result[i] = buffer[index] ?? 0;
    offset += ratio;
  }
  return result;
}

function floatTo16BitPCM(float32: Float32Array) {
  const output = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function pcm16ToBase64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function silenceChunkBase64(durationMs: number) {
  const sampleCount = Math.max(1, Math.round((16000 * durationMs) / 1000));
  const pcm = new Int16Array(sampleCount);
  return pcm16ToBase64(pcm);
}

function buildFallbackCoachText(context: VoiceContext) {
  const topic = context.topic?.trim() || "a recent project";
  return `Tell me about ${topic} and the key tradeoffs in your approach.`;
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

async function fetchFallbackQuestion(config: InterviewConfig, topic: string) {
  try {
    const result = await fetch("/api/interview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "generate_primary_questions",
        config: {
          ...config,
          subtopics: Array.from(new Set([topic, ...config.subtopics])).slice(0, 8)
        },
        count: 1
      })
    });

    if (!result.ok) return null;
    const payload = (await result.json()) as { questions?: string[] };
    return payload.questions?.[0] ?? null;
  } catch {
    return null;
  }
}

export function useVoiceInterviewer({
  enabled,
  stream,
  interviewConfig,
  onWarning
}: VoiceInterviewerConfig) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [serverReady, setServerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueSize, setQueueSize] = useState(0);

  const onWarningRef = useRef(onWarning);
  const textQueueRef = useRef<string[]>([]);
  const audioOutCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playTimeoutRef = useRef<number | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const managerRef = useRef<ConnectionManager<VoiceClientMessage, VoiceServerMessage> | null>(
    null
  );
  const sessionIdRef = useRef(createId());

  useEffect(() => {
    onWarningRef.current = onWarning;
  }, [onWarning]);

  const wsUrl = useMemo(() => "ws://127.0.0.1:8008/ws", []);

  const schedulePlayback = useCallback((pcm: Int16Array, sampleRate: number) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    const float32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) {
      float32[i] = pcm[i] / 0x8000;
    }
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playbackTimeRef.current);
    source.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
    setIsPlaying(true);
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
    }
    const remainingMs = Math.max(0, (playbackTimeRef.current - ctx.currentTime) * 1000);
    playTimeoutRef.current = window.setTimeout(() => {
      setIsPlaying(false);
    }, remainingMs + 80);
  }, []);

  const handleServerMessage = useCallback(
    (message: VoiceServerMessage) => {
      if (message.type === "ready") {
        setServerReady(true);
        return;
      }
      if (message.type === "text_out") {
        if (message.text) {
          textQueueRef.current.push(String(message.text));
        }
        return;
      }
      if (message.type === "audio_out") {
        audioOutCountRef.current += 1;
        const sampleRate = Number(message.sampleRate || 16000);
        schedulePlayback(base64ToInt16(message.data), sampleRate);
        return;
      }
      if (message.type === "error") {
        onWarningRef.current(message.message || "Voice server error.");
      }
    },
    [schedulePlayback]
  );

  const syncQueueSize = useCallback(() => {
    const next = managerRef.current?.getQueueSize() ?? 0;
    setQueueSize(next);
  }, []);

  const connect = useCallback(async () => {
    if (!enabled) return false;

    if (!managerRef.current) {
      managerRef.current = new ConnectionManager<VoiceClientMessage, VoiceServerMessage>(
        wsUrl,
        {
          maxAttempts: 8,
          baseDelayMs: 600,
          maxDelayMs: 10000,
          jitterRatio: 0.3,
          heartbeatIntervalMs: 12000,
          deadConnectionMs: 28000,
          createHeartbeatMessage: () => ({
            type: "hello",
            sessionId: sessionIdRef.current,
            lang: "en",
            mode: "interviewer",
            role: interviewConfig.category,
            level: interviewConfig.difficulty,
            topic: interviewConfig.interviewType
          }),
          onOpen: () => {
            setServerReady(false);
            managerRef.current?.send({
              type: "hello",
              sessionId: sessionIdRef.current,
              lang: "en",
              mode: "interviewer",
              role: interviewConfig.category,
              level: interviewConfig.difficulty,
              topic: interviewConfig.interviewType
            });
            syncQueueSize();
          },
          onStateChange: (state) => {
            setConnectionState(state);
            syncQueueSize();
          },
          onMessage: (message) => {
            handleServerMessage(message);
            syncQueueSize();
          },
          onError: (message) => {
            onWarningRef.current(message);
            syncQueueSize();
          }
        }
      );
    }

    managerRef.current.start();
    return true;
  }, [enabled, handleServerMessage, interviewConfig, syncQueueSize, wsUrl]);

  const disconnect = useCallback(() => {
    managerRef.current?.stop();
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }
    setIsPlaying(false);
    setServerReady(false);
    setConnectionState("offline");
    syncQueueSize();
  }, [syncQueueSize]);

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const handleOnline = () => manager.setOnlineStatus(true);
    const handleOffline = () => manager.setOnlineStatus(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(syncQueueSize, 300);
    return () => window.clearInterval(timer);
  }, [syncQueueSize]);

  const sendContext = useCallback(
    (context: VoiceContext) => {
      managerRef.current?.send({
        type: "context",
        role: interviewConfig.category,
        level: interviewConfig.difficulty,
        topic: `${interviewConfig.interviewType} | ${context.topic}`,
        previous: context.previous
      });
      syncQueueSize();
    },
    [interviewConfig, syncQueueSize]
  );

  const sendSilence = useCallback((totalMs: number) => {
    const chunkMs = 200;
    const chunks = Math.max(1, Math.ceil(totalMs / chunkMs));
    const data = silenceChunkBase64(chunkMs);
    for (let i = 0; i < chunks; i += 1) {
      managerRef.current?.send({
        type: "audio",
        format: "pcm16",
        sampleRate: 16000,
        channels: 1,
        data
      });
    }
    syncQueueSize();
  }, [syncQueueSize]);

  const endUtterance = useCallback(() => {
    managerRef.current?.send({ type: "end_utterance" });
    syncQueueSize();
  }, [syncQueueSize]);

  const waitForCoachOutput = useCallback(async (timeoutMs: number, audioStartCount: number) => {
    const startedAt = Date.now();
    let audioDetectedAt: number | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      const next = textQueueRef.current.shift();
      if (next) return { text: next, audioSeen: true };

      if (audioOutCountRef.current > audioStartCount) {
        if (!audioDetectedAt) {
          audioDetectedAt = Date.now();
        } else if (Date.now() - audioDetectedAt >= AUDIO_TEXT_GRACE_MS) {
          return { text: null, audioSeen: true };
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }

    return {
      text: null,
      audioSeen: audioOutCountRef.current > audioStartCount
    };
  }, []);

  const requestCoachTurn = useCallback(
    async (context: VoiceContext, options?: RequestCoachTurnOptions) => {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_MS;
      const silenceMs = options?.silenceMs ?? 0;

      if (connectionState === "connected" && serverReady) {
        const audioStartCount = audioOutCountRef.current;
        textQueueRef.current = [];
        sendContext(context);
        if (silenceMs > 0) {
          sendSilence(silenceMs);
        }
        endUtterance();
        const output = await waitForCoachOutput(timeoutMs, audioStartCount);
        const text = output.text?.trim() ? output.text : null;
        if (text) {
          return { text, usedVoice: true };
        }
        if (output.audioSeen) {
          return { text: buildFallbackCoachText(context), usedVoice: true };
        }
      }

      const fallbackText = await fetchFallbackQuestion(interviewConfig, context.topic);
      if (fallbackText) {
        return { text: fallbackText, usedVoice: false };
      }

      return { text: buildFallbackCoachText(context), usedVoice: false };
    },
    [connectionState, endUtterance, interviewConfig, sendContext, sendSilence, serverReady, waitForCoachOutput]
  );

  const requestOpeningQuestion = useCallback(
    async (context: VoiceContext) => {
      return requestCoachTurn(context, {
        silenceMs: DEFAULT_SILENCE_MS,
        timeoutMs: DEFAULT_WAIT_MS
      });
    },
    [requestCoachTurn]
  );

  const startCapture = useCallback(async () => {
    if (!enabled || !stream || connectionState !== "connected") return;
    if (processorRef.current) return;

    const ctx = new AudioContext();
    captureCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const gain = ctx.createGain();
    gain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleTo16k(input, ctx.sampleRate);
      const pcm16 = floatTo16BitPCM(downsampled);
      const data = pcm16ToBase64(pcm16);
      managerRef.current?.send({
        type: "audio",
        format: "pcm16",
        sampleRate: 16000,
        channels: 1,
        data
      });
    };

    source.connect(processor);
    processor.connect(gain);
    gain.connect(ctx.destination);
    processorRef.current = processor;
  }, [connectionState, enabled, stream]);

  const stopCapture = useCallback(() => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (captureCtxRef.current) {
      captureCtxRef.current.close().catch(() => undefined);
      captureCtxRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    textQueueRef.current = [];
    managerRef.current?.send({ type: "reset" });
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }
    setIsPlaying(false);
    syncQueueSize();
  }, [syncQueueSize]);

  const retryNow = useCallback(() => {
    managerRef.current?.retryNow();
  }, []);

  return {
    connectionState,
    queueSize,
    status: connectionState,
    isPlaying,
    isReady: connectionState === "connected" && serverReady,
    connect,
    disconnect,
    retryNow,
    startCapture,
    stopCapture,
    endUtterance,
    requestCoachTurn,
    requestOpeningQuestion,
    reset
  };
}
