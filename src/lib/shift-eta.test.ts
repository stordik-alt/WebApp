import { describe, expect, it } from "vitest";
import { computeExpectedCompletion } from "./shift-eta";

const base = {
  shift: "Ranní" as const,
  workDate: "2026-09-21",
  fromTime: "06:00",
  normPerHour: 60,
  designedCapacity: 2,
  assignedOperators: 2,
};

describe("computeExpectedCompletion", () => {
  it("is DONE when there are no remaining pieces", () => {
    expect(computeExpectedCompletion({ ...base, remainingPieces: 0 })).toEqual({ status: "DONE" });
  });

  it("is NO_OPERATOR when nobody is assigned, even if pieces remain", () => {
    expect(computeExpectedCompletion({ ...base, remainingPieces: 10, assignedOperators: 0 })).toEqual({ status: "NO_OPERATOR" });
  });

  it("is INVALID when norm or capacity is not positive", () => {
    expect(computeExpectedCompletion({ ...base, remainingPieces: 10, normPerHour: 0 })).toEqual({ status: "INVALID" });
    expect(computeExpectedCompletion({ ...base, remainingPieces: 10, designedCapacity: 0 })).toEqual({ status: "INVALID" });
  });

  it("WILL_FINISH: full staffing, comfortably within the shift", () => {
    // norm=60/h, capacity=2, assigned=2 => staffing ratio 1 => effective rate 60/h.
    // The first 7 minutes of the shift are setup (not productive), so the productive
    // clock effectively starts at 06:07; 60 pieces needed => 60 min => 07:07.
    const result = computeExpectedCompletion({ ...base, remainingPieces: 60 });
    expect(result.status).toBe("WILL_FINISH");
    if (result.status === "WILL_FINISH") {
      expect(result.expectedCompletionAt).toBe("2026-09-21T07:07:00.000Z");
    }
  });

  it("WILL_FINISH: under capacity but still finishes, taking proportionally longer", () => {
    // Same norm/capacity, but only 1 of 2 designed operators assigned => staffing ratio 0.5 => 30 pieces/h.
    // 60 pieces needed => 120 min, which still lands before the 10:40 break starts.
    const result = computeExpectedCompletion({ ...base, remainingPieces: 60, assignedOperators: 1 });
    expect(result.status).toBe("WILL_FINISH");
  });

  it("WONT_FINISH: too many pieces remain for the rest of the shift", () => {
    const result = computeExpectedCompletion({ ...base, remainingPieces: 100_000 });
    expect(result.status).toBe("WONT_FINISH");
    if (result.status === "WONT_FINISH") {
      expect(result.minutesShort).toBeGreaterThan(0);
    }
  });

  it("correctly excludes the break: finishing right before vs. right after it differs by exactly the pause length", () => {
    // effective rate 60/h => 1 piece/min. Needing 40 min (10:00->10:40) lands exactly at break start.
    const justBefore = computeExpectedCompletion({ ...base, fromTime: "10:00", remainingPieces: 40 });
    expect(justBefore.status).toBe("WILL_FINISH");
    if (justBefore.status === "WILL_FINISH") expect(justBefore.expectedCompletionAt).toBe("2026-09-21T10:40:00.000Z");

    // One more minute needed must skip the 30-minute break entirely, landing at 11:11 not 10:41.
    const justAfter = computeExpectedCompletion({ ...base, fromTime: "10:00", remainingPieces: 41 });
    expect(justAfter.status).toBe("WILL_FINISH");
    if (justAfter.status === "WILL_FINISH") expect(justAfter.expectedCompletionAt).toBe("2026-09-21T11:11:00.000Z");
  });

  it("handles the Noční shift crossing midnight into the next calendar day", () => {
    // Same 7-minute setup offset applies at the start of every shift, including Noční.
    const result = computeExpectedCompletion({ ...base, shift: "Noční", fromTime: "22:00", remainingPieces: 60 });
    expect(result.status).toBe("WILL_FINISH");
    if (result.status === "WILL_FINISH") {
      expect(result.expectedCompletionAt).toBe("2026-09-21T23:07:00.000Z");
    }
  });

  it("handles the Noční shift's hours that land on the next calendar day", () => {
    // 60 pieces at full staffing from 22:00 lands well before the break (02:00), so start further along:
    // starting at 05:00 (which is really "next day" relative to work_date) with 30 pieces needed => 05:30 next day.
    const result = computeExpectedCompletion({ ...base, shift: "Noční", fromTime: "05:00", remainingPieces: 30 });
    expect(result.status).toBe("WILL_FINISH");
    if (result.status === "WILL_FINISH") {
      expect(result.expectedCompletionAt).toBe("2026-09-22T05:30:00.000Z");
    }
  });
});
