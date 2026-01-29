"use client";

import { useCallback, useEffect, useState } from "react";

export function useMediaStream() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    if (stream) return stream;
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Media devices are not supported in this browser.");
        return null;
      }
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      setStream(newStream);
      return newStream;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to access media devices.";
      setError(message);
      return null;
    }
  }, [stream]);

  const stop = useCallback(() => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }, [stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  return {
    stream,
    error,
    request,
    stop
  };
}
