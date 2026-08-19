export type AlertSnapshot = {
  alert_cause: string | null;
  alert_note: string | null;
  operator_error: boolean | null;
  final_quality_score: number | null;
};

export type AlertFieldDiff = {
  label: string;
  before: string;
  after: string;
};

const EMPTY = "–";

function txt(v: string | null): string {
  return v && v.trim() ? v.trim() : EMPTY;
}

function bool(v: boolean | null): string {
  return v === null ? EMPTY : v ? "Ano" : "Ne";
}

function num(v: number | null): string {
  return v === null || Number.isNaN(v) ? EMPTY : String(v);
}

/** Vrátí seznam změněných polí mezi předchozí a novou verzí alertu. */
export function diffAlert(
  prev: AlertSnapshot | null | undefined,
  next: AlertSnapshot,
): AlertFieldDiff[] {
  const rows: AlertFieldDiff[] = [];
  const push = (label: string, before: string, after: string) => {
    if (before !== after) rows.push({ label, before, after });
  };
  push("Příčina", txt(prev?.alert_cause ?? null), txt(next.alert_cause));
  push("Poznámka", txt(prev?.alert_note ?? null), txt(next.alert_note));
  push("Chyba operátora", bool(prev?.operator_error ?? null), bool(next.operator_error));
  push(
    "Finální Quality Score",
    num(prev?.final_quality_score ?? null),
    num(next.final_quality_score),
  );
  return rows;
}

/** Duplicitní uložení: shodný obsah jako poslední záznam historie ve stejném časovém okně. */
export const DUPLICATE_WINDOW_MS = 60_000;

export function isDuplicateSave(
  last: (AlertSnapshot & { created_at: string }) | null | undefined,
  next: AlertSnapshot,
  now: number = Date.now(),
  windowMs: number = DUPLICATE_WINDOW_MS,
): boolean {
  if (!last) return false;
  if (diffAlert(last, next).length > 0) return false;
  const ts = new Date(last.created_at).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts <= windowMs;
}
