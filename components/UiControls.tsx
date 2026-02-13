"use client";

import Link from "next/link";
import { useUi } from "@/components/UiProvider";

export default function UiControls() {
  const { themeMode, setThemeMode, t } = useUi();

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
      </div>
    </div>
  );
}
