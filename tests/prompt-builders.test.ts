import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFollowupPrompt,
  buildPreviewPrompt,
  buildPrimaryQuestionsPrompt,
  buildScorePrompt
} from "../lib/ai/interviewPrompts";
import type { InterviewConfig } from "../lib/schema/interview";

const config: InterviewConfig = {
  category: "Frontend",
  difficulty: "Mid",
  interviewType: "Technical Q&A",
  subtopics: ["React", "TypeScript"],
  jobDescription: "Build and optimize web experiences.",
  questionCount: 8,
  language: "EN",
  storeLocal: false
};

test("preview prompt contains core config fields", () => {
  const prompt = buildPreviewPrompt(config);
  assert.match(prompt, /Category: Frontend/);
  assert.match(prompt, /Interview type: Technical Q&A/);
  assert.match(prompt, /Return JSON/);
});

test("primary prompt includes exact count", () => {
  const prompt = buildPrimaryQuestionsPrompt(config, 5);
  assert.match(prompt, /exactly 5 primary interview questions/i);
});

test("followup prompt reflects remaining followup slots", () => {
  const prompt = buildFollowupPrompt({
    config,
    originalQuestion: "How do you optimize a React list?",
    transcript: "I would profile and virtualize.",
    alreadyAsked: 1
  });

  assert.match(prompt, /up to 1 follow-up questions/i);
});

test("score prompt enforces JSON-only mode when strict", () => {
  const prompt = buildScorePrompt({
    config,
    question: "How do you design API caching?",
    transcript: "I would start by identifying read-heavy endpoints.",
    metadata: {
      wpm: 140,
      fillerCount: 2,
      pauseCount: 1,
      longestPauseMs: 500,
      micLevel: 0.05,
      topFillers: [{ token: "um", count: 2 }]
    },
    strictJsonOnly: true
  });

  assert.match(prompt, /Return JSON only\. No markdown/i);
  assert.match(prompt, /scores/);
});
