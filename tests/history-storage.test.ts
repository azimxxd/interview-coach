import test from "node:test";
import assert from "node:assert/strict";
import {
  appendCompletedSession,
  clearSessionHistory,
  getSessionHistory
} from "../lib/storage/history";
import type { InterviewSession } from "../lib/storage/session";

function installLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };

  (globalThis as any).window = {
    localStorage
  };

  return { store };
}

const sampleSession: InterviewSession = {
  id: "session-1",
  startedAt: new Date().toISOString(),
  settings: {
    role: "Frontend",
    level: "Junior",
    category: "Frontend",
    difficulty: "Junior",
    interviewType: "Technical Q&A",
    subtopics: ["React"],
    jobDescription: "",
    language: "EN",
    storeLocal: false,
    questionCount: 5
  },
  turns: [
    {
      id: "turn-1",
      topic: "React",
      question: "How do you prevent unnecessary renders?",
      transcript: "I would memoize expensive subtrees and profile first.",
      signals: {
        wpm: 135,
        pauses_sec: 1.2,
        filler_count: 2,
        eye_contact_pct: 0,
        smile_proxy: 0,
        duration_sec: 45
      },
      followups: [],
      rubric: {
        scores: {
          clarity: 4,
          correctness: 4,
          depth: 3,
          structure: 4,
          confidence: 4
        },
        what_was_good: ["Clear explanation"],
        what_to_improve: ["Add metric impact"],
        ideal_answer_outline: ["State approach", "Explain tradeoff"]
      }
    }
  ]
};

test("history helper survives malformed localStorage payload", () => {
  clearSessionHistory();
  installLocalStorageMock({
    interview_history_v1: "{not-valid-json"
  });

  const entries = getSessionHistory();
  assert.equal(entries.length, 0);
});

test("history helper appends and reads completed sessions", () => {
  installLocalStorageMock();
  clearSessionHistory();

  appendCompletedSession(sampleSession);
  const entries = getSessionHistory();

  assert.equal(entries.length, 1);
  assert.equal(entries[0].session.id, "session-1");
  assert.equal(entries[0].overallScore > 0, true);
});
