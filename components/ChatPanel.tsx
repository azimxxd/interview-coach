"use client";

import type { InterviewTurn } from "@/lib/storage/session";
import { useUi } from "@/components/UiProvider";

type InterviewStatus =
  | "idle"
  | "asking"
  | "answering"
  | "evaluating"
  | "next"
  | "finished";

type ChatPanelProps = {
  turns: InterviewTurn[];
  status: InterviewStatus;
  totalQuestions: number;
  onNextQuestion: () => void;
  onStartAnswer: () => void;
  onStopEvaluate: () => void;
  onFinish: () => void;
  isListening: boolean;
  canFinish: boolean;
};

export default function ChatPanel({
  turns,
  status,
  totalQuestions,
  onNextQuestion,
  onStartAnswer,
  onStopEvaluate,
  onFinish,
  isListening,
  canFinish
}: ChatPanelProps) {
  const { t } = useUi();
  const hasActiveQuestion =
    turns.length > 0 && !turns[turns.length - 1].evaluation;

  const isLocked = canFinish || status === "finished";

  const disableNext =
    isLocked ||
    status === "asking" ||
    status === "answering" ||
    status === "evaluating" ||
    hasActiveQuestion;
  const disableStart = !hasActiveQuestion || status !== "next";
  const disableStop = status !== "answering";

  return (
    <div className="card stack">
      <div className="chat-log">
        {turns.length === 0 && (
          <p className="tiny">{t("noQuestionsYet")}</p>
        )}
        {turns.map((turn, index) => (
          <div key={turn.id} className="stack">
            <div className="chat-bubble">
              <strong>
                {t("questionPrefix")}
                {index + 1}:
              </strong>{" "}
              {turn.question}
            </div>
            {turn.transcript && (
              <div className="chat-bubble answer">
                <strong>{t("answerPrefix")}:</strong> {turn.transcript}
              </div>
            )}
            {turn.evaluation && (
              <div className="chat-bubble eval">
                <strong>Coach:</strong> {turn.evaluation.summary}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="controls">
        <button
          className="btn btn-primary"
          onClick={onNextQuestion}
          disabled={disableNext || turns.length >= totalQuestions}
        >
          {t("nextQuestion")}
        </button>
        <button className="btn btn-ghost" onClick={onStartAnswer} disabled={disableStart}>
          {t("startAnswerRecording")}
        </button>
        <button className="btn btn-warn" onClick={onStopEvaluate} disabled={disableStop}>
          {t("stopEvaluate")}
        </button>
        {canFinish && (
          <button className="btn btn-primary" onClick={onFinish}>
            {t("finishInterview")}
          </button>
        )}
      </div>

      <div className="status">
        {t("statusLabel")}:{" "}
        {{
          idle: t("statusIdle"),
          asking: t("statusAsking"),
          answering: t("statusAnswering"),
          evaluating: t("statusEvaluating"),
          next: t("statusNext"),
          finished: t("statusFinished")
        }[status] ?? status}
        {isListening ? ` - ${t("transcribing")}` : ""}
      </div>
    </div>
  );
}
