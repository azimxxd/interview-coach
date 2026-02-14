"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/UiProvider";
import {
  CATEGORY_SUBTOPICS,
  INTERVIEW_CATEGORIES,
  INTERVIEW_TYPES,
  estimateDurationRange
} from "@/lib/interview/config";
import {
  createSession,
  getSettings,
  saveSession,
  saveSettings,
  type InterviewSettings
} from "@/lib/storage/session";

type PreviewResponse = {
  questions: string[];
  estimatedDuration: {
    minMinutes: number;
    maxMinutes: number;
    label: string;
  };
};

export default function HomePage() {
  const router = useRouter();
  const { t } = useUi();
  const [settings, setSettings] = useState<InterviewSettings>(() => getSettings());
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const activeSubtopics = useMemo(
    () => CATEGORY_SUBTOPICS[settings.category],
    [settings.category]
  );

  const startInterview = () => {
    const next: InterviewSettings = {
      ...settings,
      role: settings.category,
      level: settings.difficulty,
      language: "EN"
    };
    saveSettings(next);
    saveSession(createSession(next));
    router.push("/interview");
  };

  const startPersonaPlex = () => {
    const next: InterviewSettings = {
      ...settings,
      role: settings.category,
      level: settings.difficulty,
      language: "EN"
    };
    saveSettings(next);
    router.push("/personaplex");
  };

  useEffect(() => {
    const durationFallback = estimateDurationRange(
      settings.questionCount,
      settings.interviewType
    );

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const response = await fetch("/api/interview", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "generate_preview_questions",
            config: {
              category: settings.category,
              difficulty: settings.difficulty,
              interviewType: settings.interviewType,
              subtopics: settings.subtopics,
              jobDescription: settings.jobDescription,
              questionCount: settings.questionCount,
              language: "EN",
              storeLocal: settings.storeLocal
            }
          })
        });

        if (!response.ok) {
          setPreview({
            questions: [
              "Preview unavailable right now.",
              "Try adjusting category or type.",
              "Start interview to continue."
            ],
            estimatedDuration: durationFallback
          });
          return;
        }

        const data = (await response.json()) as PreviewResponse;
        setPreview(data);
      } catch {
        if (controller.signal.aborted) return;
        setPreview({
          questions: [
            "Preview unavailable right now.",
            "Try adjusting category or type.",
            "Start interview to continue."
          ],
          estimatedDuration: durationFallback
        });
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    settings.category,
    settings.difficulty,
    settings.interviewType,
    settings.jobDescription,
    settings.questionCount,
    settings.storeLocal,
    settings.subtopics
  ]);

  return (
    <main className="page call-setup-page">
      <section className="call-setup-card stack">
        <div className="setup-logo-wrap" aria-hidden="true">
          <Image
            src="/mushivo-logo.png"
            alt="Mushivo.ai"
            width={1536}
            height={1024}
            className="setup-logo-image"
            priority
          />
        </div>

        <h1>{t("setupTitle")}</h1>
        <p className="tiny">{t("setupSubtitle")}</p>

        <div className="form-grid">
          <label>
            Category
            <select
              value={settings.category}
              onChange={(event) => {
                const category = event.target.value as InterviewSettings["category"];
                setSettings((prev) => ({
                  ...prev,
                  category,
                  role: category,
                  subtopics: prev.subtopics.filter((item) =>
                    CATEGORY_SUBTOPICS[category].includes(item)
                  )
                }));
              }}
            >
              {INTERVIEW_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label>
            Difficulty
            <select
              value={settings.difficulty}
              onChange={(event) => {
                const difficulty = event.target.value as InterviewSettings["difficulty"];
                setSettings((prev) => ({
                  ...prev,
                  difficulty,
                  level: difficulty
                }));
              }}
            >
              <option value="Junior">{t("levelJunior")}</option>
              <option value="Mid">{t("levelMid")}</option>
              <option value="Senior">{t("levelSenior")}</option>
            </select>
          </label>

          <label>
            Interview type
            <select
              value={settings.interviewType}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  interviewType: event.target.value as InterviewSettings["interviewType"]
                }))
              }
            >
              {INTERVIEW_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("questionCountLabel")}
            <select
              value={settings.questionCount}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  questionCount: Number(event.target.value)
                }))
              }
            >
              <option value={5}>{t("questionsShort")}</option>
              <option value={8}>{t("questionsStandard")}</option>
              <option value={12}>{t("questionsDeep")}</option>
            </select>
          </label>

          <fieldset className="subtopics-fieldset">
            <legend>Subtopics (optional)</legend>
            <div className="subtopics-grid">
              {activeSubtopics.map((subtopic) => {
                const checked = settings.subtopics.includes(subtopic);
                return (
                  <label key={subtopic} className="subtopic-pill">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSettings((prev) => ({
                          ...prev,
                          subtopics: checked
                            ? prev.subtopics.filter((item) => item !== subtopic)
                            : [...prev.subtopics, subtopic].slice(0, 8)
                        }))
                      }
                    />
                    <span>{subtopic}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label>
            Paste job description (optional)
            <textarea
              rows={5}
              value={settings.jobDescription}
              placeholder="Paste role responsibilities and requirements to personalize questions."
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  jobDescription: event.target.value.slice(0, 6000)
                }))
              }
            />
          </label>
        </div>

        <section className="preview-card stack" aria-live="polite">
          <div className="preview-header">
            <h3>Sample questions</h3>
            <span className="tiny">
              {preview?.estimatedDuration.label ??
                estimateDurationRange(settings.questionCount, settings.interviewType).label}
            </span>
          </div>
          {previewLoading && <p className="tiny">Generating preview...</p>}
          <ol className="preview-list">
            {(preview?.questions ?? []).map((question, index) => (
              <li key={`${index}-${question}`}>{question}</li>
            ))}
          </ol>
        </section>

        <div className="controls">
          <button className="btn btn-primary" onClick={startInterview}>
            {t("setupStart")}
          </button>
          <button className="btn btn-ghost" onClick={startPersonaPlex}>
            Try PersonaPlex Live
          </button>
        </div>
      </section>
    </main>
  );
}
