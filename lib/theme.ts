export type ThemeMode = "light" | "dark";
export type ThemeId = "blue-light" | "blue-dark";

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  mode: ThemeMode;
  vars: Record<string, string>;
};

export const THEMES: ThemeDefinition[] = [
  {
    id: "blue-light",
    label: "Blue Light",
    mode: "light",
    vars: {
      "--bg-1": "#e8f0ff",
      "--bg-2": "#d6e7ff",
      "--ink": "#0f2440",
      "--muted": "#4e6685",
      "--card": "#f3f8ff",
      "--accent": "#2563eb",
      "--accent-2": "#1d4ed8",
      "--accent-3": "#1e3a8a",
      "--border": "rgba(37, 99, 235, 0.18)",
      "--shadow": "0 24px 60px rgba(15, 36, 64, 0.14)"
    }
  },
  {
    id: "blue-dark",
    label: "Blue Dark",
    mode: "dark",
    vars: {
      "--bg-1": "#050b1a",
      "--bg-2": "#0b1530",
      "--ink": "#dbeafe",
      "--muted": "#8ea7c7",
      "--card": "#0f1d3d",
      "--accent": "#60a5fa",
      "--accent-2": "#3b82f6",
      "--accent-3": "#93c5fd",
      "--border": "rgba(96, 165, 250, 0.22)",
      "--shadow": "0 30px 70px rgba(2, 8, 24, 0.72)"
    }
  }
];

export const DEFAULT_THEME_ID: ThemeId = "blue-light";
export const LIGHT_THEME_ID: ThemeId = "blue-light";
export const DARK_THEME_ID: ThemeId = "blue-dark";

export function getThemeById(themeId: ThemeId) {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
}

export function applyTheme(themeId: ThemeId) {
  if (typeof document === "undefined") return;
  const theme = getThemeById(themeId);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

export function getThemeMode(themeId: ThemeId): ThemeMode {
  return getThemeById(themeId).mode;
}
