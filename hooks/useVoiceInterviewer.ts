"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionManager, type ConnectionState } from "@/lib/voice/connectionManager";
import { transcribeAudioBlob } from "@/lib/voice/transcribeClient";
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

const DEFAULT_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_SILENCE_MS = 2500;
const STREAM_SETTLE_MS = 900;
const STREAM_HARD_SETTLE_MS = 2200;
const DEFAULT_DEAD_CONNECTION_MS = 6 * 60 * 1000;
const DEFAULT_VOICE_WS_URL = "ws://127.0.0.1:8008/ws";
const VOICE_WS_OVERRIDE_KEY = "VOICE_WS_URL";
const COACH_CAPTURE_GUARD_MS = 1400;
const PLAYBACK_IDLE_GAP_MS = 500;
const ENABLE_COACH_STT_FALLBACK = process.env.NEXT_PUBLIC_COACH_STT_FALLBACK !== "0";
const COACH_STT_TIMEOUT_MS = 3500;

function normalizeWsUrl(raw: string) {
  const configured = raw.trim();
  if (!configured) return "";
  if (configured.startsWith("ws://") || configured.startsWith("wss://")) {
    try {
      const parsed = new URL(configured);
      if (
        parsed.protocol === "ws:" &&
        parsed.hostname.toLowerCase().endsWith(".proxy.runpod.net")
      ) {
        parsed.protocol = "wss:";
        return parsed.toString();
      }
    } catch {
      // fall through and return raw value
    }
    return configured;
  }
  if (configured.startsWith("http://")) {
    const value = configured.slice("http://".length);
    if (value.toLowerCase().includes(".proxy.runpod.net")) {
      return "wss://" + value;
    }
    return "ws://" + value;
  }
  if (configured.startsWith("https://")) {
    return "wss://" + configured.slice("https://".length);
  }
  if (configured.toLowerCase().includes(".proxy.runpod.net")) {
    return `wss://${configured}`;
  }
  return `ws://${configured}`;
}

function resolveVoiceWsUrl() {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get("voice_ws");
    if (urlParam?.trim()) {
      const normalized = normalizeWsUrl(urlParam);
      if (normalized) {
        window.localStorage.setItem(VOICE_WS_OVERRIDE_KEY, normalized);
        return normalized;
      }
    }

    const stored = window.localStorage.getItem(VOICE_WS_OVERRIDE_KEY);
    if (stored?.trim()) {
      const normalized = normalizeWsUrl(stored);
      if (normalized) return normalized;
    }
  }

  const configured = process.env.NEXT_PUBLIC_VOICE_WS_URL?.trim();
  if (!configured) return DEFAULT_VOICE_WS_URL;
  return normalizeWsUrl(configured);
}

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

function normalizeGeneratedText(parts: string[]) {
  return parts
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function normalizeSubtopic(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 48);
}

function hasSentenceEnding(text: string) {
  return /[.!?]["')\]]?\s*$/.test(text);
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function pcm16ChunksToWavBlob(chunks: Int16Array[], sampleRate: number): Blob | null {
  if (!chunks.length) return null;
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalSamples <= 0) return null;

  const dataBytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const pcm = new Int16Array(buffer, 44, totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function meanAbsPcm16(chunks: Int16Array[]) {
  let total = 0;
  let count = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      total += Math.abs(chunk[i]);
    }
    count += chunk.length;
  }
  if (count === 0) return 0;
  return total / count;
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

async function fetchFallbackQuestion(config: InterviewConfig, topic: string) {
  const normalizedTopic = normalizeSubtopic(topic);
  const subtopics = normalizedTopic
    ? Array.from(new Set([normalizedTopic, ...config.subtopics])).slice(0, 8)
    : config.subtopics.slice(0, 8);

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
          subtopics
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
  const [lastCoachAudioAt, setLastCoachAudioAt] = useState(0);

  const onWarningRef = useRef(onWarning);
  const connectionStateRef = useRef<ConnectionState>("connecting");
  const textQueueRef = useRef<string[]>([]);
  const audioOutCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playbackQueueRef = useRef(Promise.resolve());
  const playTimeoutRef = useRef<number | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const lastAudioOutAtRef = useRef(0);
  const coachPcmChunksRef = useRef<Int16Array[]>([]);
  const coachSampleRateRef = useRef(24000);
  const managerRef = useRef<ConnectionManager<VoiceClientMessage, VoiceServerMessage> | null>(
    null
  );
  const sessionIdRef = useRef(createId());

  useEffect(() => {
    onWarningRef.current = onWarning;
  }, [onWarning]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const wsUrl = useMemo(() => resolveVoiceWsUrl(), []);

  const primeAudio = useCallback(async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state !== "running") {
      try {
        await audioCtxRef.current.resume();
      } catch {
        // Ignore browser policy failures; playback path will retry.
      }
    }
  }, []);

  const schedulePlayback = useCallback(async (pcm: Int16Array, sampleRate: number) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // continue; some browsers can still start once user interacts again
      }
    }
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
    }, remainingMs + PLAYBACK_IDLE_GAP_MS);
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
        const now = Date.now();
        lastAudioOutAtRef.current = now;
        setLastCoachAudioAt(now);
        const sampleRate = Number(message.sampleRate || 16000);
        const pcm = base64ToInt16(message.data);
        if (pcm.length > 0) {
          coachPcmChunksRef.current.push(pcm);
          coachSampleRateRef.current = sampleRate;
          playbackQueueRef.current = playbackQueueRef.current
            .then(() => schedulePlayback(pcm, sampleRate))
            .catch(() => undefined);
        }
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
          deadConnectionMs: DEFAULT_DEAD_CONNECTION_MS,
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
            onWarningRef.current(`${message} [${wsUrl}]`);
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
    textQueueRef.current = [];
    coachPcmChunksRef.current = [];
    playbackQueueRef.current = Promise.resolve();
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
    let lastSignalAt: number | null = null;
    let lastAudioCount = audioStartCount;
    const textParts: string[] = [];

    while (Date.now() - startedAt < timeoutMs) {
      if (connectionStateRef.current !== "connected") {
        const disconnectedText = normalizeGeneratedText(textParts);
        return {
          text: disconnectedText || null,
          audioSeen: audioOutCountRef.current > audioStartCount || Boolean(disconnectedText)
        };
      }

      while (textQueueRef.current.length > 0) {
        const next = textQueueRef.current.shift();
        if (!next) continue;
        textParts.push(next);
        lastSignalAt = Date.now();
      }

      if (audioOutCountRef.current > lastAudioCount) {
        lastAudioCount = audioOutCountRef.current;
        lastSignalAt = Date.now();
      }

      if (lastSignalAt !== null) {
        const quietMs = Date.now() - lastSignalAt;
        const text = normalizeGeneratedText(textParts);
        if (
          quietMs >= STREAM_HARD_SETTLE_MS ||
          (quietMs >= STREAM_SETTLE_MS && text.length > 0 && hasSentenceEnding(text))
        ) {
          return { text: text || null, audioSeen: lastAudioCount > audioStartCount || Boolean(text) };
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }

    const text = normalizeGeneratedText(textParts) || null;
    return {
      text,
      audioSeen: audioOutCountRef.current > audioStartCount || Boolean(text)
    };
  }, []);

  const requestCoachTurn = useCallback(
    async (context: VoiceContext, options?: RequestCoachTurnOptions) => {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_MS;
      const silenceMs = options?.silenceMs ?? 0;

      if (connectionState === "connected" && serverReady) {
        await primeAudio();
        const audioStartCount = audioOutCountRef.current;
        textQueueRef.current = [];
        coachPcmChunksRef.current = [];
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
          if (ENABLE_COACH_STT_FALLBACK) {
            const totalSamples = coachPcmChunksRef.current.reduce(
              (sum, chunk) => sum + chunk.length,
              0
            );
            if (totalSamples >= 4000) {
              const wavBlob = pcm16ChunksToWavBlob(
                coachPcmChunksRef.current,
                coachSampleRateRef.current
              );
              if (wavBlob) {
                const recovered = await Promise.race([
                  transcribeAudioBlob(wavBlob, "en", { voiceWsUrl: wsUrl }),
                  new Promise<{ transcript: string; error: string | null }>((resolve) =>
                    window.setTimeout(
                      () => resolve({ transcript: "", error: "timeout" }),
                      COACH_STT_TIMEOUT_MS
                    )
                  )
                ]);
                if (recovered.transcript) {
                  return { text: recovered.transcript, usedVoice: true };
                }
              }
            }
          }
          const meanAbs = meanAbsPcm16(coachPcmChunksRef.current);
          if (meanAbs < 80) {
            return { text: null, usedVoice: false };
          }
          return { text: null, usedVoice: true };
        }
      }

      const fallbackText = await fetchFallbackQuestion(interviewConfig, context.topic);
      if (fallbackText) {
        return { text: fallbackText, usedVoice: false };
      }

      return { text: buildFallbackCoachText(context), usedVoice: false };
    },
    [
      connectionState,
      endUtterance,
      interviewConfig,
      primeAudio,
      sendContext,
      sendSilence,
      serverReady,
      waitForCoachOutput,
      wsUrl
    ]
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
      if (Date.now() - lastAudioOutAtRef.current < COACH_CAPTURE_GUARD_MS) {
        return;
      }
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
    coachPcmChunksRef.current = [];
    playbackQueueRef.current = Promise.resolve();
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
    wsUrl,
    lastCoachAudioAt,
    connectionState,
    queueSize,
    status: connectionState,
    isPlaying,
    isReady: connectionState === "connected" && serverReady,
    connect,
    disconnect,
    primeAudio,
    retryNow,
    startCapture,
    stopCapture,
    endUtterance,
    requestCoachTurn,
    requestOpeningQuestion,
    reset
  };
}
