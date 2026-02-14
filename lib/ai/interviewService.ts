import { estimateDurationRange, CATEGORY_SUBTOPICS } from "@/lib/interview/config";
import {
  answerRubricSchema,
  followupListSchema,
  previewResponseSchema,
  questionListSchema,
  type AnswerMetadata,
  type AnswerRubric,
  type InterviewConfig
} from "@/lib/schema/interview";
import {
  buildFollowupPrompt,
  buildPreviewPrompt,
  buildPrimaryQuestionsPrompt,
  buildScorePrompt,
  INTERVIEW_SYSTEM_PROMPT
} from "@/lib/ai/interviewPrompts";

const OPENAI_BASE_URL = process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function transcriptWordCount(transcript: string) {
  return transcript.trim().split(/[\s,.!?;:()"']+/).filter(Boolean).length;
}

function pickSubtopic(config: InterviewConfig, index: number) {
  const items = config.subtopics.length
    ? config.subtopics
    : CATEGORY_SUBTOPICS[config.category];
  return items[index % items.length] ?? config.category;
}

function fallbackQuestion(config: InterviewConfig, index: number) {
  const subtopic = pickSubtopic(config, index);
  const prefix = config.interviewType;
  if (prefix === "Behavioral (STAR)") {
    return `Tell me about a time you handled ${subtopic} pressure. What was your action and result?`;
  }
  if (prefix === "System Design") {
    return `Design a ${config.category} solution for ${subtopic}. What components and tradeoffs would you choose?`;
  }
  if (prefix === "Debugging") {
    return `A ${subtopic} issue appears in production. How would you isolate root cause and validate the fix?`;
  }
  return `How would you approach ${subtopic} for a ${config.difficulty} ${config.category} role?`;
}

function fallbackFollowups(originalQuestion: string, transcript: string, alreadyAsked: number) {
  const remaining = Math.max(0, 2 - alreadyAsked);
  if (!remaining) return [];
  const words = transcriptWordCount(transcript);

  if (words < 25) {
    return ["Can you give a concrete example with outcome metrics?"].slice(0, remaining);
  }

  const questions = [
    "What tradeoff did you consider most important and why?",
    `If you had to improve your answer to \"${originalQuestion.slice(0, 70)}\", what would you add?`
  ];

  return questions.slice(0, remaining);
}

function scoreFromTranscript(transcript: string, metadata: AnswerMetadata): AnswerRubric {
  const words = transcriptWordCount(transcript);
  const hasStructureSignals = /\b(first|second|third|then|finally|because|therefore)\b/i.test(
    transcript
  );

  const lengthBase = words < 20 ? 1 : words < 60 ? 3 : words < 130 ? 4 : 5;
  const clarity = clamp(1, lengthBase + (hasStructureSignals ? 1 : 0), 5);
  const depth = clamp(1, words < 40 ? 2 : words < 90 ? 3 : 4, 5);
  const structure = clamp(1, hasStructureSignals ? 4 : 3, 5);

  const wpm = metadata.wpm ?? 0;
  const fillerCount = metadata.fillerCount ?? 0;
  const pauseCount = metadata.pauseCount ?? 0;

  const paceBonus = wpm >= 120 && wpm <= 160 ? 1 : 0;
  const pacePenalty = wpm > 0 && (wpm < 90 || wpm > 185) ? -1 : 0;
  const fillerPenalty = fillerCount >= 8 ? -1 : 0;
  const pausePenalty = pauseCount >= 6 ? -1 : 0;

  const confidence = clamp(1, 3 + paceBonus + pacePenalty + fillerPenalty + pausePenalty, 5);
  const correctness = clamp(1, Math.round((clarity + depth) / 2), 5);

  const whatWasGood = [
    words >= 30 ? "You stayed on topic and provided enough context." : "You answered directly without drifting.",
    hasStructureSignals ? "Your structure made the answer easier to follow." : "You kept your core point understandable.",
    wpm >= 120 && wpm <= 160 ? "Your pace was in a strong interview range." : "You maintained a usable speaking pace."
  ].slice(0, 3);

  const topFillers = metadata.topFillers?.map((item) => `${item.token} (${item.count})`) ?? [];

  const improve = [
    words < 50 ? "Add one concrete example with measurable impact." : "Highlight one tradeoff and why you chose it.",
    topFillers.length ? `Reduce filler words, especially ${topFillers.slice(0, 2).join(", ")}.` : "Use fewer filler words for tighter delivery.",
    pauseCount > 4 ? "Shorten long pauses by outlining your answer before speaking." : "End with a concise takeaway sentence."
  ].slice(0, 3);

  const outline = [
    "State your approach in one sentence.",
    "Explain 2-3 decisions with tradeoffs.",
    "Give one concrete example and measurable result.",
    "Close with what you would improve next time."
  ].slice(0, 4);

  return {
    scores: {
      clarity,
      correctness,
      depth,
      structure,
      confidence
    },
    what_was_good: whatWasGood,
    what_to_improve: improve,
    ideal_answer_outline: outline
  };
}

async function openAiChat(messages: ChatMessage[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages
    })
  });

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

async function generateQuestionListWithAi(config: InterviewConfig, count: number) {
  const userPrompt = buildPrimaryQuestionsPrompt(config, count);
  const parsed = await openAiChat([
    { role: "system", content: INTERVIEW_SYSTEM_PROMPT },
    { role: "user", content: userPrompt }
  ]);
  if (!parsed) return null;
  const result = questionListSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data.questions.slice(0, count);
}

async function generatePreviewWithAi(config: InterviewConfig) {
  const parsed = await openAiChat([
    { role: "system", content: INTERVIEW_SYSTEM_PROMPT },
    { role: "user", content: buildPreviewPrompt(config) }
  ]);
  if (!parsed) return null;
  const result = questionListSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data.questions.slice(0, 3);
}

async function generateFollowupsWithAi(input: {
  config: InterviewConfig;
  originalQuestion: string;
  transcript: string;
  alreadyAsked: number;
}) {
  const parsed = await openAiChat([
    { role: "system", content: INTERVIEW_SYSTEM_PROMPT },
    { role: "user", content: buildFollowupPrompt(input) }
  ]);
  if (!parsed) return null;
  const result = followupListSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data.followups;
}

async function scoreWithAi(input: {
  config: InterviewConfig;
  question: string;
  transcript: string;
  metadata: AnswerMetadata;
}) {
  const tryOnce = async (strictJsonOnly = false) => {
    const parsed = await openAiChat([
      { role: "system", content: INTERVIEW_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildScorePrompt({
          ...input,
          strictJsonOnly
        })
      }
    ]);
    if (!parsed) return null;
    const result = answerRubricSchema.safeParse(parsed);
    return result.success ? result.data : null;
  };

  const first = await tryOnce(false);
  if (first) return first;
  return tryOnce(true);
}

export async function generatePreviewQuestions(config: InterviewConfig) {
  const aiQuestions = await generatePreviewWithAi(config);
  const questions =
    aiQuestions && aiQuestions.length === 3
      ? aiQuestions
      : Array.from({ length: 3 }, (_, index) => fallbackQuestion(config, index));

  const payload = {
    questions,
    estimatedDuration: estimateDurationRange(config.questionCount, config.interviewType)
  };

  const parsed = previewResponseSchema.parse(payload);
  return parsed;
}

export async function generatePrimaryQuestions(config: InterviewConfig, count: number) {
  const safeCount = clamp(1, count, 20);
  const aiQuestions = await generateQuestionListWithAi(config, safeCount);
  const questions =
    aiQuestions && aiQuestions.length
      ? aiQuestions
      : Array.from({ length: safeCount }, (_, index) => fallbackQuestion(config, index));

  return questionListSchema.parse({ questions: questions.slice(0, safeCount) });
}

export async function generateFollowups(input: {
  config: InterviewConfig;
  originalQuestion: string;
  transcript: string;
  alreadyAsked: number;
}) {
  if (input.alreadyAsked >= 2) {
    return followupListSchema.parse({ followups: [] });
  }

  const aiFollowups = await generateFollowupsWithAi(input);
  const followups =
    aiFollowups && aiFollowups.length
      ? aiFollowups
      : fallbackFollowups(input.originalQuestion, input.transcript, input.alreadyAsked);

  return followupListSchema.parse({ followups: followups.slice(0, 2 - input.alreadyAsked) });
}

export async function scoreAnswer(input: {
  config: InterviewConfig;
  question: string;
  transcript: string;
  metadata: AnswerMetadata;
}) {
  const words = transcriptWordCount(input.transcript);
  if (words < 5) {
    return answerRubricSchema.parse(scoreFromTranscript(input.transcript, input.metadata));
  }

  const aiRubric = await scoreWithAi(input);
  if (aiRubric) return answerRubricSchema.parse(aiRubric);
  return answerRubricSchema.parse(scoreFromTranscript(input.transcript, input.metadata));
}
