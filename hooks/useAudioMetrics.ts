"use client";

import { useEffect, useRef, useState } from "react";

const SAMPLE_INTERVAL = 100;
const PAUSE_THRESHOLD = 0.02;
const PAUSE_MIN_MS = 600;

export function useAudioMetrics(stream: MediaStream | null, isActive: boolean) {
  const [rms, setRms] = useState(0);
  const [pauseSeconds, setPauseSeconds] = useState(0);
  const [pauseCount, setPauseCount] = useState(0);
  const [longestPauseMs, setLongestPauseMs] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const intervalRef = useRef<number | null>(null);
  const silentMsRef = useRef(0);
  const totalPauseMsRef = useRef(0);
  const inPauseRef = useRef(false);
  const currentPauseMsRef = useRef(0);

  const reset = () => {
    setRms(0);
    setPauseSeconds(0);
    setPauseCount(0);
    setLongestPauseMs(0);
    silentMsRef.current = 0;
    totalPauseMsRef.current = 0;
    inPauseRef.current = false;
    currentPauseMsRef.current = 0;
  };

  useEffect(() => {
    if (!stream || !isActive) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      return;
    }

    const AudioContextCtor =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return () => undefined;
    }
    const audioContext = new AudioContextCtor();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.fftSize);

    intervalRef.current = window.setInterval(() => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rmsValue = Math.sqrt(sumSquares / data.length);
      setRms(rmsValue);

      if (rmsValue < PAUSE_THRESHOLD) {
        silentMsRef.current += SAMPLE_INTERVAL;
        if (!inPauseRef.current && silentMsRef.current >= PAUSE_MIN_MS) {
          inPauseRef.current = true;
          currentPauseMsRef.current = PAUSE_MIN_MS;
          setPauseCount((prev) => prev + 1);
        }
        if (inPauseRef.current) {
          totalPauseMsRef.current += SAMPLE_INTERVAL;
          currentPauseMsRef.current += SAMPLE_INTERVAL;
          setPauseSeconds(totalPauseMsRef.current / 1000);
          setLongestPauseMs((prev) => Math.max(prev, currentPauseMsRef.current));
        }
      } else {
        silentMsRef.current = 0;
        inPauseRef.current = false;
        currentPauseMsRef.current = 0;
      }
    }, SAMPLE_INTERVAL);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      audioContext.close().catch(() => undefined);
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [stream, isActive]);

  return { rms, pauseSeconds, pauseCount, longestPauseMs, reset };
}
