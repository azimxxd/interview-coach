import test from "node:test";
import assert from "node:assert/strict";
import { answerRubricSchema } from "../lib/schema/interview";

test("answer rubric schema accepts valid JSON", () => {
  const input = {
    scores: {
      clarity: 4,
      correctness: 4,
      depth: 3,
      structure: 4,
      confidence: 3
    },
    what_was_good: ["Clear structure", "Relevant example"],
    what_to_improve: ["Add deeper tradeoffs"],
    ideal_answer_outline: ["State approach", "Explain tradeoffs", "Close with result"]
  };

  const parsed = answerRubricSchema.safeParse(input);
  assert.equal(parsed.success, true);
});

test("answer rubric schema rejects invalid keys or score range", () => {
  const input = {
    scores: {
      clarity: 6,
      correctness: 0,
      depth: 3,
      structure: 4,
      confidence: 3
    },
    what_was_good: [],
    what_to_improve: ["x"],
    ideal_answer_outline: ["a", "b"],
    extra: "not-allowed"
  };

  const parsed = answerRubricSchema.safeParse(input);
  assert.equal(parsed.success, false);
});
