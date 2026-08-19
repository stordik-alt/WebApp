import { describe, expect, it } from "vitest";
import { aggregateShifts, isDuplicateLine, avgValid, type ShiftEvaluation } from "./shifts";
import { computePerformance } from "./metrics";
import type { DailyRecord } from "./metrics";

const rec = (p: Partial<DailyRecord> & { id: string; employee_id: string; line: string }): DailyRecord => ({
  work_date: "2026-08-17",
  shift: "Ranní",
  product: "P1",
  position: "HA",
  oee: 100,
  help_score: 0,
  note: null,
  is_demo: false,
  source: "manual",
  screenshot_path: null,
  product_id: null,
  performance: 100,
  available_time: 100,
  ...p,
});

describe("směnová agregace", () => {
  it("1 pracovník / 1 linka = hodnota linky", () => {
    const a = aggregateShifts([rec({ id: "1", employee_id: "e1", line: "A", oee: 97 })]);
    expect(a).toHaveLength(1);
    expect(a[0]!.oee).toBe(97);
    expect(a[0]!.lineCount).toBe(1);
  });

  it("1 pracovník / 2 linky = aritmetický průměr (100 a 110 => 105)", () => {
    const a = aggregateShifts([
      rec({ id: "1", employee_id: "e1", line: "A", oee: 100, performance: 90, available_time: 80 }),
      rec({ id: "2", employee_id: "e1", line: "B", oee: 110, performance: 100, available_time: 90 }),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]!.oee).toBe(105);
    expect(a[0]!.performance).toBe(95);
    expect(a[0]!.availableTime).toBe(85);
    expect(a[0]!.lineCount).toBe(2);
    expect(a[0]!.lines).toEqual(["A", "B"]);
  });

  it("2 pracovníci / 2 linky = dva samostatné směnové záznamy", () => {
    const a = aggregateShifts([
      rec({ id: "1", employee_id: "e1", line: "A", oee: 100 }),
      rec({ id: "2", employee_id: "e2", line: "B", oee: 80 }),
    ]);
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.oee).sort((p, q) => (p ?? 0) - (q ?? 0))).toEqual([80, 100]);
  });

  it("druhý import stejného pracovníka na jinou linku přidá linku, nepřepíše", () => {
    const first = [rec({ id: "1", employee_id: "e1", line: "A", oee: 100 })];
    const afterSecond = [...first, rec({ id: "2", employee_id: "e1", line: "B", oee: 110 })];
    expect(aggregateShifts(afterSecond)[0]!.records).toHaveLength(2);
    expect(isDuplicateLine(first, "e1", "2026-08-17", "Ranní", "B")).toBe(false);
  });

  it("opakovaný import stejného screenshotu je duplicita (stejná linka)", () => {
    const existing = [rec({ id: "1", employee_id: "e1", line: "A" })];
    expect(isDuplicateLine(existing, "e1", "2026-08-17", "Ranní", "a")).toBe(true);
  });

  it("absence = žádný záznam, do průměru se nezapočítá", () => {
    const a = aggregateShifts([
      rec({ id: "1", employee_id: "e1", line: "A", oee: 100 }),
      rec({ id: "2", employee_id: "e1", line: "A", work_date: "2026-08-18", oee: 60 }),
    ]);
    // e2 nebyl ve směně -> nemá agregát
    expect(a.some((x) => x.employee_id === "e2")).toBe(false);
    expect(avgValid(a.map((x) => x.oee))).toBe(80);
  });

  it("chybějící OEE na jedné lince: průměruje se jen z dostupných, ostatní metriky zůstanou", () => {
    const a = aggregateShifts([
      rec({ id: "1", employee_id: "e1", line: "A", oee: null, performance: 90 }),
      rec({ id: "2", employee_id: "e1", line: "B", oee: 110, performance: 110 }),
    ]);
    expect(a[0]!.oee).toBe(110);
    expect(a[0]!.performance).toBe(100);
  });

  it("chybí všechny hodnoty metriky => null, ne 0", () => {
    const a = aggregateShifts([
      rec({ id: "1", employee_id: "e1", line: "A", oee: null, performance: null, available_time: null }),
    ]);
    expect(a[0]!.oee).toBeNull();
    expect(a[0]!.performance).toBeNull();
  });

  it("výpomoc je jednou za pracovníka+datum+směnu, nenásobí se počtem linek", () => {
    const evals: ShiftEvaluation[] = [
      {
        id: "s1",
        employee_id: "e1",
        work_date: "2026-08-17",
        shift: "Ranní",
        help_score: 40,
        note: null,
        is_demo: false,
      },
    ];
    const a = aggregateShifts(
      [
        rec({ id: "1", employee_id: "e1", line: "A", help_score: 0 }),
        rec({ id: "2", employee_id: "e1", line: "B", help_score: 0 }),
      ],
      evals,
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.help).toBe(40);
  });

  it("spolupracovníci se drží u linkového záznamu, směna ukazuje sjednocení", () => {
    const a = aggregateShifts(
      [
        rec({ id: "1", employee_id: "e1", line: "A" }),
        rec({ id: "2", employee_id: "e1", line: "B" }),
      ],
      [],
      [
        { record_id: "1", coworker_id: "e2" },
        { record_id: "2", coworker_id: "e3" },
        { record_id: "2", coworker_id: "e2" },
      ],
    );
    expect(a[0]!.coworkerIds.sort()).toEqual(["e2", "e3"]);
  });
});

describe("výkonnost používá směnové jednotky (ochrana proti dvojímu započítání)", () => {
  it("dvě linky = jedna směna, ne dvě", () => {
    const shifts = aggregateShifts([
      rec({ id: "1", employee_id: "e1", line: "A", oee: 100 }),
      rec({ id: "2", employee_id: "e1", line: "B", oee: 110 }),
    ]);
    const perf = computePerformance(shifts, [], 1);
    expect(perf.shifts).toBe(1);
    expect(perf.avgOee).toBe(105);
  });

  it("práce na více linkách nezvýhodní ani nepoškodí proti jedné lince", () => {
    const multi = computePerformance(
      aggregateShifts([
        rec({ id: "1", employee_id: "e1", line: "A", oee: 100 }),
        rec({ id: "2", employee_id: "e1", line: "B", oee: 110 }),
      ]),
      [],
      1,
    );
    const single = computePerformance(
      aggregateShifts([rec({ id: "3", employee_id: "e2", line: "A", oee: 105 })]),
      [],
      1,
    );
    expect(multi.avgOee).toBe(single.avgOee);
    expect(multi.shifts).toBe(single.shifts);
  });
});
