import { describe, expect, it } from "vitest";
import { hallGroup, hallSortOrder, normalizeParentLine } from "@/lib/floorMap";

describe("small hall workplace synchronization", () => {
  it("normalizes child workplace names to the parent line", () => {
    expect(normalizeParentLine("L1/1_1", "HandAssy OPF")).toBe("L1/1");
    expect(normalizeParentLine("L1/4 HF", "TouchUp")).toBe("L1/4");
    expect(normalizeParentLine("L3/4", "TouchUp")).toBe("L3/4");
    expect(normalizeParentLine("L1 (Delta)", "L1/1_1 OPF (TUP)")).toBe("L1/1");
  });

  it("keeps broad hall families available for map-only metadata", () => {
    expect(hallGroup("L1/1", "HandAssy")).toBe("L1");
    expect(hallGroup("L3/4", "TouchUp")).toBe("L3");
    expect(hallGroup("Olovo", "HandAssy krátká linka")).toBe("Olovo");
  });

  it("sorts parent lines in the required order", () => {
    expect(hallSortOrder("L1/1", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L1/2", "HandAssy", "HA"));
    expect(hallSortOrder("L1/4", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L3/1", "HandAssy", "HA"));
    expect(hallSortOrder("L3/4", "TouchUp", "TUP")).toBeLessThan(hallSortOrder("Olovo", "TouchUp", "TUP"));
  });

  it("places HA before TUP on the same parent line", () => {
    expect(hallSortOrder("L1/4", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L1/4", "TouchUp", "TUP"));
    expect(hallSortOrder("L3/1", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L3/1", "TouchUp", "TUP"));
  });
});
