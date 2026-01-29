import { z } from "zod";

const score = z.number().min(1).max(5);

export const evalSchema = z.object({
  scores: z.object({
    clarity: score,
    depth: score,
    evidence: score,
    tradeoffs: score,
    relevance: score,
    delivery: score
  }),
  signals: z.object({
    wpm: z.number(),
    pauses_sec: z.number(),
    filler_count: z.number(),
    eye_contact_pct: z.number(),
    smile_proxy: z.number()
  }),
  summary: z.string().max(240),
  strengths: z.array(z.string().max(120)).min(2).max(4),
  issues: z.array(z.string().max(120)).min(2).max(4),
  improvements: z.array(z.string().max(120)).length(3),
  better_answer: z.string().max(500),
  next_focus: z.array(z.string().max(120)).min(2).max(4)
});

export type EvalResult = z.infer<typeof evalSchema>;
