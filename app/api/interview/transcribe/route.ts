import { NextResponse } from "next/server";
import { transcriptionResponseSchema } from "@/lib/schema/interview";

const OPENAI_BASE_URL = process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
const LOCAL_TRANSCRIBE_URL =
  process.env.LOCAL_TRANSCRIBE_URL ?? process.env.VOICE_SERVER_TRANSCRIBE_URL ?? "";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio");
    const language = formData.get("language");

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
    }

    if (audio.size <= 0) {
      return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Audio file is too large." }, { status: 413 });
    }

    let localError: string | null = null;

    if (LOCAL_TRANSCRIBE_URL) {
      const localForm = new FormData();
      localForm.append("audio", audio, audio.name || "answer.webm");
      if (typeof language === "string" && language.trim()) {
        localForm.append("language", language.trim().slice(0, 8));
      }

      const local = await fetch(LOCAL_TRANSCRIBE_URL, {
        method: "POST",
        body: localForm
      });

      if (local.ok) {
        const result = await local.json();
        const transcript =
          typeof result?.transcript === "string" ? result.transcript.trim() : "";
        return NextResponse.json(transcriptionResponseSchema.parse({ transcript }));
      }
      try {
        const details = await local.json();
        const message =
          typeof details?.detail === "string"
            ? details.detail
            : typeof details?.error === "string"
              ? details.error
              : "";
        if (message) {
          localError = message;
        }
      } catch {
        localError = "Local transcriber returned an invalid error response.";
      }
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: localError
            ? `Local transcription failed: ${localError}`
            : "Server transcription is not configured. Set LOCAL_TRANSCRIBE_URL for free local STT or OPENAI_API_KEY for OpenAI STT."
        },
        { status: 503 }
      );
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", audio, audio.name || "answer.webm");
    upstreamForm.append("model", OPENAI_TRANSCRIBE_MODEL);
    if (typeof language === "string" && language.trim()) {
      upstreamForm.append("language", language.trim().slice(0, 8));
    }

    const upstream = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: upstreamForm
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Upstream transcription failed." },
        { status: 502 }
      );
    }

    const result = await upstream.json();
    const transcript = typeof result?.text === "string" ? result.text.trim() : "";
    return NextResponse.json(transcriptionResponseSchema.parse({ transcript }));
  } catch {
    return NextResponse.json({ error: "Unable to transcribe audio." }, { status: 500 });
  }
}
