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
  DEFAULT_THEME_ID,
  getThemeById,
  getThemeMode,
  type ThemeId,
  type ThemeMode
} from "@/lib/theme";
import { getUiPreferences, saveUiPreferences } from "@/lib/storage/preferences";
import { getCopy, type UiCopyKey } from "@/lib/i18n";

type UiContextValue = {
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  t: (key: UiCopyKey) => string;
};

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);
  const lightThemeRef = useRef<ThemeId>(DEFAULT_THEME_ID);
  const darkThemeRef = useRef<ThemeId>("midnight");
  const hasHydrated = useRef(false);

  useEffect(() => {
    const prefs = getUiPreferences();
    const theme = getThemeById(prefs.themeId as ThemeId);
    setThemeIdState(theme.id);
    if (theme.mode === "light") lightThemeRef.current = theme.id;
    if (theme.mode === "dark") darkThemeRef.current = theme.id;
    applyTheme(theme.id);
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

  const setThemeId = useCallback((next: ThemeId) => {
    const theme = getThemeById(next);
    setThemeIdState(theme.id);
    if (theme.mode === "light") lightThemeRef.current = theme.id;
    if (theme.mode === "dark") darkThemeRef.current = theme.id;
  }, []);

  const themeMode: ThemeMode = getThemeMode(themeId);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      if (mode === "dark") {
        setThemeIdState(darkThemeRef.current);
        return;
      }
      setThemeIdState(lightThemeRef.current);
    },
    []
  );

  const value = useMemo(
    () => ({
      themeId,
      setThemeId,
      themeMode,
      setThemeMode,
      t
    }),
    [themeId, themeMode, t, setThemeId, setThemeMode]
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
