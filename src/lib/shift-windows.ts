/**
 * Časový model směny pro Interaktivní prostředí (Verze 2.02).
 *
 * Tyto konstanty NEJSOU nový zdroj pravdy – jsou přesným zrcadlem hodnot
 * z kanonické SQL funkce `public.auto_shift_productive_minutes()`
 * (naposledy definované v migraci 20260917000000_restore_recalculate_import_item_kpis_v19.sql
 * a jejích předchůdcích; ověřeno přímo v databázi). Pokud se tam časy směny,
 * pauzy, příprava nebo úklid změní, MUSÍ se změnit i zde – jinak se plánovací
 * vrstva (dokončení výroby) rozejde s KPI vrstvou (skutečný Výkon/OEE).
 *
 * Souřadnice jsou "absolutní minuty dne směny": Ranní/Odpolední běží 0–1440,
 * Noční používá hodnoty 1320–1800 (tj. 22:00–06:00 vyjádřené jako pokračování
 * za půlnoc), přesně jako v SQL funkci.
 */
export type IwShiftName = "Ranní" | "Odpolední" | "Noční";

export type ShiftBounds = {
  start: number;
  end: number;
  breakStart: number;
  breakEnd: number;
};

export const SETUP_MINUTES = 7;
export const CLEANUP_MINUTES = 5;
export const SHIFT_LENGTH_MINUTES = 480;
/** Čistý produktivní čas směny bez pauzy/přípravy/úklidu (8:00 − 0:30 − 0:07 − 0:05). */
export const NET_PRODUCTIVE_MINUTES = SHIFT_LENGTH_MINUTES - 30 - SETUP_MINUTES - CLEANUP_MINUTES;

export const SHIFT_BOUNDS: Record<IwShiftName, ShiftBounds> = {
  Ranní: { start: 6 * 60, end: 14 * 60, breakStart: 10 * 60 + 40, breakEnd: 11 * 60 + 10 },
  Odpolední: { start: 14 * 60, end: 22 * 60, breakStart: 18 * 60, breakEnd: 18 * 60 + 30 },
  Noční: { start: 22 * 60, end: 30 * 60, breakStart: 26 * 60, breakEnd: 26 * 60 + 30 },
};

// # dělá: rozloží "HH:MM" na minuty od půlnoci
export function timeToMinutes(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) throw new Error(`Neplatný čas: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// # dělá: převede reálný čas na "hodiny dne směny" – u Noční se čas před 22:00 počítá jako pokračování za půlnoc (+1440)
export function toShiftAbsoluteMinutes(shift: IwShiftName, time: string): number {
  const minutes = timeToMinutes(time);
  if (shift === "Noční" && minutes < 22 * 60) return minutes + 24 * 60;
  return minutes;
}

// # dělá: spočítá zbývající produktivní minuty od zadaného času do konce směny (bez pauzy/přípravy/úklidu)
export function remainingProductiveMinutes(shift: IwShiftName, fromTime: string): number {
  const bounds = SHIFT_BOUNDS[shift];
  const nowAbs = toShiftAbsoluteMinutes(shift, fromTime);
  const windowStart = Math.max(nowAbs, bounds.start + SETUP_MINUTES);
  const windowEnd = bounds.end - CLEANUP_MINUTES;
  const raw = Math.max(0, windowEnd - windowStart);
  const breakOverlap = Math.max(0, Math.min(windowEnd, bounds.breakEnd) - Math.max(windowStart, bounds.breakStart));
  return Math.max(0, raw - breakOverlap);
}

export type CompletionOffset = { offsetAbsoluteMinutes: number } | { minutesShort: number };

// # dělá: najde absolutní minutu dne směny, kdy se nasčítá `minutesNeeded` produktivních minut od `fromTime`
export function findCompletionOffset(shift: IwShiftName, fromTime: string, minutesNeeded: number): CompletionOffset {
  const bounds = SHIFT_BOUNDS[shift];
  const nowAbs = toShiftAbsoluteMinutes(shift, fromTime);
  const windowStart = Math.max(nowAbs, bounds.start + SETUP_MINUTES);
  const windowEnd = bounds.end - CLEANUP_MINUTES;

  if (windowStart >= bounds.breakEnd) {
    const avail = windowEnd - windowStart;
    if (minutesNeeded <= avail) return { offsetAbsoluteMinutes: windowStart + minutesNeeded };
    return { minutesShort: minutesNeeded - Math.max(0, avail) };
  }
  if (windowStart <= bounds.breakStart) {
    const seg1 = bounds.breakStart - windowStart;
    if (minutesNeeded <= seg1) return { offsetAbsoluteMinutes: windowStart + minutesNeeded };
    const remaining = minutesNeeded - seg1;
    const seg2 = windowEnd - bounds.breakEnd;
    if (remaining <= seg2) return { offsetAbsoluteMinutes: bounds.breakEnd + remaining };
    return { minutesShort: remaining - Math.max(0, seg2) };
  }
  // windowStart leží uvnitř pauzy – produktivní čas pokračuje až od jejího konce.
  const seg2 = windowEnd - bounds.breakEnd;
  if (minutesNeeded <= seg2) return { offsetAbsoluteMinutes: bounds.breakEnd + minutesNeeded };
  return { minutesShort: minutesNeeded - Math.max(0, seg2) };
}

// # dělá: převede absolutní minutu dne směny (může přesáhnout 1440 u Noční) na skutečné ISO datum/čas
export function shiftAbsoluteMinutesToIso(workDate: string, absoluteMinutes: number): string {
  const [year, month, day] = workDate.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0) + absoluteMinutes * 60_000;
  return new Date(ms).toISOString();
}
