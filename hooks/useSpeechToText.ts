"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/types";

function langToCode(_language: Language) {
  return "en-US";
}

export function useSpeechToText(language: Language) {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRestartRef = useRef(false);

  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setIsSupported(false);
      setLastError("Speech recognition is not supported in this browser.");
      recognitionRef.current = null;
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = langToCode(language);
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        } else {
          interimChunk += result[0].transcript;
        }
      }
      if (finalChunk) {
        setTranscript((prev) => `${prev} ${finalChunk}`.trim());
      }
      setInterimTranscript(interimChunk.trim());
      setLastError(null);
    };

    recognition.onstart = () => {
      setIsListening(true);
      setLastError(null);
    };
    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
      if (shouldRestartRef.current) {
        window.setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // Ignore restart errors.
          }
        }, 200);
      }
    };
    recognition.onerror = (event: Event) => {
      const details = event as Event & { error?: string };
      setIsListening(false);
      setInterimTranscript("");
      setLastError(details.error ?? "Speech recognition error.");
      if (shouldRestartRef.current) {
        window.setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // Ignore restart errors.
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    setIsSupported(true);

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [language]);

  const start = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    shouldRestartRef.current = true;
    setLastError(null);
    try {
      recognition.start();
    } catch {
      setLastError("Unable to start speech recognition.");
    }
  };

  const stop = () => {
    shouldRestartRef.current = false;
    recognitionRef.current?.stop();
  };

  const reset = () => {
    setTranscript("");
    setInterimTranscript("");
    setLastError(null);
  };

  return {
    transcript,
    interimTranscript,
    isSupported,
    isListening,
    lastError,
    start,
    stop,
    reset,
    setManualTranscript: setTranscript
  };
}
