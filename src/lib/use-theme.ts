import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "dps-theme";
const SCHEME_STORAGE_KEY = "optishift-appearance";
export type Theme = "light" | "dark";
export type ThemeScheme = "original" | "blue" | "green" | "teal" | "orange" | "red" | "warm-neutral" | "lavender" | "sand";
const SCHEMES_LIST: ThemeScheme[] = ["original", "blue", "green", "teal", "orange", "red", "warm-neutral", "lavender", "sand"];

function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readScheme(): ThemeScheme {
  if (typeof window === "undefined") return "original";
  const saved = window.localStorage.getItem(SCHEME_STORAGE_KEY);
  if (SCHEMES_LIST.includes(saved as ThemeScheme)) return saved as ThemeScheme;
  return "original";
}

function apply(theme: Theme, scheme: ThemeScheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset["theme"] = scheme;
  document.documentElement.classList.remove(...SCHEMES_LIST.map((s) => `theme-${s}`));
  document.documentElement.classList.add(`theme-${scheme}`);
  // Shared marker for any non-default scheme, so CSS that needs to patch
  // legacy hardcoded utility-color classes for "whichever scheme is active"
  // can target one class instead of repeating every theme-<name> selector.
  document.documentElement.classList.toggle("theme-scheme", scheme !== "original");
  document.documentElement.style.colorScheme = theme;
}

/** No-flash inline script to apply theme and color scheme before first paint. */
export const themeInitScript = `(function(){try{var k='${STORAGE_KEY}',s='${SCHEME_STORAGE_KEY}';var t=localStorage.getItem(k);t=t==='dark'||t==='light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var a=localStorage.getItem(s);a=${JSON.stringify(SCHEMES_LIST)}.indexOf(a)>=0?a:'original';var e=document.documentElement;e.classList.toggle('dark',t==='dark');e.dataset.theme=a;e.classList.add('theme-'+a);e.classList.toggle('theme-scheme',a!=='original');e.style.colorScheme=t;}catch(e){}})();`;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStored());
  // The color scheme is deliberately independent from light/dark mode.
  // Switching mode must never replace the user's selected palette.
  const [scheme, setSchemeState] = useState<ThemeScheme>(() => readScheme());

  useEffect(() => {
    apply(theme, scheme);
    window.localStorage.setItem(STORAGE_KEY, theme);
    window.localStorage.setItem(SCHEME_STORAGE_KEY, scheme);
  }, [theme, scheme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
    // Intentionally do not touch `scheme`: red stays red, blue stays blue, etc.
  }, []);

  const setScheme = useCallback((next: ThemeScheme) => {
    setSchemeState(next);
  }, []);

  return { theme, toggle, isDark: theme === "dark", scheme, setScheme };
}
