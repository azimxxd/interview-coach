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

type PendingAudio = {
  data: string;
  sampleRate: number;
};

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
    const s = Math.max(-1, Math.min(1, float32[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
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

export function useVoiceInterviewer({
  enabled,
  stream,
  onWarning
}: VoiceInterviewerConfig) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const pendingAudioRef = useRef<PendingAudio[]>([]);
  const playOnReceiveRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playTimeoutRef = useRef<number | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const clientRef = useRef<VoiceWsClient | null>(null);

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
    if (playTimeoutRef.current) window.clearTimeout(playTimeoutRef.current);
    const remainingMs = Math.max(0, (playbackTimeRef.current - ctx.currentTime) * 1000);
    playTimeoutRef.current = window.setTimeout(() => {
      setIsPlaying(false);
    }, remainingMs + 30);
  }, []);

  const handleServerMessage = useCallback(
    (message: any) => {
      if (message.type === "ready") {
        setStatus("ready");
        return;
      }
      if (message.type === "text_out") {
        pendingTextRef.current = message.text;
        setPendingText(message.text);
        return;
      }
      if (message.type === "audio_out") {
        const sampleRate = Number(message.sampleRate || 16000);
        if (playOnReceiveRef.current) {
          schedulePlayback(base64ToInt16(message.data), sampleRate);
        } else {
          pendingAudioRef.current.push({ data: message.data, sampleRate });
        }
        return;
      }
      if (message.type === "error") {
        onWarning(message.message);
        setStatus("error");
      }
    },
    [onWarning, schedulePlayback]
  );

  const connect = useCallback(async () => {
    if (!enabled) return false;
    if (clientRef.current?.isOpen()) return true;
    setStatus("connecting");
    try {
      const client = new VoiceWsClient(wsUrl, {
        onMessage: handleServerMessage,
        onError: (msg) => {
          onWarning(msg);
          setStatus("error");
        },
        onClose: () => {
          if (enabled) setStatus("error");
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
    } catch (err) {
      setStatus("error");
      return false;
    }
  }, [enabled, handleServerMessage, onWarning, wsUrl]);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }
    connect();
  }, [connect, disconnect, enabled]);

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

  const endUtterance = useCallback(() => {
    if (!enabled || !clientRef.current?.isOpen()) return;
    playOnReceiveRef.current = false;
    clientRef.current.send({ type: "end_utterance" });
  }, [enabled]);

  const requestQuestion = useCallback(
    async (context: VoiceContext) => {
      if (!enabled || !clientRef.current?.isOpen()) return { text: null, usedVoice: false };

      const hasPending = pendingAudioRef.current.length > 0;
      if (hasPending) {
        playOnReceiveRef.current = true;
        pendingAudioRef.current.forEach((chunk) => {
          schedulePlayback(base64ToInt16(chunk.data), chunk.sampleRate);
        });
        pendingAudioRef.current = [];
        const text = pendingTextRef.current;
        pendingTextRef.current = null;
        setPendingText(null);
        return { text, usedVoice: true };
      }

      playOnReceiveRef.current = true;
      pendingTextRef.current = null;
      setPendingText(null);
      clientRef.current.send({ type: "context", ...context });
      clientRef.current.send({ type: "end_utterance" });

      const waitForText = new Promise<string | null>((resolve) => {
        const timeout = window.setTimeout(() => resolve(null), 1200);
        const check = () => {
          if (pendingTextRef.current) {
            window.clearTimeout(timeout);
            resolve(pendingTextRef.current);
            return;
          }
          window.setTimeout(check, 100);
        };
        check();
      });
      const text = await waitForText;
      if (text) {
        pendingTextRef.current = null;
        setPendingText(null);
      }
      return { text, usedVoice: true };
    },
    [enabled, schedulePlayback]
  );

  const reset = useCallback(() => {
    pendingAudioRef.current = [];
    pendingTextRef.current = null;
    setPendingText(null);
    playOnReceiveRef.current = false;
    if (clientRef.current?.isOpen()) {
      clientRef.current.send({ type: "reset" });
    }
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
    requestQuestion,
    reset
  };
}
