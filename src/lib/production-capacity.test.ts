import { describe, expect, it } from "vitest";
import { productCapacityFor, productionCapacity, type ProfileCapacity } from "./production-capacity";

describe("productCapacityFor", () => {
  it("picks h_capacity for HA and t_capacity for TUP", () => {
    const profile: ProfileCapacity = { area: "HA", h_capacity: 3, t_capacity: 1 };
    expect(productCapacityFor(profile)).toBe(3);
    expect(productCapacityFor({ ...profile, area: "TUP" })).toBe(1);
  });

  it("is null when the relevant side is missing or non-positive", () => {
    expect(productCapacityFor({ area: "HA", h_capacity: null, t_capacity: 2 })).toBeNull();
    expect(productCapacityFor({ area: "HA", h_capacity: 0, t_capacity: 2 })).toBeNull();
  });
});

// Kapacita produktu (jedna výroba) a kapacita výroby (součet přes všechny aktivní výroby)
// jsou dva různé pojmy a nesmí se nikdy zaměnit (příklad ze zadání: HA01=3, HA02=2, HA03=4 => 9).
describe("productionCapacity", () => {
  it("sums per-production capacity across all active productions", () => {
    const productions: ProfileCapacity[] = [
      { area: "HA", h_capacity: 3, t_capacity: null },
      { area: "HA", h_capacity: 2, t_capacity: null },
      { area: "HA", h_capacity: 4, t_capacity: null },
    ];
    expect(productionCapacity(productions)).toBe(9);
  });

  it("differs from any single production's own capacity once more than one production is active", () => {
    const productions: ProfileCapacity[] = [
      { area: "HA", h_capacity: 3, t_capacity: null },
      { area: "TUP", h_capacity: null, t_capacity: 2 },
    ];
    const total = productionCapacity(productions);
    expect(total).toBe(5);
    for (const production of productions) {
      expect(total).not.toBe(productCapacityFor(production));
    }
  });

  it("treats a missing/invalid capacity as zero contribution rather than throwing", () => {
    expect(productionCapacity([{ area: "HA", h_capacity: null, t_capacity: null }])).toBe(0);
  });
});
