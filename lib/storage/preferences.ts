"use client";

import type { Language } from "@/lib/types";
import { DEFAULT_THEME_ID, type ThemeId } from "@/lib/theme";

export type UiPreferences = {
  language: Language;
  themeId: ThemeId;
};

const STORAGE_KEY = "ui_preferences_v1";

const DEFAULT_PREFS: UiPreferences = {
  language: "EN",
  themeId: DEFAULT_THEME_ID
};

let memoryPrefs: UiPreferences | null = null;

function readLocal<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getUiPreferences(): UiPreferences {
  if (memoryPrefs) return memoryPrefs;
  const stored = readLocal<UiPreferences>(STORAGE_KEY);
  if (stored) {
    memoryPrefs = stored;
    return stored;
  }
  return DEFAULT_PREFS;
}

export function saveUiPreferences(prefs: UiPreferences) {
  memoryPrefs = prefs;
  writeLocal(STORAGE_KEY, prefs);
}
