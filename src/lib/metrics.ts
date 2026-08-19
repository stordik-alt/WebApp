import { avgValid, type ShiftAggregate } from "./shifts";

export type Employee = {
  id: string;
  full_name: string;
  personal_no: string | null;
  qual_ha: boolean;
  qual_tup: boolean;
  active: boolean;
  note: string | null;
  is_demo: boolean;
  created_at: string;
};

export type DailyRecord = {
  id: string;
  work_date: string;
  shift: string;
  line: string;
  product: string | null;
  employee_id: string;
  position: "HA" | "TUP";
  oee: number | null;
  help_score: number;
  note: string | null;
  is_demo: boolean;
  source?: string | null;
  screenshot_path?: string | null;
  product_id?: string | null;
  performance?: number | null;
  available_time?: number | null;
};

export type WeeklyRecord = {
  id: string;
  employee_id: string;
  iso_year: number;
  iso_week: number;
  yield_pct: number;
  auto_quality_score: number | null;
  is_alert: boolean;
  alert_cause: string | null;
  alert_note: string | null;
  operator_error: boolean | null;
  final_quality_score: number | null;
  alert_resolved: boolean;
  is_demo: boolean;
};

export const SHIFTS = ["Ranní", "Odpolední", "Noční"] as const;
export const POSITIONS = ["HA", "TUP"] as const;

/** Efektivní Quality Score – finální (po vyšetření) má přednost před automatickým. */
export function effectiveQuality(w: WeeklyRecord): number | null {
  if (w.final_quality_score !== null && w.final_quality_score !== undefined)
    return Number(w.final_quality_score);
  if (w.auto_quality_score !== null && w.auto_quality_score !== undefined)
    return Number(w.auto_quality_score);
  return null;
}

/** Náhled automatického skóre podle pravidel zadání (jen pro UI). */
export function previewAutoScore(yieldPct: number): number | null {
  if (yieldPct >= 90) return (yieldPct - 90) * 10;
  if (yieldPct >= 79) return (yieldPct - 89) * 10;
  return null;
}

export function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return Number(n).toLocaleString("cs-CZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function isoWeekMonday(year: number, week: number): Date {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  simple.setUTCDate(simple.getUTCDate() - dow + 1);
  return simple;
}

export function quarterOf(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export function halfOf(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-H${d.getMonth() < 6 ? 1 : 2}`;
}

/** Normalizace škály -100..+100 na 0..100. */
const norm = (v: number) => (v + 100) / 2;

export type Performance = {
  shifts: number;
  avgOee: number | null;
  avgQuality: number | null;
  avgHelp: number | null;
  ipi: number | null;
  enoughData: boolean;
};

export const MIN_SHIFTS_QUARTER = 15;

/**
 * IPI (Individual Performance Index) – PŘEDBĚŽNÝ návrh modelu.
 * Přesné váhy budou doladěny na reálných datech.
 */
export function computePerformance(
  shifts: ShiftAggregate[],
  weekly: WeeklyRecord[],
  minShifts = MIN_SHIFTS_QUARTER,
): Performance {
  // Jednotkou denního výkonu je SMĚNOVÝ agregát (průměr přes linky), ne linkový záznam.
  const avgOee = avgValid(shifts.map((s) => s.oee));
  const avgHelp = avgValid(shifts.map((s) => s.help));
  const q = weekly.map(effectiveQuality).filter((v): v is number => v !== null);
  const avgQuality = avg(q);

  let ipi: number | null = null;
  if (avgOee !== null) {
    let weight = 0.6;
    let sum = 0.6 * Math.min(avgOee, 130);
    if (avgQuality !== null) {
      sum += 0.25 * norm(avgQuality);
      weight += 0.25;
    }
    if (avgHelp !== null) {
      sum += 0.15 * norm(avgHelp);
      weight += 0.15;
    }
    ipi = sum / weight;
  }

  return {
    shifts: shifts.length,
    avgOee,
    avgQuality,
    avgHelp,
    ipi,
    enoughData: shifts.length >= minShifts,
  };
}
