export type ThemeMode = "light" | "dark";
export type ThemeId =
  | "terra"
  | "ocean"
  | "sunset"
  | "forest"
  | "slate"
  | "midnight"
  | "noir";

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  mode: ThemeMode;
  vars: Record<string, string>;
};

export const THEMES: ThemeDefinition[] = [
  {
    id: "terra",
    label: "Terra",
    mode: "light",
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
    label: "Ocean",
    mode: "light",
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
    label: "Sunset",
    mode: "light",
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
    label: "Forest",
    mode: "light",
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
    label: "Slate",
    mode: "light",
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
  },
  {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    vars: {
      "--bg-1": "#0c1118",
      "--bg-2": "#111827",
      "--ink": "#f3f4f6",
      "--muted": "#9ca3af",
      "--card": "#111a2b",
      "--accent": "#38bdf8",
      "--accent-2": "#f59e0b",
      "--accent-3": "#a78bfa",
      "--border": "rgba(148, 163, 184, 0.18)",
      "--shadow": "0 30px 70px rgba(5, 8, 15, 0.6)"
    }
  },
  {
    id: "noir",
    label: "Noir",
    mode: "dark",
    vars: {
      "--bg-1": "#0b0d12",
      "--bg-2": "#121722",
      "--ink": "#f5f7ff",
      "--muted": "#a1a8b3",
      "--card": "#151c2b",
      "--accent": "#22d3ee",
      "--accent-2": "#f97316",
      "--accent-3": "#34d399",
      "--border": "rgba(148, 163, 184, 0.18)",
      "--shadow": "0 28px 70px rgba(4, 6, 10, 0.6)"
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
  root.dataset.themeMode = theme.mode;
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

export function getThemeMode(themeId: ThemeId): ThemeMode {
  return getThemeById(themeId).mode;
}
