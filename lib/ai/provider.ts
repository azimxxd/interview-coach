import { EVALUATOR_SYSTEM_PROMPT, INTERVIEWER_SYSTEM_PROMPT } from "./prompts";
import type { EvalResult } from "@/lib/schema/eval";
import type { DeliverySignals, Language, Role, Level } from "@/lib/types";

type InterviewerPayload = {
  role: Role;
  level: Level;
  language: Language;
  topic: string;
  previous: Array<{ question: string; answer: string }>;
};

type EvaluatorPayload = {
  role: Role;
  level: Level;
  language: Language;
  question: string;
  transcript: string;
  signals: DeliverySignals;
};

const OPENAI_BASE_URL = process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function trimToMaxWords(text: string, maxWords: number) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ").replace(/[.?!]+$/, "").trim();
}

function roleLabel(role: Role, language: Language) {
  if (language === "RU") {
    return role === "Frontend" ? "фронтенд-инженер" : "продакт-менеджер";
  }
  return role === "Frontend" ? "frontend engineer" : "product manager";
}

function levelLabel(level: Level, language: Language) {
  if (language === "RU") {
    if (level === "Senior") return "сеньор";
    return level === "Junior" ? "джуниор" : "мидл";
  }
  if (level === "Senior") return "senior";
  return level === "Junior" ? "junior" : "mid";
}

function buildMockQuestion(payload: InterviewerPayload) {
  const { language, topic, role, level } = payload;
  if (language === "RU") {
    return `Как бы вы подошли к теме "${topic}" как ${levelLabel(
      level,
      language
    )} ${roleLabel(role, language)}?`;
  }
  return `As a ${levelLabel(level, language)} ${roleLabel(
    role,
    language
  )}, how would you approach ${topic}?`;
}

function clampScore(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

export function buildFallbackEvaluation(
  signals: DeliverySignals,
  transcript: string,
  language: Language = "EN"
): EvalResult {
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  const isEmpty = wordCount === 0;
  const isTooShort = wordCount < 10;

  const copy =
    language === "RU"
      ? {
          summaryOk:
            "Неплохая база. Подача понятная, но можно усилить структуру и факты. Держите ровный темп и меньше слов-паразитов.",
          summaryShort: "Ответ слишком короткий для оценки. Дайте полный ответ.",
          summaryEmpty:
            "Ответ отсутствует. Дайте полный ответ, чтобы получить фидбек.",
          strengthsShort: [
            "Нет сильных сторон: ответ слишком короткий.",
            "Нужен полный ответ для оценки."
          ],
          issuesShort: [
            "Недостаточно содержания.",
            "Добавьте структуру: тезис -> аргументы -> пример."
          ],
          improvementsShort: [
            "Дайте полный ответ (2-4 ключевых пункта).",
            "Добавьте один конкретный пример или метрику.",
            "Сформулируйте вывод."
          ],
          betterAnswerShort:
            "Дайте план, 2-3 ключевых пункта, один пример и чёткий вывод.",
          focusShort: [
            "Дать полный ответ",
            "Добавить структуру",
            "Добавить пример"
          ],
          strengthDetailLong: "Ответ содержит достаточно деталей.",
          strengthDetailShort: "Ответ краткий и по делу.",
          strengthPace: "Темп речи комфортный.",
          strengthDelivery: "Подача понятная.",
          strengthFiller: "Слова-паразиты под контролем.",
          strengthPause: "Паузы в норме.",
          issueTradeoffs: "Обозначьте компромиссы.",
          issueExample: "Добавьте конкретный пример или метрику.",
          issuePace: "Отрегулируйте темп речи.",
          issueFiller: "Сократите слова-паразиты.",
          issuePauses: "Сократите длинные паузы.",
          strengthFallback: "Ответ остаётся по теме.",
          issueFallback: "Добавьте более чёткую структуру (2-3 шага).",
          improvements: [
            "Сначала краткий план из 2-3 шагов, затем детали.",
            "Добавьте один конкретный пример или метрику.",
            "Следите за словами-паразитами и паузами."
          ],
          betterAnswer:
            "Начните с короткого плана, разберите ключевые решения, добавьте пример и завершите компромиссом или выводом.",
          focusPace: "Отрегулировать темп речи",
          focusFiller: "Сократить слова-паразиты",
          focusTradeoffs: "Явно обозначить компромиссы",
          focusEvidence: "Добавить ясные доказательства"
        }
      : {
          summaryOk:
            "Solid baseline. Delivery is understandable, but you can tighten structure and add clearer evidence. Keep pace steady and reduce filler spikes.",
          summaryShort: "Answer is too short to evaluate. Provide a full response.",
          summaryEmpty:
            "No answer provided. Provide a full response to receive feedback.",
          strengthsShort: [
            "No strengths identified - answer is too short.",
            "Provide a complete response for a proper evaluation."
          ],
          issuesShort: [
            "Answer lacks content.",
            "Add structure: thesis -> reasoning -> example."
          ],
          improvementsShort: [
            "Provide a full answer (2-4 key points).",
            "Add one concrete example or metric.",
            "State your conclusion clearly."
          ],
          betterAnswerShort:
            "Give a concise plan, 2-3 key points, one example, and a clear conclusion.",
          focusShort: [
            "Provide a complete answer",
            "Add structure",
            "Add one example"
          ],
          strengthDetailLong: "Provides sufficient detail.",
          strengthDetailShort: "Keeps the answer concise.",
          strengthPace: "Speaking pace is in a clear range.",
          strengthDelivery: "Delivery is understandable.",
          strengthFiller: "Filler usage is controlled.",
          strengthPause: "Pauses are mostly controlled.",
          issueTradeoffs: "Make tradeoffs explicit.",
          issueExample: "Add one concrete example or metric.",
          issuePace: "Calibrate speaking pace.",
          issueFiller: "Reduce filler words.",
          issuePauses: "Reduce long pauses.",
          strengthFallback: "Answer stays relevant to the question.",
          issueFallback: "Add clearer structure with 2-3 steps.",
          improvements: [
            "Structure the answer into 2-3 clear steps before details.",
            "Add one concrete example or metric to support your point.",
            "Watch filler words and keep pauses intentional."
          ],
          betterAnswer:
            "Start with a concise plan, walk through key decisions, add a concrete example, and close with the tradeoff you accepted and why.",
          focusPace: "Calibrate speaking pace",
          focusFiller: "Reduce filler words",
          focusTradeoffs: "Make tradeoffs explicit",
          focusEvidence: "Add clear evidence"
        };

  if (isTooShort) {
    const lowScore = isEmpty ? 1 : 2;
    return {
      scores: {
        clarity: lowScore,
        depth: lowScore,
        evidence: lowScore,
        tradeoffs: lowScore,
        relevance: lowScore,
        delivery: lowScore
      },
      signals,
      summary: (isEmpty ? copy.summaryEmpty : copy.summaryShort).slice(0, 240),
      strengths: copy.strengthsShort.slice(0, 4),
      issues: copy.issuesShort.slice(0, 4),
      improvements: copy.improvementsShort,
      better_answer: copy.betterAnswerShort,
      next_focus: copy.focusShort.slice(0, 4)
    };
  }

  const base = 3;
  const lengthBoost = wordCount > 90 ? 1 : 0;
  const paceBoost = signals.wpm >= 120 && signals.wpm <= 170 ? 1 : 0;
  const pacePenalty = signals.wpm < 90 || signals.wpm > 190 ? -1 : 0;
  const fillerPenalty = signals.filler_count > 6 ? -1 : 0;
  const pausePenalty = signals.pauses_sec > 8 ? -1 : 0;

  const deliveryScore = clampScore(
    base + paceBoost + pacePenalty + fillerPenalty + pausePenalty
  );
  const clarityScore = clampScore(
    base + paceBoost + pacePenalty + fillerPenalty + pausePenalty
  );
  const depthScore = clampScore(base + lengthBoost);
  const evidenceScore = clampScore(base + lengthBoost - fillerPenalty);
  const tradeoffsScore = clampScore(base);
  const relevanceScore = clampScore(base + 0);

  const strengths = [
    lengthBoost ? copy.strengthDetailLong : copy.strengthDetailShort,
    paceBoost ? copy.strengthPace : copy.strengthDelivery
  ];
  if (signals.filler_count <= 6) strengths.push(copy.strengthFiller);
  if (signals.pauses_sec <= 8) strengths.push(copy.strengthPause);

  const issues = [lengthBoost ? copy.issueTradeoffs : copy.issueExample];
  if (signals.wpm < 110 || signals.wpm > 180) issues.push(copy.issuePace);
  if (signals.filler_count > 6) issues.push(copy.issueFiller);
  if (signals.pauses_sec > 8) issues.push(copy.issuePauses);

  const normalizedStrengths = strengths.filter(Boolean).slice(0, 4);
  while (normalizedStrengths.length < 2) {
    normalizedStrengths.push(copy.strengthFallback);
  }

  const normalizedIssues = issues.filter(Boolean).slice(0, 4);
  while (normalizedIssues.length < 2) {
    normalizedIssues.push(copy.issueFallback);
  }

  const nextFocus = [
    signals.wpm < 110 || signals.wpm > 180 ? copy.focusPace : "",
    signals.filler_count > 6 ? copy.focusFiller : "",
    copy.focusTradeoffs,
    copy.focusEvidence
  ].filter(Boolean);

  return {
    scores: {
      clarity: clarityScore,
      depth: depthScore,
      evidence: evidenceScore,
      tradeoffs: tradeoffsScore,
      relevance: relevanceScore,
      delivery: deliveryScore
    },
    signals,
    summary: copy.summaryOk.slice(0, 240),
    strengths: normalizedStrengths,
    issues: normalizedIssues,
    improvements: copy.improvements,
    better_answer: copy.betterAnswer,
    next_focus: nextFocus.slice(0, 4)
  };
}
async function openAiChat(
  messages: Array<{ role: "system" | "user"; content: string }>,
  responseFormat?: { type: "json_object" }
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.6,
      messages,
      response_format: responseFormat
    })
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? null;
}

export async function getInterviewerQuestion(payload: InterviewerPayload) {
  if (!process.env.OPENAI_API_KEY) {
    return trimToMaxWords(buildMockQuestion(payload), 30);
  }

  const userPayload = {
    role: payload.role,
    level: payload.level,
    language: payload.language,
    topic: payload.topic,
    previous: payload.previous.map((item) => ({
      question: item.question,
      answer: item.answer.slice(0, 160)
    }))
  };

  const content = await openAiChat([
    { role: "system", content: INTERVIEWER_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(userPayload) }
  ]);

  if (!content) {
    return trimToMaxWords(buildMockQuestion(payload), 30);
  }

  const sanitized = content.replace(/^["\s]+|["\s]+$/g, "").trim();
  return `${trimToMaxWords(sanitized, 30)}?`.replace(/\?+$/, "?");
}

export async function getEvaluation(payload: EvaluatorPayload) {
  const wordCount = payload.transcript.split(/\s+/).filter(Boolean).length;
  if (wordCount < 10) {
    return buildFallbackEvaluation(
      payload.signals,
      payload.transcript,
      payload.language
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackEvaluation(
      payload.signals,
      payload.transcript,
      payload.language
    );
  }

  const userPayload = {
    role: payload.role,
    level: payload.level,
    language: payload.language,
    question: payload.question,
    transcript: payload.transcript,
    signals: payload.signals
  };

  const content = await openAiChat(
    [
      { role: "system", content: EVALUATOR_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) }
    ],
    { type: "json_object" }
  );

  if (!content) {
    return buildFallbackEvaluation(
      payload.signals,
      payload.transcript,
      payload.language
    );
  }

  const parsed = safeJsonParse(content);
  if (!parsed) {
    return buildFallbackEvaluation(
      payload.signals,
      payload.transcript,
      payload.language
    );
  }
  return parsed;
}








