import { NextResponse } from "next/server";
import {
  repeatTtsRequestSchema,
  repeatTtsResponseSchema
} from "@/lib/schema/interview";

const LOCAL_TTS_URL =
  process.env.LOCAL_TTS_URL ??
  process.env.VOICE_SERVER_TTS_URL ??
  "http://127.0.0.1:8008/tts";
const REQUEST_TIMEOUT_MS = 120000;

function parseErrorMessage(payload: unknown) {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.detail === "string" && obj.detail.trim()) {
      return obj.detail.trim();
    }
    if (typeof obj.error === "string" && obj.error.trim()) {
      return obj.error.trim();
    }
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const parsed = repeatTtsRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid repeat TTS request payload",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const upstream = await fetch(LOCAL_TTS_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parsed.data)
      });

      if (!upstream.ok) {
        let message = "Local TTS request failed.";
        try {
          const details = await upstream.json();
          const parsedMessage = parseErrorMessage(details);
          if (parsedMessage) {
            message = parsedMessage;
          }
        } catch {
          // Keep default message.
        }
        return NextResponse.json({ error: message }, { status: 502 });
      }

      const upstreamPayload = await upstream.json();
      const tts = repeatTtsResponseSchema.parse(upstreamPayload);
      return NextResponse.json(tts);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Repeat TTS timed out." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Unable to process repeat TTS request." },
      { status: 500 }
    );
  }
}
