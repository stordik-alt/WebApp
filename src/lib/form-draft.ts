// Lost in-progress form data when a background tab gets discarded and
// reloaded by the browser (common on mobile, increasingly on desktop under
// memory pressure) - the app itself never triggers this reload, it's the
// browser's own memory management, so it can't be prevented from here.
// What CAN be done: persist the draft as the user types, so a reload
// restores it instead of losing it.
const DRAFT_VERSION = 1;
const PREFIX = "draft:";

type StoredDraft<T> = { v: number; savedAt: number; data: T };

export function saveDraft<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ v: DRAFT_VERSION, savedAt: Date.now(), data } satisfies StoredDraft<T>));
  } catch {
    // localStorage can throw (private browsing, quota exceeded) - losing
    // draft persistence silently is far better than crashing the form.
  }
}

export function loadDraft<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (parsed.v !== DRAFT_VERSION) return null;
    if (Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
