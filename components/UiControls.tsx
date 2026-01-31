"use client";

import Link from "next/link";
import { useState } from "react";
import { THEMES } from "@/lib/theme";
import { useUi } from "@/components/UiProvider";

export default function UiControls() {
  const { themeId, setThemeId, themeMode, setThemeMode, t } = useUi();
  const filteredThemes = THEMES.filter((theme) => theme.mode === themeMode);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="top-bar">
      <Link className="brand-link" href="/">
        <span className="brand-dot" />
        Interview Coach
      </Link>

      <div className="top-actions">
        <div className="theme-mode-toggle">
          <span className="tiny">{t("themeModeLabel")}</span>
          <div className="segmented">
            <button
              type="button"
              className={themeMode === "light" ? "active" : ""}
              onClick={() => setThemeMode("light")}
              aria-pressed={themeMode === "light"}
            >
              <span className="mode-dot light" />
              {t("themeLight")}
            </button>
            <button
              type="button"
              className={themeMode === "dark" ? "active" : ""}
              onClick={() => setThemeMode("dark")}
              aria-pressed={themeMode === "dark"}
            >
              <span className="mode-dot dark" />
              {t("themeDark")}
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
              {filteredThemes.map((theme) => (
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
                    <strong>{theme.label}</strong>
                    <span className="tiny">{theme.vars["--accent"]}</span>
                  </span>
                </button>
              ))}
              {filteredThemes.length === 0 && (
                <p className="tiny">{t("themeNoPalettes")}</p>
              )}
            </div>

            <div className="controls">
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
