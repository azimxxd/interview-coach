"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/types";

function langToCode(language: Language) {
  return language === "RU" ? "ru-RU" : "en-US";
}

export function useSpeechToText(language: Language) {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRestartRef = useRef(false);

  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setIsSupported(false);
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
    };

    recognition.onstart = () => setIsListening(true);
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
    recognition.onerror = () => {
      setIsListening(false);
      setInterimTranscript("");
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
    try {
      recognition.start();
    } catch {
      // Ignore repeated start errors.
    }
  };

  const stop = () => {
    shouldRestartRef.current = false;
    recognitionRef.current?.stop();
  };

  const reset = () => {
    setTranscript("");
    setInterimTranscript("");
  };

  return {
    transcript,
    interimTranscript,
    isSupported,
    isListening,
    start,
    stop,
    reset,
    setManualTranscript: setTranscript
  };
}
