import type { DailyRecord } from "./metrics";

/** Hodnocení pracovníka za směnu – výpomoc existuje jednou za pracovníka + datum + směnu. */
export type ShiftEvaluation = {
  id: string;
  employee_id: string;
  work_date: string;
  shift: string;
  help_score: number;
  note: string | null;
  is_demo: boolean;
};

export type CoworkerLink = { record_id: string; coworker_id: string };

/**
 * Směnový (agregovaný) záznam pracovníka.
 * Počítá se VŽDY dynamicky z dílčích linkových záznamů – nikdy se neukládá
 * jako další řádek do daily_records, takže nemůže dojít ke dvojímu započítání.
 */
export type ShiftAggregate = {
  key: string;
  employee_id: string;
  work_date: string;
  shift: string;
  lines: string[];
  lineCount: number;
  products: string[];
  records: DailyRecord[];
  /** Aritmetický průměr z dostupných hodnot dané metriky (chybějící ≠ 0). */
  oee: number | null;
  performance: number | null;
  availableTime: number | null;
  /** Výpomoc za směnu (ne za linku). */
  help: number | null;
  coworkerIds: string[];
  sources: string[];
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Průměr pouze z platných číselných hodnot; prázdné pole => null. */
export function avgValid(values: (number | null | undefined)[]): number | null {
  const nums = values.map(num).filter((v): v is number => v !== null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export const shiftKey = (employeeId: string, workDate: string, shift: string) =>
  `${employeeId}|${workDate}|${shift}`;

/**
 * Agregace linkových záznamů na směnové jednotky.
 * Jednotkou pro denní výkon pracovníka je právě jeden ShiftAggregate.
 */
export function aggregateShifts(
  records: DailyRecord[],
  evaluations: ShiftEvaluation[] = [],
  links: CoworkerLink[] = [],
): ShiftAggregate[] {
  const groups = new Map<string, DailyRecord[]>();
  for (const r of records) {
    const k = shiftKey(r.employee_id, r.work_date, r.shift);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const evalMap = new Map<string, ShiftEvaluation>();
  for (const e of evaluations) {
    evalMap.set(shiftKey(e.employee_id, e.work_date, e.shift), e);
  }

  const out: ShiftAggregate[] = [];
  for (const [key, recs] of groups) {
    const first = recs[0]!;
    const ev = evalMap.get(key);
    const recIds = new Set(recs.map((r) => r.id));
    const coworkerIds = Array.from(
      new Set(
        links
          .filter((l) => recIds.has(l.record_id))
          .map((l) => l.coworker_id)
          .filter((id) => id !== first.employee_id),
      ),
    );
    out.push({
      key,
      employee_id: first.employee_id,
      work_date: first.work_date,
      shift: first.shift,
      lines: Array.from(new Set(recs.map((r) => r.line).filter(Boolean))),
      lineCount: recs.length,
      products: Array.from(new Set(recs.map((r) => r.product).filter((p): p is string => !!p))),
      records: recs,
      oee: avgValid(recs.map((r) => r.oee)),
      performance: avgValid(recs.map((r) => r.performance)),
      availableTime: avgValid(recs.map((r) => r.available_time)),
      // Výpomoc: primárně směnové hodnocení; jinak jedna hodnota za směnu
      // (průměr z historických linkových záznamů), nikdy se nenásobí počtem linek.
      help: ev ? Number(ev.help_score) : avgValid(recs.map((r) => r.help_score)),
      coworkerIds,
      sources: Array.from(new Set(recs.map((r) => r.source ?? "manual"))),
    });
  }

  return out.sort(
    (a, b) => b.work_date.localeCompare(a.work_date) || a.shift.localeCompare(b.shift),
  );
}

/** Linkové záznamy pracovníka v dané směně (detail / audit). */
export function lineRecordsForShift(
  records: DailyRecord[],
  employeeId: string,
  workDate: string,
  shift: string,
) {
  return records.filter(
    (r) => r.employee_id === employeeId && r.work_date === workDate && r.shift === shift,
  );
}

/** Duplicita = stejný pracovník + datum + směna + STEJNÁ linka. */
export function isDuplicateLine(
  records: DailyRecord[],
  employeeId: string,
  workDate: string,
  shift: string,
  line: string,
) {
  const l = line.trim().toLowerCase();
  return records.some(
    (r) =>
      r.employee_id === employeeId &&
      r.work_date === workDate &&
      r.shift === shift &&
      r.line.trim().toLowerCase() === l,
  );
}
