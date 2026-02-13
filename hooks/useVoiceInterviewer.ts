"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceWsClient } from "@/lib/voice/wsClient";

type VoiceContext = {
  role: string;
  level: string;
  topic: string;
  previous?: Array<{ question: string; answer: string }>;
};

type VoiceStatus = "idle" | "connecting" | "ready" | "error";

type VoiceInterviewerConfig = {
  enabled: boolean;
  stream: MediaStream | null;
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
  const level = context.level?.trim() || "your";
  const role = context.role?.trim() || "role";
  return `Tell me about ${topic} from your ${level} ${role} experience.`;
}

export function useVoiceInterviewer({
  enabled,
  stream,
  onWarning
}: VoiceInterviewerConfig) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [isPlaying, setIsPlaying] = useState(false);

  const onWarningRef = useRef(onWarning);
  const textQueueRef = useRef<string[]>([]);
  const audioOutCountRef = useRef(0);
  const closedByUserRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playTimeoutRef = useRef<number | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const clientRef = useRef<VoiceWsClient | null>(null);

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
    (message: any) => {
      if (message.type === "ready") {
        setStatus("ready");
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
        setStatus("error");
      }
    },
    [schedulePlayback]
  );

  const connect = useCallback(async () => {
    if (!enabled) return false;
    if (clientRef.current?.isOpen()) return true;
    closedByUserRef.current = false;
    setStatus("connecting");
    try {
      const client = new VoiceWsClient(wsUrl, {
        onMessage: handleServerMessage,
        onError: (message) => {
          onWarningRef.current(message);
          setStatus("error");
        },
        onClose: () => {
          if (!closedByUserRef.current && enabled) {
            setStatus("error");
          }
        }
      });
      clientRef.current = client;
      await client.connect();
      client.send({
        type: "hello",
        sessionId: `${Date.now()}`,
        lang: "en",
        mode: "interviewer"
      });
      setStatus("ready");
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }, [enabled, handleServerMessage, wsUrl]);

  const disconnect = useCallback(() => {
    closedByUserRef.current = true;
    clientRef.current?.disconnect();
    clientRef.current = null;
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }
    setIsPlaying(false);
    setStatus("idle");
  }, []);

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

  const sendContext = useCallback((context: VoiceContext) => {
    if (!clientRef.current?.isOpen()) return;
    clientRef.current.send({ type: "context", ...context });
  }, []);

  const sendSilence = useCallback((totalMs: number) => {
    if (!clientRef.current?.isOpen()) return;
    const chunkMs = 200;
    const chunks = Math.max(1, Math.ceil(totalMs / chunkMs));
    const data = silenceChunkBase64(chunkMs);
    for (let i = 0; i < chunks; i += 1) {
      clientRef.current.send({
        type: "audio",
        format: "pcm16",
        sampleRate: 16000,
        channels: 1,
        data
      });
    }
  }, []);

  const endUtterance = useCallback(() => {
    if (!clientRef.current?.isOpen()) return;
    clientRef.current.send({ type: "end_utterance" });
  }, []);

  const waitForCoachOutput = useCallback(
    async (timeoutMs: number, audioStartCount: number) => {
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
    },
    []
  );

  const requestCoachTurn = useCallback(
    async (context: VoiceContext, options?: RequestCoachTurnOptions) => {
      if (!enabled || !clientRef.current?.isOpen()) {
        return { text: null, usedVoice: false };
      }
      const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_MS;
      const silenceMs = options?.silenceMs ?? 0;
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
      return { text: null, usedVoice: true };
    },
    [enabled, endUtterance, sendContext, sendSilence, waitForCoachOutput]
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
    if (!enabled || !stream || !clientRef.current?.isOpen()) return;
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
      clientRef.current?.send({
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
  }, [enabled, stream]);

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
    if (clientRef.current?.isOpen()) {
      clientRef.current.send({ type: "reset" });
    }
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  return {
    status,
    isPlaying,
    isReady: status === "ready",
    connect,
    disconnect,
    startCapture,
    stopCapture,
    endUtterance,
    requestCoachTurn,
    requestOpeningQuestion,
    reset
  };
}
