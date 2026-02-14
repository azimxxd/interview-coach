"use client";

import { useCallback, useEffect, useRef } from "react";

const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus"
];

function pickSupportedMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return null;
  }
  for (const type of RECORDER_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return null;
}

export function useAnswerRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const buildBlob = useCallback((mimeType?: string) => {
    if (!chunksRef.current.length) return null;
    return new Blob(chunksRef.current, {
      type: mimeType || "audio/webm"
    });
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return null;

    if (recorder.state === "inactive") {
      const blob = buildBlob(recorder.mimeType);
      chunksRef.current = [];
      recorderRef.current = null;
      return blob;
    }

    return await new Promise<Blob | null>((resolve) => {
      let settled = false;
      const finalize = () => {
        if (settled) return;
        settled = true;
        const blob = buildBlob(recorder.mimeType);
        chunksRef.current = [];
        recorderRef.current = null;
        resolve(blob);
      };

      const timeout = window.setTimeout(finalize, 1500);
      recorder.addEventListener(
        "stop",
        () => {
          window.clearTimeout(timeout);
          finalize();
        },
        { once: true }
      );
      recorder.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          finalize();
        },
        { once: true }
      );

      try {
        recorder.stop();
      } catch {
        window.clearTimeout(timeout);
        finalize();
      }
    });
  }, [buildBlob]);

  const start = useCallback(
    (stream: MediaStream) => {
      if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
        return false;
      }

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) return false;

      const existing = recorderRef.current;
      if (existing && existing.state !== "inactive") {
        try {
          existing.stop();
        } catch {
          // Ignore stop errors from stale recorders.
        }
      }

      chunksRef.current = [];

      try {
        const audioOnlyStream = new MediaStream(audioTracks);
        const mimeType = pickSupportedMimeType();
        const recorder = mimeType
          ? new MediaRecorder(audioOnlyStream, { mimeType })
          : new MediaRecorder(audioOnlyStream);

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        recorder.start(250);
        recorderRef.current = recorder;
        return true;
      } catch {
        recorderRef.current = null;
        chunksRef.current = [];
        return false;
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") return;
      try {
        recorder.stop();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, []);

  return {
    isSupported: typeof window !== "undefined" && typeof MediaRecorder !== "undefined",
    start,
    stop
  };
}
