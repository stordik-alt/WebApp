import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "dps-theme";
const SCHEME_STORAGE_KEY = "optishift-appearance";
export type Theme = "light" | "dark";
export type ThemeScheme = "original" | "blue" | "green" | "teal" | "orange" | "red" | "warm-neutral" | "lavender" | "sand";
const SCHEMES_LIST: ThemeScheme[] = ["original", "blue", "green", "teal", "orange", "red", "warm-neutral", "lavender", "sand"];

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredScheme(): ThemeScheme {
  if (typeof window === "undefined") return "original";
  const saved = window.localStorage.getItem(SCHEME_STORAGE_KEY);
  if (SCHEMES_LIST.includes(saved as ThemeScheme)) return saved as ThemeScheme;
  return "original";
}

function applyToDom(theme: Theme, scheme: ThemeScheme) {
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

// A single module-level store instead of one useState pair per component.
// useTheme() used to keep theme/scheme in local useState, so AppearanceSettings
// and ThemeToggle (two independent consumers rendered side by side in
// AppShell) each held their OWN copy of both values. Toggling mode in
// ThemeToggle re-applied the DOM using ITS stale `scheme` (captured whenever
// that component last rendered), silently reverting a scheme change just
// made through AppearanceSettings - and the same in reverse. A shared store
// makes every consumer read and write the same live values, so a change
// made through one control is immediately visible to (and never undone by)
// any other.
type ThemeState = { theme: Theme; scheme: ThemeScheme };
let state: ThemeState = { theme: readStoredTheme(), scheme: readStoredScheme() };
applyToDom(state.theme, state.scheme);
const listeners = new Set<() => void>();
function setState(patch: Partial<ThemeState>) {
  state = { ...state, ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, state.theme);
    window.localStorage.setItem(SCHEME_STORAGE_KEY, state.scheme);
  }
  applyToDom(state.theme, state.scheme);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return state;
}
function getServerSnapshot(): ThemeState {
  return { theme: "light", scheme: "original" };
}

export function useTheme() {
  const { theme, scheme } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    // Intentionally only patches `theme`: red stays red, blue stays blue, etc.
    setState({ theme: state.theme === "dark" ? "light" : "dark" });
  }, []);

  const setScheme = useCallback((next: ThemeScheme) => {
    setState({ scheme: next });
  }, []);

  return { theme, toggle, isDark: theme === "dark", scheme, setScheme };
}
