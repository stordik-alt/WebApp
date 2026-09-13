import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "dps-theme";
const SCHEME_STORAGE_KEY = "optishift-appearance";
export type Theme = "light" | "dark";
export type ThemeScheme = "original" | "blue" | "green" | "teal" | "orange" | "red";

function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readScheme(): ThemeScheme {
  if (typeof window === "undefined") return "original";
  const saved = window.localStorage.getItem(SCHEME_STORAGE_KEY);
  if (saved === "original" || saved === "blue" || saved === "green" || saved === "teal" || saved === "orange" || saved === "red") return saved;
  return "original";
}

function apply(theme: Theme, scheme: ThemeScheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = scheme;
  document.documentElement.classList.remove("theme-original", "theme-blue", "theme-green", "theme-teal", "theme-orange", "theme-red");
  document.documentElement.classList.add(`theme-${scheme}`);
  document.documentElement.style.colorScheme = theme;
}

/** No-flash inline script to apply theme and color scheme before first paint. */
export const themeInitScript = `(function(){try{var k='${STORAGE_KEY}',s='${SCHEME_STORAGE_KEY}';var t=localStorage.getItem(k);t=t==='dark'||t==='light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var a=localStorage.getItem(s);a=['original','blue','green','teal','orange','red'].indexOf(a)>=0?a:'original';var e=document.documentElement;e.classList.toggle('dark',t==='dark');e.dataset.theme=a;e.classList.add('theme-'+a);e.style.colorScheme=t;}catch(e){}})();`;

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
