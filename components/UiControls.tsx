"use client";

import Image from "next/image";
import Link from "next/link";
import { useUi } from "@/components/UiProvider";

export default function UiControls() {
  const { themeMode, setThemeMode, t } = useUi();

  return (
    <div className="top-bar">
      <Link className="brand-link" href="/">
        <Image
          src="/mushivo-logo.png"
          alt="mushivo.ai"
          width={22}
          height={22}
          className="brand-logo"
        />
        mushivo.ai
      </Link>

      <div className="top-actions">
        <div className="controls">
          <Link className="btn btn-ghost" href="/history">
            History
          </Link>
        </div>
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
