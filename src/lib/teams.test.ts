import { describe, expect, it } from "vitest";
import { resolveEffectiveRoster, type IwShiftException, type IwTeamMember } from "./teams";

const member = (employeeId: string): IwTeamMember => ({
  id: `m-${employeeId}`,
  team_id: "team-1",
  employee_id: employeeId,
  added_at: "2026-09-01T00:00:00Z",
});

const exception = (employeeId: string, type: "add" | "remove"): IwShiftException => ({
  id: `e-${employeeId}-${type}`,
  team_id: "team-1",
  work_date: "2026-09-20",
  shift: "Ranní",
  employee_id: employeeId,
  exception_type: type,
  reason: null,
  created_by: null,
  created_at: "2026-09-20T05:00:00Z",
});

// Spec scenario #13: základní tým se nesmí měnit vlivem výjimky pro jednu směnu.
describe("resolveEffectiveRoster", () => {
  it("returns the base team unchanged when there are no exceptions", () => {
    const members = [member("e1"), member("e2")];
    expect(resolveEffectiveRoster(members, []).sort()).toEqual(["e1", "e2"]);
  });

  it("add-only: adds an extra employee for this shift without touching the base team", () => {
    const members = [member("e1")];
    const exceptions = [exception("e2", "add")];
    expect(resolveEffectiveRoster(members, exceptions).sort()).toEqual(["e1", "e2"]);
    // The base member list itself is never mutated by resolving exceptions.
    expect(members).toEqual([member("e1")]);
  });

  it("remove-only: removes a base member for this shift only", () => {
    const members = [member("e1"), member("e2")];
    const exceptions = [exception("e1", "remove")];
    expect(resolveEffectiveRoster(members, exceptions)).toEqual(["e2"]);
  });

  it("add+remove of the same employee: remove wins", () => {
    const members = [member("e1")];
    const exceptions = [exception("e1", "add"), exception("e1", "remove")];
    expect(resolveEffectiveRoster(members, exceptions)).toEqual([]);
  });
});
