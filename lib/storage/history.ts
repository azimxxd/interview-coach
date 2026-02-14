"use client";

import type { InterviewSession } from "@/lib/storage/session";

export type SessionHistoryEntry = {
  id: string;
  savedAt: string;
  overallScore: number;
  session: InterviewSession;
};

const HISTORY_KEY = "interview_history_v1";

let memoryHistory: SessionHistoryEntry[] | null = null;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readLocalHistoryRaw(): unknown[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalHistory(value: SessionHistoryEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeOverallScore(session: InterviewSession) {
  const values = session.turns.flatMap((turn) => {
    if (!turn.rubric) return [];
    const scores = turn.rubric.scores;
    const mean = average([
      scores.clarity,
      scores.correctness,
      scores.depth,
      scores.structure,
      scores.confidence
    ]);

    const followupScores = turn.followups.flatMap((followup) => {
      if (!followup.rubric) return [];
      const s = followup.rubric.scores;
      return [average([s.clarity, s.correctness, s.depth, s.structure, s.confidence])];
    });

    return [mean, ...followupScores];
  });

  return Number(average(values).toFixed(2));
}

function normalizeHistoryEntry(raw: unknown): SessionHistoryEntry | null {
  if (!isObject(raw)) return null;
  const sessionRaw = raw.session;
  if (!isObject(sessionRaw)) return null;

  const id = typeof raw.id === "string" && raw.id ? raw.id : createId();
  const savedAt =
    typeof raw.savedAt === "string" && raw.savedAt
      ? raw.savedAt
      : new Date().toISOString();

  if (!Array.isArray(sessionRaw.turns)) return null;

  const session = sessionRaw as InterviewSession;
  const rawScore = raw.overallScore;
  return {
    id,
    savedAt,
    overallScore:
      typeof rawScore === "number" && Number.isFinite(rawScore)
        ? Number(rawScore)
        : computeOverallScore(session),
    session
  };
}

export function getSessionHistory() {
  if (memoryHistory !== null) return memoryHistory;
  const normalized = readLocalHistoryRaw()
    .map((item) => normalizeHistoryEntry(item))
    .filter((item): item is SessionHistoryEntry => Boolean(item))
    .sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt));

  memoryHistory = normalized;
  return normalized;
}

export function saveSessionHistory(entries: SessionHistoryEntry[]) {
  memoryHistory = entries;
  writeLocalHistory(entries);
}

export function appendCompletedSession(session: InterviewSession) {
  const history = getSessionHistory();
  const nextEntry: SessionHistoryEntry = {
    id: createId(),
    savedAt: new Date().toISOString(),
    overallScore:
      session.summary?.overallScore ??
      computeOverallScore(session),
    session
  };

  const next = [nextEntry, ...history].slice(0, 120);
  saveSessionHistory(next);
  return nextEntry;
}

export function clearSessionHistory() {
  memoryHistory = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(HISTORY_KEY);
  }
}
