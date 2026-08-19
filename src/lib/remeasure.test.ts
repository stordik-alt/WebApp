import { describe, expect, it } from "vitest";
import { detectRemeasureProposals, newProposals, productShifts } from "./remeasure";
import type { DailyRecord } from "./metrics";

const rec = (
  p: Partial<DailyRecord> & { id: string; work_date: string; oee: number | null },
): DailyRecord => ({
  shift: "Ranní",
  line: "A",
  product: "ABC-123",
  employee_id: "e1",
  position: "HA",
  help_score: 0,
  note: null,
  is_demo: false,
  source: "manual",
  screenshot_path: null,
  product_id: null,
  performance: null,
  available_time: null,
  ...p,
});

describe("přeměření norem", () => {
  it("98/95/97 vytvoří návrh", () => {
    const p = detectRemeasureProposals([
      rec({ id: "1", work_date: "2026-08-01", oee: 98 }),
      rec({ id: "2", work_date: "2026-08-02", oee: 95 }),
      rec({ id: "3", work_date: "2026-08-03", oee: 97 }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]!.product).toBe("ABC-123");
    expect(p[0]!.avgOee).toBeCloseTo((98 + 95 + 97) / 3);
    expect(p[0]!.shifts).toHaveLength(3);
  });

  it("98/95/101 návrh nevytvoří", () => {
    const p = detectRemeasureProposals([
      rec({ id: "1", work_date: "2026-08-01", oee: 98 }),
      rec({ id: "2", work_date: "2026-08-02", oee: 95 }),
      rec({ id: "3", work_date: "2026-08-03", oee: 101 }),
    ]);
    expect(p).toHaveLength(0);
  });

  it("98/95/bez OEE => bez třetí validní směny žádný návrh", () => {
    const p = detectRemeasureProposals([
      rec({ id: "1", work_date: "2026-08-01", oee: 98 }),
      rec({ id: "2", work_date: "2026-08-02", oee: 95 }),
      rec({ id: "3", work_date: "2026-08-03", oee: null }),
    ]);
    expect(p).toHaveLength(0);
  });

  it("směna bez OEE řadu nepřeruší (98/95/–/97 => návrh)", () => {
    const p = detectRemeasureProposals([
      rec({ id: "1", work_date: "2026-08-01", oee: 98 }),
      rec({ id: "2", work_date: "2026-08-02", oee: 95 }),
      rec({ id: "3", work_date: "2026-08-03", oee: null }),
      rec({ id: "4", work_date: "2026-08-04", oee: 97 }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]!.shifts.map((s) => s.work_date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-04",
    ]);
  });

  it("jiný produkt mezi směnami řady nemíchá", () => {
    const p = detectRemeasureProposals([
      rec({ id: "1", work_date: "2026-08-01", oee: 98 }),
      rec({ id: "2", work_date: "2026-08-02", oee: 95, product: "XYZ-9" }),
      rec({ id: "3", work_date: "2026-08-03", oee: 97 }),
    ]);
    expect(p).toHaveLength(0);
  });

  it("více linek jednoho pracovníka ve směně se nezapočítá dvakrát", () => {
    const shifts = productShifts([
      rec({ id: "1", work_date: "2026-08-01", oee: 90, line: "A" }),
      rec({ id: "2", work_date: "2026-08-01", oee: 98, line: "B" }),
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.oee).toBe(94);
    expect(shifts[0]!.lines).toEqual(["A", "B"]);
  });

  it("existující nebo čekající návrh se nenabídne znovu", () => {
    const records = [
      rec({ id: "1", work_date: "2026-08-01", oee: 98 }),
      rec({ id: "2", work_date: "2026-08-02", oee: 95 }),
      rec({ id: "3", work_date: "2026-08-03", oee: 97 }),
    ];
    const key = detectRemeasureProposals(records)[0]!.triggerKey;
    expect(
      newProposals(records, [{ trigger_key: key, product_code: "ABC-123", status: "pending" }]),
    ).toHaveLength(0);
    expect(
      newProposals(records, [
        { trigger_key: "jiny", product_code: "ABC-123", status: "pending" },
      ]),
    ).toHaveLength(0);
    expect(
      newProposals(records, [{ trigger_key: key, product_code: "ABC-123", status: "rejected" }]),
    ).toHaveLength(0);
  });
});
