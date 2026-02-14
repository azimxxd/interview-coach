import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonaPlexPrompt } from "../lib/personaplex/prompt";
import type { InterviewSettings } from "../lib/storage/session";

const settings: InterviewSettings = {
  role: "Frontend",
  level: "Mid",
  category: "Frontend",
  difficulty: "Mid",
  interviewType: "Technical Q&A",
  subtopics: ["React", "TypeScript"],
  jobDescription: "Build modern UI systems and improve performance.",
  language: "EN",
  storeLocal: false,
  questionCount: 8
};

test("personaplex prompt includes selected interview options", () => {
  const prompt = buildPersonaPlexPrompt(settings);
  assert.match(prompt, /Category: Frontend/);
  assert.match(prompt, /Difficulty: Mid/);
  assert.match(prompt, /Interview type: Technical Q&A/);
  assert.match(prompt, /Preferred subtopics: React, TypeScript/);
});

test("personaplex prompt handles empty subtopics and job description", () => {
  const prompt = buildPersonaPlexPrompt({
    ...settings,
    subtopics: [],
    jobDescription: ""
  });
  assert.match(prompt, /Preferred subtopics: None specified/);
  assert.match(prompt, /Job description context: Not provided/);
});
