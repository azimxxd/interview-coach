"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  applyTheme,
  DARK_THEME_ID,
  DEFAULT_THEME_ID,
  LIGHT_THEME_ID,
  getThemeMode,
  type ThemeMode
} from "@/lib/theme";
import { getUiPreferences, saveUiPreferences } from "@/lib/storage/preferences";
import { getCopy, type UiCopyKey } from "@/lib/i18n";

type UiContextValue = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  t: (key: UiCopyKey) => string;
};

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState(DEFAULT_THEME_ID);
  const hasHydrated = useRef(false);

  useEffect(() => {
    const prefs = getUiPreferences();
    const nextTheme = getThemeMode(prefs.themeId) === "dark" ? DARK_THEME_ID : LIGHT_THEME_ID;
    setThemeIdState(nextTheme);
    applyTheme(nextTheme);
    if (typeof document !== "undefined") {
      document.documentElement.lang = "en";
    }
    hasHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydrated.current) return;
    saveUiPreferences({ themeId });
    applyTheme(themeId);
    if (typeof document !== "undefined") {
      document.documentElement.lang = "en";
    }
  }, [themeId]);

  const t = useMemo(() => {
    const copy = getCopy("EN");
    return (key: UiCopyKey) => copy[key];
  }, []);

  const themeMode: ThemeMode = getThemeMode(themeId);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      if (mode === "dark") {
        setThemeIdState(DARK_THEME_ID);
        return;
      }
      setThemeIdState(LIGHT_THEME_ID);
    },
    []
  );

  const value = useMemo(
    () => ({
      themeMode,
      setThemeMode,
      t
    }),
    [themeMode, t, setThemeMode]
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const context = useContext(UiContext);
  if (!context) {
    throw new Error("useUi must be used within UiProvider");
  }
  return context;
}
