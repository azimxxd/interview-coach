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
import type { Language } from "@/lib/types";
import { applyTheme, DEFAULT_THEME_ID, getThemeById, THEMES, type ThemeId } from "@/lib/theme";
import { getUiPreferences, saveUiPreferences } from "@/lib/storage/preferences";
import { getCopy, type UiCopyKey } from "@/lib/i18n";

type UiContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
  randomizeTheme: () => void;
  t: (key: UiCopyKey) => string;
};

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("EN");
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);
  const hasHydrated = useRef(false);

  useEffect(() => {
    const prefs = getUiPreferences();
    const theme = getThemeById(prefs.themeId as ThemeId);
    setLanguageState(prefs.language);
    setThemeIdState(theme.id);
    applyTheme(theme.id);
    if (typeof document !== "undefined") {
      document.documentElement.lang = prefs.language === "RU" ? "ru" : "en";
    }
    hasHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydrated.current) return;
    saveUiPreferences({ language, themeId });
    applyTheme(themeId);
    if (typeof document !== "undefined") {
      document.documentElement.lang = language === "RU" ? "ru" : "en";
    }
  }, [language, themeId]);

  const t = useMemo(() => {
    const copy = getCopy(language);
    return (key: UiCopyKey) => copy[key];
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
  }, []);

  const setThemeId = useCallback((next: ThemeId) => {
    const theme = getThemeById(next);
    setThemeIdState(theme.id);
  }, []);

  const randomizeTheme = useCallback(() => {
    if (THEMES.length === 0) return;
    const choices = THEMES.filter((theme) => theme.id !== themeId);
    const pick = choices[Math.floor(Math.random() * choices.length)] ?? THEMES[0];
    setThemeIdState(pick.id);
  }, [themeId]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      themeId,
      setThemeId,
      randomizeTheme,
      t
    }),
    [language, themeId, t, setLanguage, setThemeId, randomizeTheme]
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
