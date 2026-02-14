"use client";

import type { EvalResult } from "@/lib/schema/eval";
import type { AnswerRubric } from "@/lib/schema/interview";
import {
  INTERVIEW_TYPES,
  mapLegacyRoleToCategory,
  normalizeSubtopics
} from "@/lib/interview/config";
import type { DeliverySignals, InterviewSettings, Language, Level, Role } from "@/lib/types";

export type { DeliverySignals, InterviewSettings, Language, Level, Role };

export type FollowupTurn = {
  id: string;
  question: string;
  transcript: string;
  signals: DeliverySignals;
  rubric?: AnswerRubric;
  hint?: string;
};

export type InterviewTurn = {
  id: string;
  topic: string;
  question: string;
  transcript: string;
  signals: DeliverySignals;
  rubric?: AnswerRubric;
  followups: FollowupTurn[];
  hint?: string;
  evaluation?: EvalResult;
};

export type SessionSummary = {
  overallScore: number;
  topStrengths: string[];
  topWeaknesses: string[];
  recommendedNextConfig: {
    category: InterviewSettings["category"];
    interviewType: InterviewSettings["interviewType"];
    difficulty: InterviewSettings["difficulty"];
    questionCount: number;
    subtopics: string[];
  };
};

export type InterviewSession = {
  id: string;
  settings: InterviewSettings;
  turns: InterviewTurn[];
  startedAt: string;
  finishedAt?: string;
  summary?: SessionSummary;
};

const STORAGE_KEY = "interview_session_v1";
const SETTINGS_KEY = "interview_settings_v1";

const DEFAULT_SETTINGS: InterviewSettings = {
  role: "Frontend",
  level: "Junior",
  category: "Frontend",
  difficulty: "Junior",
  interviewType: "Technical Q&A",
  subtopics: [],
  jobDescription: "",
  language: "EN",
  storeLocal: false,
  questionCount: 8
};

let memorySession: InterviewSession | null = null;
let memorySettings: InterviewSettings | null = null;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

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

function isLevel(value: unknown): value is Level {
  return value === "Junior" || value === "Mid" || value === "Senior";
}

function normalizeSettings(settings: Partial<InterviewSettings>): InterviewSettings {
  const category = mapLegacyRoleToCategory(
    typeof settings.category === "string"
      ? settings.category
      : typeof settings.role === "string"
        ? settings.role
        : undefined
  );

  const difficulty = isLevel(settings.difficulty)
    ? settings.difficulty
    : isLevel(settings.level)
      ? settings.level
      : DEFAULT_SETTINGS.difficulty;

  const interviewType =
    INTERVIEW_TYPES.find((item) => item === settings.interviewType) ??
    DEFAULT_SETTINGS.interviewType;

  const questionCount = Number.isFinite(settings.questionCount)
    ? Math.max(3, Math.min(20, Math.round(Number(settings.questionCount))))
    : DEFAULT_SETTINGS.questionCount;

  const subtopics = normalizeSubtopics(
    category,
    Array.isArray(settings.subtopics)
      ? settings.subtopics.filter((item): item is string => typeof item === "string")
      : []
  );

  const jobDescription =
    typeof settings.jobDescription === "string"
      ? settings.jobDescription.trim().slice(0, 6000)
      : "";

  const storeLocal = Boolean(settings.storeLocal);

  return {
    role: category,
    level: difficulty,
    category,
    difficulty,
    interviewType,
    subtopics,
    jobDescription,
    language: "EN",
    storeLocal,
    questionCount
  };
}

function normalizeSignals(signals: Partial<DeliverySignals> | undefined): DeliverySignals {
  return {
    wpm: Number.isFinite(signals?.wpm) ? Number(signals?.wpm) : 0,
    pauses_sec: Number.isFinite(signals?.pauses_sec) ? Number(signals?.pauses_sec) : 0,
    filler_count: Number.isFinite(signals?.filler_count) ? Number(signals?.filler_count) : 0,
    eye_contact_pct: Number.isFinite(signals?.eye_contact_pct)
      ? Number(signals?.eye_contact_pct)
      : 0,
    smile_proxy: Number.isFinite(signals?.smile_proxy) ? Number(signals?.smile_proxy) : 0,
    duration_sec: Number.isFinite(signals?.duration_sec) ? Number(signals?.duration_sec) : 0
  };
}

function normalizeFollowup(raw: Partial<FollowupTurn>): FollowupTurn {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
    question: typeof raw.question === "string" ? raw.question : "",
    transcript: typeof raw.transcript === "string" ? raw.transcript : "",
    signals: normalizeSignals(raw.signals),
    rubric: raw.rubric,
    hint: typeof raw.hint === "string" ? raw.hint : undefined
  };
}

function normalizeTurn(raw: Partial<InterviewTurn>): InterviewTurn {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
    topic: typeof raw.topic === "string" ? raw.topic : "",
    question: typeof raw.question === "string" ? raw.question : "",
    transcript: typeof raw.transcript === "string" ? raw.transcript : "",
    signals: normalizeSignals(raw.signals),
    rubric: raw.rubric,
    hint: typeof raw.hint === "string" ? raw.hint : undefined,
    followups: Array.isArray(raw.followups)
      ? raw.followups.map((item) => normalizeFollowup(item ?? {}))
      : [],
    evaluation: raw.evaluation
  };
}

function normalizeSession(raw: Partial<InterviewSession>): InterviewSession {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
    settings: normalizeSettings((raw.settings ?? {}) as Partial<InterviewSettings>),
    turns: Array.isArray(raw.turns) ? raw.turns.map((item) => normalizeTurn(item ?? {})) : [],
    startedAt:
      typeof raw.startedAt === "string" && raw.startedAt
        ? raw.startedAt
        : new Date().toISOString(),
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : undefined,
    summary: raw.summary
  };
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
  if (normalized.storeLocal) {
    writeLocal(SETTINGS_KEY, normalized);
  } else {
    removeLocal(SETTINGS_KEY);
  }
}

export function createSession(settings: InterviewSettings): InterviewSession {
  const normalized = normalizeSettings(settings);
  return {
    id: createId(),
    settings: normalized,
    turns: [],
    startedAt: new Date().toISOString()
  };
}

export function getSession(): InterviewSession | null {
  if (memorySession) return memorySession;
  const stored = readLocal<InterviewSession>(STORAGE_KEY);
  if (stored) {
    const normalized = normalizeSession(stored);
    memorySession = normalized;
    return normalized;
  }
  return null;
}

export function saveSession(session: InterviewSession) {
  const normalized = normalizeSession(session);
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
