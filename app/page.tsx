"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSession,
  saveSession,
  saveSettings,
  type Role,
  type Level,
  type Language
} from "@/lib/storage/session";
import { useUi } from "@/components/UiProvider";

export default function HomePage() {
  const router = useRouter();
  const { t, language: uiLanguage } = useUi();
  const [role, setRole] = useState<Role>("Frontend");
  const [level, setLevel] = useState<Level>("Junior");
  const [language, setLanguage] = useState<Language>("EN");
  const [storeLocal, setStoreLocal] = useState(false);
  const [voiceInterviewer, setVoiceInterviewer] = useState(false);
  const [manualLanguage, setManualLanguage] = useState(false);

  useEffect(() => {
    if (!manualLanguage) {
      setLanguage(uiLanguage);
    }
  }, [uiLanguage, manualLanguage]);

  const handleStart = () => {
    const settings = { role, level, language, storeLocal, voiceInterviewer };
    saveSettings(settings);
    const session = createSession(settings);
    saveSession(session);
    router.push("/interview");
  };

  return (
    <main className="page">
      <section className="hero">
        <div>
          <span className="badge">{t("brandBadge")}</span>
          <h1>{t("heroTitle")}</h1>
          <p>{t("heroBody")}</p>
          <div className="controls">
            <button className="btn btn-primary" onClick={handleStart}>
              {t("startInterview")}
            </button>
          </div>
        </div>
        <div className="card">
          <h2>{t("sessionSettings")}</h2>
          <div className="form-grid">
            <label>
              {t("roleLabel")}
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="Frontend">{t("roleFrontend")}</option>
                <option value="PM">{t("rolePM")}</option>
              </select>
            </label>
            <label>
              {t("levelLabel")}
              <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
                <option value="Junior">{t("levelJunior")}</option>
                <option value="Mid">{t("levelMid")}</option>
                <option value="Senior">{t("levelSenior")}</option>
              </select>
            </label>
            <label>
              {t("languageLabel")}
              <select
                value={language}
                onChange={(e) => {
                  setManualLanguage(true);
                  setLanguage(e.target.value as Language);
                }}
              >
                <option value="EN">EN</option>
                <option value="RU">RU</option>
              </select>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={storeLocal}
                onChange={(e) => setStoreLocal(e.target.checked)}
              />
              {t("storeLocal")}
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={voiceInterviewer}
                onChange={(e) => setVoiceInterviewer(e.target.checked)}
              />
              {t("voiceInterviewerToggle")}
            </label>
            <p className="tiny">{t("voiceInterviewerHint")}</p>
            <p className="tiny">{t("storeLocalHint")}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
