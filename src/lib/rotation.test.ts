import { describe, expect, it } from "vitest";
import { rotationScore, type RotationRecord } from "./rotation";

const record = (overrides: Partial<RotationRecord> & { employeeId: string }): RotationRecord => ({
  workDate: "2026-09-18",
  workstationCode: null,
  productCode: null,
  coworkerIds: [],
  ...overrides,
});

describe("rotationScore", () => {
  it("is 0 with no history at all", () => {
    expect(rotationScore("e1", { workstationCode: "HA-01", productCode: null }, [], [])).toBe(0);
  });

  it("adds 2 for repeating the same workstation within the lookback window", () => {
    const history = [record({ employeeId: "e1", workstationCode: "HA-01" })];
    expect(rotationScore("e1", { workstationCode: "HA-01", productCode: null }, history, [])).toBe(2);
  });

  it("adds 1 for repeating the same product", () => {
    const history = [record({ employeeId: "e1", workstationCode: "HA-02", productCode: "prod-x" })];
    expect(rotationScore("e1", { workstationCode: "HA-01", productCode: "prod-x" }, history, [])).toBe(1);
  });

  it("adds 1 for overlapping with an already-picked colleague from recent history", () => {
    const history = [record({ employeeId: "e1", coworkerIds: ["e2"] })];
    expect(rotationScore("e1", { workstationCode: "HA-01", productCode: null }, history, ["e2"])).toBe(1);
  });

  it("only counts the employee's own history, not another employee's", () => {
    const history = [record({ employeeId: "someone-else", workstationCode: "HA-01" })];
    expect(rotationScore("e1", { workstationCode: "HA-01", productCode: null }, history, [])).toBe(0);
  });

  it("stacks all three penalties when every condition is met", () => {
    const history = [record({ employeeId: "e1", workstationCode: "HA-01", productCode: "prod-x", coworkerIds: ["e2"] })];
    expect(rotationScore("e1", { workstationCode: "HA-01", productCode: "prod-x" }, history, ["e2"])).toBe(4);
  });
});
