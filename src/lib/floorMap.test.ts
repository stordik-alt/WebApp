import { describe, expect, it } from "vitest";
import { hallGroup, hallSortOrder, normalizeParentLine } from "@/lib/floorMap";

describe("small hall workplace synchronization", () => {
  it("groups child workplaces under the parent line", () => {\n    expect(normalizeParentLine("L1/1_1", "HandAssy OPF")).toBe("L1/1");\n    expect(normalizeParentLine("L1/4 HF", "TouchUp")).toBe("L1/4");\n    expect(normalizeParentLine("L3/4", "TouchUp")).toBe("L3/4");\n  });\n\n  it("maps L1 and L3 workplaces to the correct hall groups", () => {
    expect(hallGroup("L1/1", "HandAssy")).toBe("L1 (Delta)");
    expect(hallGroup("L3/4", "TouchUp")).toBe("L3 (Ersa)");
    expect(hallGroup("Olovo", "HandAssy krátká linka")).toBe("Olovo");
  });

  it("keeps L1 before L3 and Olovo at the end", () => {
    expect(hallSortOrder("L1/1", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L1/2", "HandAssy", "HA"));
    expect(hallSortOrder("L1/4", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L3/1", "HandAssy", "HA"));
    expect(hallSortOrder("L3/4", "TouchUp", "TUP")).toBeLessThan(hallSortOrder("Olovo", "TouchUp", "TUP"));
  });

  it("places TUP directly after the corresponding HA station", () => {
    expect(hallSortOrder("L1/4", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L1/4", "TouchUp", "TUP"));
    expect(hallSortOrder("L3/1", "HandAssy", "HA")).toBeLessThan(hallSortOrder("L3/1", "TouchUp", "TUP"));
  });
});
