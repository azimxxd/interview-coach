"use client";

import Link from "next/link";
import { useState } from "react";
import { THEMES } from "@/lib/theme";
import { useUi } from "@/components/UiProvider";

export default function UiControls() {
  const { language, setLanguage, themeId, setThemeId, randomizeTheme, t } = useUi();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="top-bar">
      <Link className="brand-link" href="/">
        <span className="brand-dot" />
        Interview Coach
      </Link>

      <div className="top-actions">
        <div className="language-toggle">
          <span className="tiny">{t("pageLanguageLabel")}</span>
          <div className="segmented">
            <button
              type="button"
              className={language === "EN" ? "active" : ""}
              onClick={() => setLanguage("EN")}
              aria-pressed={language === "EN"}
            >
              EN
            </button>
            <button
              type="button"
              className={language === "RU" ? "active" : ""}
              onClick={() => setLanguage("RU")}
              aria-pressed={language === "RU"}
            >
              RU
            </button>
          </div>
        </div>

        <button className="btn btn-ghost" type="button" onClick={() => setIsOpen(true)}>
          {t("themeButton")}
        </button>
      </div>

      {isOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{t("themeTitle")}</h3>
                <p className="tiny">{t("themeSubtitle")}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t("themeClose")}
                onClick={() => setIsOpen(false)}
              >
                X
              </button>
            </div>

            <div className="palette-grid">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`palette-card${themeId === theme.id ? " active" : ""}`}
                  onClick={() => setThemeId(theme.id)}
                  aria-pressed={themeId === theme.id}
                >
                  <span
                    className="palette-swatch"
                    style={{
                      background: `linear-gradient(120deg, ${theme.vars["--bg-1"]}, ${theme.vars["--accent"]})`
                    }}
                  />
                  <span className="palette-meta">
                    <strong>{theme.label[language]}</strong>
                    <span className="tiny">{theme.vars["--accent"]}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="controls">
              <button className="btn btn-ghost" type="button" onClick={randomizeTheme}>
                {t("themeRandom")}
              </button>
              <button className="btn btn-primary" type="button" onClick={() => setIsOpen(false)}>
                {t("themeClose")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
