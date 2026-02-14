import { z } from "zod";
import { INTERVIEW_CATEGORIES, INTERVIEW_TYPES } from "@/lib/interview/config";

export const levelSchema = z.enum(["Junior", "Mid", "Senior"]);
export const languageSchema = z.enum(["EN"]);
export const categorySchema = z.enum(INTERVIEW_CATEGORIES);
export const interviewTypeSchema = z.enum(INTERVIEW_TYPES);

export const interviewConfigSchema = z
  .object({
    category: categorySchema,
    difficulty: levelSchema,
    interviewType: interviewTypeSchema,
    subtopics: z.array(z.string().trim().min(1).max(48)).max(8).default([]),
    jobDescription: z.string().max(6000).optional().default(""),
    questionCount: z.number().int().min(3).max(20),
    language: languageSchema.default("EN"),
    storeLocal: z.boolean().optional().default(false)
  })
  .strict();

export const answerMetadataSchema = z
  .object({
    wpm: z.number().nonnegative().optional(),
    fillerCount: z.number().int().nonnegative().optional(),
    topFillers: z
      .array(
        z
          .object({
            token: z.string().trim().min(1).max(32),
            count: z.number().int().nonnegative()
          })
          .strict()
      )
      .max(5)
      .optional(),
    pauseCount: z.number().int().nonnegative().optional(),
    longestPauseMs: z.number().int().nonnegative().optional(),
    micLevel: z.number().nonnegative().optional()
  })
  .strict()
  .default({});

export const questionListSchema = z
  .object({
    questions: z.array(z.string().trim().min(8).max(280)).min(1).max(20)
  })
  .strict();

export const followupListSchema = z
  .object({
    followups: z.array(z.string().trim().min(8).max(220)).max(2)
  })
  .strict();

const rubricScoreSchema = z.number().int().min(1).max(5);

export const answerRubricSchema = z
  .object({
    scores: z
      .object({
        clarity: rubricScoreSchema,
        correctness: rubricScoreSchema,
        depth: rubricScoreSchema,
        structure: rubricScoreSchema,
        confidence: rubricScoreSchema
      })
      .strict(),
    what_was_good: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
    what_to_improve: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
    ideal_answer_outline: z.array(z.string().trim().min(1).max(160)).min(2).max(6)
  })
  .strict();

export const generatePreviewQuestionsRequestSchema = z
  .object({
    action: z.literal("generate_preview_questions"),
    config: interviewConfigSchema
  })
  .strict();

export const generatePrimaryQuestionsRequestSchema = z
  .object({
    action: z.literal("generate_primary_questions"),
    config: interviewConfigSchema,
    count: z.number().int().min(1).max(20).optional()
  })
  .strict();

export const generateFollowupsRequestSchema = z
  .object({
    action: z.literal("generate_followups"),
    config: interviewConfigSchema,
    originalQuestion: z.string().trim().min(8).max(280),
    transcript: z.string().max(12000),
    alreadyAsked: z.number().int().min(0).max(2).default(0)
  })
  .strict();

export const scoreAnswerRequestSchema = z
  .object({
    action: z.literal("score_answer"),
    config: interviewConfigSchema,
    question: z.string().trim().min(8).max(280),
    transcript: z.string().max(12000),
    metadata: answerMetadataSchema
  })
  .strict();

export const interviewApiRequestSchema = z.discriminatedUnion("action", [
  generatePreviewQuestionsRequestSchema,
  generatePrimaryQuestionsRequestSchema,
  generateFollowupsRequestSchema,
  scoreAnswerRequestSchema
]);

export const previewResponseSchema = z
  .object({
    questions: z.array(z.string()).length(3),
    estimatedDuration: z
      .object({
        minMinutes: z.number().int().positive(),
        maxMinutes: z.number().int().positive(),
        label: z.string()
      })
      .strict()
  })
  .strict();

export const transcriptionResponseSchema = z
  .object({
    transcript: z.string().max(12000)
  })
  .strict();

export const repeatTtsRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    voice: z.string().trim().min(1).max(64).optional().default("af_heart"),
    speed: z.number().min(0.7).max(1.3).optional().default(0.95),
    lang_code: z.string().trim().min(1).max(8).optional().default("a")
  })
  .strict();

export const repeatTtsResponseSchema = z
  .object({
    audio_base64: z.string().min(1),
    format: z.literal("wav"),
    sample_rate: z.number().int().positive()
  })
  .strict();

export type InterviewConfig = z.infer<typeof interviewConfigSchema>;
export type AnswerMetadata = z.infer<typeof answerMetadataSchema>;
export type AnswerRubric = z.infer<typeof answerRubricSchema>;
export type InterviewApiRequest = z.infer<typeof interviewApiRequestSchema>;
