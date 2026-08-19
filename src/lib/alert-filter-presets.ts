export type AlertFilterState = {
  search: string;
  week: string;
  operatorError: "all" | "yes" | "no";
  status: "all" | "resolved" | "unresolved";
};

export type AlertFilterPreset = {
  id: string;
  name: string;
  filters: AlertFilterState;
};

export const EMPTY_ALERT_FILTERS: AlertFilterState = {
  search: "",
  week: "",
  operatorError: "all",
  status: "all",
};

const STORAGE_KEY = "quality-alert-filter-presets";

export function isEmptyFilters(f: AlertFilterState) {
  return (
    f.search.trim() === "" &&
    f.week.trim() === "" &&
    f.operatorError === "all" &&
    f.status === "all"
  );
}

export function loadPresets(): AlertFilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AlertFilterPreset[]) : [];
  } catch {
    return [];
  }
}

export function savePresets(presets: AlertFilterPreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* ignore quota / private mode errors */
  }
}
