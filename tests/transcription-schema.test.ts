import test from "node:test";
import assert from "node:assert/strict";
import { transcriptionResponseSchema } from "../lib/schema/interview";

test("transcription response schema accepts transcript string", () => {
  const parsed = transcriptionResponseSchema.safeParse({
    transcript: "This is a test transcript."
  });
  assert.equal(parsed.success, true);
});

test("transcription response schema rejects invalid payload", () => {
  const parsed = transcriptionResponseSchema.safeParse({
    transcript: 42,
    extra: "nope"
  });
  assert.equal(parsed.success, false);
});
