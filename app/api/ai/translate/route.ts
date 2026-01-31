import { NextResponse } from "next/server";

type TranslatePayload = {
  texts: string[];
  targetLanguage?: "EN";
};

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as TranslatePayload;
    const texts = Array.isArray(payload.texts) ? payload.texts : [];
    return NextResponse.json({ translations: texts });
  } catch {
    return NextResponse.json({ translations: [] });
  }
}
