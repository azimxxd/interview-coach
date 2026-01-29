import { NextResponse } from "next/server";
import { buildFallbackEvaluation, getEvaluation } from "@/lib/ai/provider";
import { evalSchema } from "@/lib/schema/eval";

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const result = await getEvaluation(payload);
    const parsed = evalSchema.safeParse(result);
    if (!parsed.success) {
      const fallback = buildFallbackEvaluation(
        payload.signals,
        payload.transcript ?? "",
        payload.language ?? "EN"
      );
      return NextResponse.json(fallback);
    }
    return NextResponse.json(parsed.data);
  } catch (error) {
    return NextResponse.json(
      buildFallbackEvaluation(
        {
          wpm: 0,
          pauses_sec: 0,
          filler_count: 0,
          eye_contact_pct: 0,
          smile_proxy: 0
        },
        "",
        "EN"
      ),
      { status: 200 }
    );
  }
}
