import { describe, expect, it } from "vitest";
import { suggestAssignments, type EmployeeQualification, type ProductionSlot, type RestrictionMap, type SecondaryWorkstation } from "./shift-assignment";
import type { RotationRecord } from "./rotation";

const emp = (id: string, qual_ha: boolean, qual_tup: boolean): EmployeeQualification => ({ id, qual_ha, qual_tup });

const production = (overrides: Partial<ProductionSlot> & { productionId: string }): ProductionSlot => ({
  workstationId: `${overrides.productionId}-ws`,
  workstationCode: `${overrides.productionId}-code`,
  productCode: null,
  area: "HA",
  designedCapacity: 1,
  priority: null,
  sortOrder: 0,
  ...overrides,
});

const TESTY: SecondaryWorkstation = { id: "sec-testy", code: "SEC.TESTY" };
const PREP: SecondaryWorkstation = { id: "sec-prep", code: "SEC.PREP" };

const baseArgs = {
  tempEmployeeIds: [] as string[],
  secondaryWorkstations: [TESTY, PREP] as SecondaryWorkstation[],
  restrictions: new Map() as RestrictionMap,
  rotationHistory: [] as RotationRecord[],
};

describe("suggestAssignments", () => {
  it("scenario 1: sufficient staff fully staffs every production with 0 shortfall", () => {
    const e1 = emp("e1", true, false);
    const e2 = emp("e2", true, false);
    const e3 = emp("e3", false, true);
    const p1 = production({ productionId: "p1", area: "HA", designedCapacity: 2 });
    const p2 = production({ productionId: "p2", area: "TUP", designedCapacity: 1 });

    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: ["e1", "e2", "e3"], employees: [e1, e2, e3], productions: [p1, p2] });

    expect(result.shortfallByProduction.get("p1")).toBe(0);
    expect(result.shortfallByProduction.get("p2")).toBe(0);
    expect(result.assignments.filter((a) => a.productionId === "p1").map((a) => a.employeeId).sort()).toEqual(["e1", "e2"]);
    expect(result.assignments.find((a) => a.productionId === "p2")?.employeeId).toBe("e3");
    expect(result.unassigned).toEqual([]);
  });

  it("scenario 2: a 1-person shortage runs the production under capacity, never blocking", () => {
    const e1 = emp("e1", true, false);
    const p1 = production({ productionId: "p1", area: "HA", designedCapacity: 2 });

    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: ["e1"], employees: [e1], productions: [p1] });

    expect(result.assignments.map((a) => a.employeeId)).toEqual(["e1"]);
    expect(result.shortfallByProduction.get("p1")).toBe(1);
  });

  it("scenario 3: a severe shortage can leave a production with 0 operators without blocking the algorithm", () => {
    const p1 = production({ productionId: "p1", area: "HA", designedCapacity: 3 });

    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: [], employees: [], productions: [p1] });

    expect(result.assignments).toEqual([]);
    expect(result.shortfallByProduction.get("p1")).toBe(3);
  });

  it("scenario 4: a temporary operator fills a gap and is marked assignmentType 'temp'", () => {
    const temp1 = emp("temp1", true, false);
    const p1 = production({ productionId: "p1", area: "HA", designedCapacity: 1 });

    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: [], tempEmployeeIds: ["temp1"], employees: [temp1], productions: [p1] });

    expect(result.assignments).toEqual([{ employeeId: "temp1", workstationId: "p1-ws", productionId: "p1", assignmentType: "temp" }]);
    expect(result.shortfallByProduction.get("p1")).toBe(0);
  });

  it("scenario 5: surplus staff beyond main production capacity is routed to secondary workstations", () => {
    const e1 = emp("e1", true, false);
    const e4 = emp("e4", false, false); // no HA/TUP qualification at all
    const p1 = production({ productionId: "p1", area: "HA", designedCapacity: 1 });

    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: ["e1", "e4"], employees: [e1, e4], productions: [p1] });

    expect(result.assignments.find((a) => a.employeeId === "e1")).toMatchObject({ productionId: "p1", assignmentType: "main" });
    const e4Assignment = result.assignments.find((a) => a.employeeId === "e4");
    expect(e4Assignment?.assignmentType).toBe("secondary");
    expect([TESTY.id, PREP.id]).toContain(e4Assignment?.workstationId);
  });

  it("scenario 6: an employee restricted from TESTY is routed to PREP instead, never blocked entirely", () => {
    const e4 = emp("e4", false, false);
    const restrictions: RestrictionMap = new Map([["e4", new Set([TESTY.id])]]);

    const result = suggestAssignments({ ...baseArgs, restrictions, rosterEmployeeIds: ["e4"], employees: [e4], productions: [] });

    expect(result.assignments).toEqual([{ employeeId: "e4", workstationId: PREP.id, productionId: null, assignmentType: "secondary" }]);
  });

  it("scenario 7: an employee without HA/TUP qualification is never auto-selected for main production, even understaffed", () => {
    const e4 = emp("e4", false, false);
    const p1 = production({ productionId: "p1", area: "HA", designedCapacity: 5 });

    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: ["e4"], employees: [e4], productions: [p1] });

    expect(result.assignments.find((a) => a.productionId === "p1")).toBeUndefined();
    expect(result.shortfallByProduction.get("p1")).toBe(5);
    // e4 falls through to surplus handling instead of being forced onto the unqualified production.
    expect(result.assignments.find((a) => a.employeeId === "e4")?.assignmentType).toBe("secondary");
  });

  it("scenario 8: an employee without HA/TUP qualification CAN be placed on TESTY/PREP when unrestricted", () => {
    const e4 = emp("e4", false, false);
    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: ["e4"], employees: [e4], productions: [] });
    expect(result.assignments[0]).toMatchObject({ employeeId: "e4", assignmentType: "secondary" });
  });

  it("scenario 9: Olovo's 1xHA + 2xTUP productions are staffed independently, HA pool never bleeds into TUP", () => {
    const haEmp = emp("ha1", true, false);
    const tupEmp1 = emp("tup1", false, true);
    const tupEmp2 = emp("tup2", false, true);
    const pHA = production({ productionId: "olovo-ha", area: "HA", designedCapacity: 1, sortOrder: 1 });
    const pTUP1 = production({ productionId: "olovo-tup1", area: "TUP", designedCapacity: 1, sortOrder: 2 });
    const pTUP2 = production({ productionId: "olovo-tup2", area: "TUP", designedCapacity: 1, sortOrder: 3 });

    const result = suggestAssignments({
      ...baseArgs,
      rosterEmployeeIds: ["ha1", "tup1", "tup2"],
      employees: [haEmp, tupEmp1, tupEmp2],
      productions: [pHA, pTUP1, pTUP2],
    });

    expect(result.assignments.find((a) => a.productionId === "olovo-ha")?.employeeId).toBe("ha1");
    const tupAssigned = result.assignments.filter((a) => a.productionId === "olovo-tup1" || a.productionId === "olovo-tup2").map((a) => a.employeeId);
    expect(tupAssigned.sort()).toEqual(["tup1", "tup2"]);
    expect(result.shortfallByProduction.get("olovo-ha")).toBe(0);
    expect(result.shortfallByProduction.get("olovo-tup1")).toBe(0);
    expect(result.shortfallByProduction.get("olovo-tup2")).toBe(0);
  });

  it("scenario 10 / 12: rotation prefers the candidate who was NOT recently on this workstation", () => {
    const e1 = emp("e1", true, false);
    const e2 = emp("e2", true, false);
    const p1 = production({ productionId: "p1", area: "HA", designedCapacity: 1, workstationCode: "HA-01" });
    const rotationHistory: RotationRecord[] = [
      { employeeId: "e1", workDate: "2026-09-18", workstationCode: "HA-01", productCode: null, coworkerIds: [] },
    ];

    const result = suggestAssignments({ ...baseArgs, rotationHistory, rosterEmployeeIds: ["e1", "e2"], employees: [e1, e2], productions: [p1] });

    expect(result.assignments.find((a) => a.productionId === "p1")?.employeeId).toBe("e2");
  });

  it("higher TL priority is filled before lower priority when staff is scarce", () => {
    const e1 = emp("e1", true, false);
    const highPriority = production({ productionId: "low-prio", area: "HA", designedCapacity: 1, priority: 2, sortOrder: 1 });
    const lowPriority = production({ productionId: "high-prio", area: "HA", designedCapacity: 1, priority: 1, sortOrder: 2 });

    const result = suggestAssignments({ ...baseArgs, rosterEmployeeIds: ["e1"], employees: [e1], productions: [highPriority, lowPriority] });

    expect(result.assignments).toEqual([{ employeeId: "e1", workstationId: "high-prio-ws", productionId: "high-prio", assignmentType: "main" }]);
    expect(result.shortfallByProduction.get("low-prio")).toBe(1);
  });
});
