"use client";

import type { EvalResult } from "@/lib/schema/eval";
import type {
  DeliverySignals,
  InterviewSettings,
  Language,
  Level,
  Role
} from "@/lib/types";

export type { DeliverySignals, InterviewSettings, Language, Level, Role };

export type InterviewTurn = {
  id: string;
  topic: string;
  question: string;
  transcript: string;
  signals: DeliverySignals;
  evaluation?: EvalResult;
};

export type InterviewSession = {
  settings: InterviewSettings;
  turns: InterviewTurn[];
  startedAt: string;
  finishedAt?: string;
};

const STORAGE_KEY = "interview_session_v1";
const SETTINGS_KEY = "interview_settings_v1";

const DEFAULT_SETTINGS: InterviewSettings = {
  role: "Frontend",
  level: "Junior",
  language: "EN",
  storeLocal: false,
  questionCount: 8
};

let memorySession: InterviewSession | null = null;
let memorySettings: InterviewSettings | null = null;

function readLocal<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeLocal(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function normalizeSettings(settings: InterviewSettings): InterviewSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...settings,
    language: "EN"
  };
  const questionCount = Number.isFinite(merged.questionCount)
    ? merged.questionCount
    : DEFAULT_SETTINGS.questionCount;
  return { ...merged, questionCount };
}

export function getSettings(): InterviewSettings {
  if (memorySettings) return memorySettings;
  const stored = readLocal<InterviewSettings>(SETTINGS_KEY);
  if (stored) {
    const normalized = normalizeSettings(stored);
    memorySettings = normalized;
    return normalized;
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: InterviewSettings) {
  const normalized = normalizeSettings(settings);
  memorySettings = normalized;
  if (settings.storeLocal) {
    writeLocal(SETTINGS_KEY, normalized);
  } else {
    removeLocal(SETTINGS_KEY);
  }
}

export function createSession(settings: InterviewSettings): InterviewSession {
  const normalized = normalizeSettings(settings);
  return {
    settings: normalized,
    turns: [],
    startedAt: new Date().toISOString()
  };
}

export function getSession(): InterviewSession | null {
  if (memorySession) return memorySession;
  const stored = readLocal<InterviewSession>(STORAGE_KEY);
  if (stored) {
    const normalized = {
      ...stored,
      settings: normalizeSettings(stored.settings)
    };
    memorySession = normalized;
    return normalized;
  }
  return null;
}

export function saveSession(session: InterviewSession) {
  const normalized = {
    ...session,
    settings: normalizeSettings(session.settings)
  };
  memorySession = normalized;
  if (normalized.settings.storeLocal) {
    writeLocal(STORAGE_KEY, normalized);
  } else {
    removeLocal(STORAGE_KEY);
  }
}

export function clearSession() {
  memorySession = null;
  removeLocal(STORAGE_KEY);
}
