"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

/** Resolved appearance applied to the document. */
export type Theme = "light" | "dark";

/** User preference; system follows OS. */
export type ThemePreference = "system" | "light" | "dark";

type ThemeContextValue = {
  /** Resolved light/dark used for rendering. */
  theme: Theme;
  /** Stored preference (system | light | dark). */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Cycle system → light → dark → system. */
  cyclePreference: () => void;
  ready: boolean;
};

const STORAGE_KEY = "aniflow-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

const PREFERENCE_ORDER: ThemePreference[] = ["system", "light", "dark"];

function applyResolvedTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? getSystemTheme() : preference;
}

function readStoredPreference(): ThemePreference | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "system" || value === "light" || value === "dark") {
      return value;
    }
    // Migrate legacy light/dark-only storage (already covered above).
  } catch {
    // ignore
  }
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStoredPreference() ?? "system";
    const resolved = resolveTheme(stored);
    setPreferenceState(stored);
    setTheme(resolved);
    applyResolvedTheme(resolved);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = getSystemTheme();
      setTheme(resolved);
      applyResolvedTheme(resolved);
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference, ready]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    const resolved = resolveTheme(next);
    setTheme(resolved);
    applyResolvedTheme(resolved);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const cyclePreference = useCallback(() => {
    const index = PREFERENCE_ORDER.indexOf(preference);
    const next = PREFERENCE_ORDER[(index + 1) % PREFERENCE_ORDER.length];
    setPreference(next);
  }, [preference, setPreference]);

  const value = useMemo(
    () => ({
      theme,
      preference,
      setPreference,
      cyclePreference,
      ready
    }),
    [theme, preference, setPreference, cyclePreference, ready]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

/** Inline script: apply theme before paint to avoid flash. */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(STORAGE_KEY)};var p=localStorage.getItem(k);var t;if(p==="light"||p==="dark"){t=p;}else{t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var r=document.documentElement;if(t==="dark")r.classList.add("dark");else r.classList.remove("dark");r.style.colorScheme=t;}catch(e){}})();`;
