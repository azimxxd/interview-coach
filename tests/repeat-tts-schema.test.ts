import test from "node:test";
import assert from "node:assert/strict";
import {
  repeatTtsRequestSchema,
  repeatTtsResponseSchema
} from "../lib/schema/interview";

test("repeat tts request schema accepts valid payload", () => {
  const parsed = repeatTtsRequestSchema.safeParse({
    text: "Can you explain your approach?",
    voice: "af_heart",
    speed: 0.95,
    lang_code: "a"
  });
  assert.equal(parsed.success, true);
});

test("repeat tts response schema accepts valid payload", () => {
  const parsed = repeatTtsResponseSchema.safeParse({
    audio_base64: "UklGRgABAA...",
    format: "wav",
    sample_rate: 24000
  });
  assert.equal(parsed.success, true);
});
