import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "dps-theme";
type Theme = "light" | "dark";

function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

/** No-flash inline script to apply theme before first paint. Stringify into <head>. */
export const themeInitScript = `(function(){try{var k='${STORAGE_KEY}';var s=localStorage.getItem(k);var t=s==='dark'||s==='light'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var e=document.documentElement;e.classList.toggle('dark',t==='dark');e.style.colorScheme=t;}catch(e){}})();`;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStored());

  useEffect(() => {
    apply(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle, isDark: theme === "dark" };
}
