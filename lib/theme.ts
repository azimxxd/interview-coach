import type { Language } from "@/lib/types";

export type ThemeId = "terra" | "ocean" | "sunset" | "forest" | "slate";

export type ThemeDefinition = {
  id: ThemeId;
  label: Record<Language, string>;
  vars: Record<string, string>;
};

export const THEMES: ThemeDefinition[] = [
  {
    id: "terra",
    label: { EN: "Terra", RU: "Терра" },
    vars: {
      "--bg-1": "#f5f1e7",
      "--bg-2": "#e3f2f2",
      "--ink": "#1f2a35",
      "--muted": "#5c6b78",
      "--card": "#ffffff",
      "--accent": "#1f6f78",
      "--accent-2": "#e07a5f",
      "--accent-3": "#3d405b",
      "--border": "rgba(31, 42, 53, 0.12)",
      "--shadow": "0 24px 60px rgba(31, 42, 53, 0.12)"
    }
  },
  {
    id: "ocean",
    label: { EN: "Ocean", RU: "Океан" },
    vars: {
      "--bg-1": "#eaf4ff",
      "--bg-2": "#d8f2f2",
      "--ink": "#102437",
      "--muted": "#4f6676",
      "--card": "#fdfdff",
      "--accent": "#1b6fb9",
      "--accent-2": "#00a6a6",
      "--accent-3": "#0f4c5c",
      "--border": "rgba(16, 36, 55, 0.12)",
      "--shadow": "0 24px 60px rgba(16, 36, 55, 0.14)"
    }
  },
  {
    id: "sunset",
    label: { EN: "Sunset", RU: "Закат" },
    vars: {
      "--bg-1": "#fff0e5",
      "--bg-2": "#ffe0cf",
      "--ink": "#2a1f1a",
      "--muted": "#6f5b52",
      "--card": "#fff9f4",
      "--accent": "#e76f51",
      "--accent-2": "#f4a261",
      "--accent-3": "#2a9d8f",
      "--border": "rgba(42, 31, 26, 0.12)",
      "--shadow": "0 24px 60px rgba(42, 31, 26, 0.16)"
    }
  },
  {
    id: "forest",
    label: { EN: "Forest", RU: "Лес" },
    vars: {
      "--bg-1": "#ecf4ec",
      "--bg-2": "#d8efe1",
      "--ink": "#182a1f",
      "--muted": "#4f6a5b",
      "--card": "#f7fbf8",
      "--accent": "#3a7d44",
      "--accent-2": "#8f6f4d",
      "--accent-3": "#2f4b3a",
      "--border": "rgba(24, 42, 31, 0.12)",
      "--shadow": "0 24px 60px rgba(24, 42, 31, 0.14)"
    }
  },
  {
    id: "slate",
    label: { EN: "Slate", RU: "Сланец" },
    vars: {
      "--bg-1": "#eef1f7",
      "--bg-2": "#e2e8f0",
      "--ink": "#1b2430",
      "--muted": "#5b6775",
      "--card": "#ffffff",
      "--accent": "#5a67d8",
      "--accent-2": "#f6ad55",
      "--accent-3": "#2d3748",
      "--border": "rgba(27, 36, 48, 0.12)",
      "--shadow": "0 24px 60px rgba(27, 36, 48, 0.14)"
    }
  }
];

export const DEFAULT_THEME_ID: ThemeId = "terra";

export function getThemeById(themeId: ThemeId) {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
}

export function applyTheme(themeId: ThemeId) {
  if (typeof document === "undefined") return;
  const theme = getThemeById(themeId);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}
