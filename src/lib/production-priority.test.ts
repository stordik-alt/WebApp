import { describe, expect, it } from "vitest";
import { priorityMapFromOrder, toggleProductionSelection } from "./production-priority";

describe("toggleProductionSelection", () => {
  it("appends a newly clicked production to the end of the order", () => {
    expect(toggleProductionSelection([], "p1")).toEqual(["p1"]);
    expect(toggleProductionSelection(["p1"], "p2")).toEqual(["p1", "p2"]);
  });

  it("removes a production that was already selected, preserving the order of the rest", () => {
    expect(toggleProductionSelection(["p1", "p2", "p3"], "p2")).toEqual(["p1", "p3"]);
  });

  it("re-clicking after removal appends it at the end again (new priority, not the old slot)", () => {
    const afterRemoval = toggleProductionSelection(["p1", "p2"], "p1");
    expect(toggleProductionSelection(afterRemoval, "p1")).toEqual(["p2", "p1"]);
  });
});

describe("priorityMapFromOrder", () => {
  it("assigns priority 1 to the first click and increments from there", () => {
    const map = priorityMapFromOrder(["p3", "p1", "p2"]);
    expect(map.get("p3")).toBe(1);
    expect(map.get("p1")).toBe(2);
    expect(map.get("p2")).toBe(3);
  });

  it("is empty for an empty order", () => {
    expect(priorityMapFromOrder([]).size).toBe(0);
  });
});
