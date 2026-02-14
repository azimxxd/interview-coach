import type {
  AnswerMetadata,
  InterviewConfig
} from "@/lib/schema/interview";

function listOrNone(items: string[]) {
  return items.length ? items.join(", ") : "none";
}

function trimmedJobDescription(jobDescription?: string) {
  const text = (jobDescription ?? "").trim();
  if (!text) return "none";
  return text.slice(0, 2400);
}

function configBlock(config: InterviewConfig) {
  return [
    `Category: ${config.category}`,
    `Subtopics: ${listOrNone(config.subtopics)}`,
    `Interview type: ${config.interviewType}`,
    `Difficulty: ${config.difficulty}`,
    `Language: ${config.language}`,
    `Job description: ${trimmedJobDescription(config.jobDescription)}`
  ].join("\n");
}

export function buildPreviewPrompt(config: InterviewConfig) {
  return [
    "Generate exactly 3 interview questions.",
    "Use the config below.",
    "Questions should be concise and realistic.",
    "Return JSON with shape: {\"questions\":[\"...\",\"...\",\"...\"]}",
    configBlock(config)
  ].join("\n\n");
}

export function buildPrimaryQuestionsPrompt(config: InterviewConfig, count: number) {
  return [
    `Generate exactly ${count} primary interview questions.`,
    "Primary questions should not include follow-up wording.",
    "Avoid duplicates. Tailor to category, type, difficulty, and job description.",
    "Return JSON with shape: {\"questions\":[\"...\"]}",
    configBlock(config)
  ].join("\n\n");
}

export function buildFollowupPrompt(input: {
  config: InterviewConfig;
  originalQuestion: string;
  transcript: string;
  alreadyAsked: number;
}) {
  const remaining = Math.max(0, 2 - input.alreadyAsked);
  return [
    `Generate up to ${remaining} follow-up questions (0-${remaining}).`,
    "Focus on gaps in the candidate answer.",
    "Each follow-up must be short and specific.",
    "Return JSON with shape: {\"followups\":[\"...\"]}",
    configBlock(input.config),
    `Original question: ${input.originalQuestion}`,
    `Candidate answer transcript: ${input.transcript.slice(0, 5000)}`
  ].join("\n\n");
}

export function buildScorePrompt(input: {
  config: InterviewConfig;
  question: string;
  transcript: string;
  metadata: AnswerMetadata;
  strictJsonOnly?: boolean;
}) {
  const strict = input.strictJsonOnly
    ? "Return JSON only. No markdown, no prose, no code fences."
    : "Return valid JSON only.";

  return [
    "Score the candidate answer using 1-5 integers.",
    "Use rubric keys: clarity, correctness, depth, structure, confidence.",
    "Provide concise actionable bullets.",
    "JSON schema:",
    JSON.stringify(
      {
        scores: {
          clarity: 1,
          correctness: 1,
          depth: 1,
          structure: 1,
          confidence: 1
        },
        what_was_good: ["..."],
        what_to_improve: ["..."],
        ideal_answer_outline: ["..."]
      },
      null,
      2
    ),
    strict,
    configBlock(input.config),
    `Question: ${input.question}`,
    `Transcript: ${input.transcript.slice(0, 7000)}`,
    `Metadata: ${JSON.stringify(input.metadata)}`
  ].join("\n\n");
}

export const INTERVIEW_SYSTEM_PROMPT =
  "You are a pragmatic interview coach. Follow instructions exactly and keep outputs concise.";
