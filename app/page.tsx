"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/UiProvider";
import {
  createSession,
  getSettings,
  saveSession,
  saveSettings,
  type InterviewSettings
} from "@/lib/storage/session";

export default function HomePage() {
  const router = useRouter();
  const { t } = useUi();
  const [settings, setSettings] = useState<InterviewSettings>(() => ({
    ...getSettings(),
    language: "EN",
    storeLocal: false
  }));

  const startInterview = () => {
    const next: InterviewSettings = {
      ...settings,
      language: "EN",
      storeLocal: false
    };
    saveSettings(next);
    saveSession(createSession(next));
    router.push("/interview");
  };

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
            {t("roleLabel")}
            <select
              value={settings.role}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  role: event.target.value as InterviewSettings["role"]
                }))
              }
            >
              <option value="Frontend">{t("roleFrontend")}</option>
              <option value="PM">{t("rolePM")}</option>
            </select>
          </label>

          <label>
            {t("levelLabel")}
            <select
              value={settings.level}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  level: event.target.value as InterviewSettings["level"]
                }))
              }
            >
              <option value="Junior">{t("levelJunior")}</option>
              <option value="Mid">{t("levelMid")}</option>
              <option value="Senior">{t("levelSenior")}</option>
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
        </div>

        <div className="controls">
          <button className="btn btn-primary" onClick={startInterview}>
            {t("setupStart")}
          </button>
        </div>
      </section>
    </main>
  );
}
