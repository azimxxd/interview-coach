import { NextResponse } from "next/server";
import {
  generateFollowups,
  generatePreviewQuestions,
  generatePrimaryQuestions,
  scoreAnswer
} from "@/lib/ai/interviewService";
import {
  answerRubricSchema,
  followupListSchema,
  interviewApiRequestSchema,
  previewResponseSchema,
  questionListSchema
} from "@/lib/schema/interview";

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const parsed = interviewApiRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const data = parsed.data;

    if (data.action === "generate_preview_questions") {
      const result = await generatePreviewQuestions(data.config);
      return NextResponse.json(previewResponseSchema.parse(result));
    }

    if (data.action === "generate_primary_questions") {
      const count = data.count ?? data.config.questionCount;
      const result = await generatePrimaryQuestions(data.config, count);
      return NextResponse.json(questionListSchema.parse(result));
    }

    if (data.action === "generate_followups") {
      const result = await generateFollowups({
        config: data.config,
        originalQuestion: data.originalQuestion,
        transcript: data.transcript,
        alreadyAsked: data.alreadyAsked
      });
      return NextResponse.json(followupListSchema.parse(result));
    }

    const result = await scoreAnswer({
      config: data.config,
      question: data.question,
      transcript: data.transcript,
      metadata: data.metadata
    });

    return NextResponse.json(answerRubricSchema.parse(result));
  } catch {
    return NextResponse.json(
      {
        error: "Unable to process interview request"
      },
      { status: 500 }
    );
  }
}
