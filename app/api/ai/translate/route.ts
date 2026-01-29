import { NextResponse } from "next/server";

const OPENAI_BASE_URL = process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

type TranslatePayload = {
  texts: string[];
  targetLanguage: "EN" | "RU";
};

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as TranslatePayload;
    const texts = Array.isArray(payload.texts) ? payload.texts : [];
    const targetLanguage = payload.targetLanguage ?? "EN";

    if (!process.env.OPENAI_API_KEY || texts.length === 0) {
      return NextResponse.json({ translations: texts });
    }

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a translation engine. Translate each text to the target language. Preserve meaning, tone, and length. Return JSON only."
          },
          {
            role: "user",
            content: JSON.stringify({ targetLanguage, texts })
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!res.ok) {
      return NextResponse.json({ translations: texts });
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    const parsed = safeJsonParse(content);
    const translations = Array.isArray(parsed?.translations)
      ? parsed.translations
      : texts;

    if (translations.length !== texts.length) {
      return NextResponse.json({ translations: texts });
    }

    return NextResponse.json({ translations });
  } catch {
    return NextResponse.json({ translations: [] });
  }
}
