import { describe, expect, it } from "vitest";
import { deriveWorkstationStatus } from "./StatusBadge";

describe("deriveWorkstationStatus", () => {
  it("is 'full' when assigned meets designed capacity", () => {
    expect(deriveWorkstationStatus({ designedCapacity: 2, assignedCount: 2, hasTemp: false, isSecondary: false })).toBe("full");
  });

  it("is 'under_capacity' when assigned is positive but below designed capacity", () => {
    expect(deriveWorkstationStatus({ designedCapacity: 2, assignedCount: 1, hasTemp: false, isSecondary: false })).toBe("under_capacity");
  });

  it("is 'no_operator' when nobody is assigned, but never blocks (still a valid status)", () => {
    expect(deriveWorkstationStatus({ designedCapacity: 3, assignedCount: 0, hasTemp: false, isSecondary: false })).toBe("no_operator");
  });

  it("is 'temp' when a temporary operator is present, taking priority over capacity math", () => {
    expect(deriveWorkstationStatus({ designedCapacity: 2, assignedCount: 2, hasTemp: true, isSecondary: false })).toBe("temp");
  });

  it("is 'secondary' for TESTY/PREP regardless of staffing", () => {
    expect(deriveWorkstationStatus({ designedCapacity: 0, assignedCount: 5, hasTemp: false, isSecondary: true })).toBe("secondary");
  });
});
