import { NextResponse } from "next/server";
import { getInterviewerQuestion } from "@/lib/ai/provider";

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const question = await getInterviewerQuestion(payload);
    return new NextResponse(question, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  } catch (error) {
    return new NextResponse("Unable to generate question.", { status: 500 });
  }
}
