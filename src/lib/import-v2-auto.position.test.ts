import { describe, expect, it } from "vitest";
import { validateImportRowPosition } from "@/lib/import-v2-auto";

describe("import application position guard", () => {
  it("accepts only HA or TUP", () => {
    expect(validateImportRowPosition("HA")).toBe("HA");
    expect(validateImportRowPosition("TUP")).toBe("TUP");
  });

  it("rejects combined or unknown positions before persistence", () => {
    expect(validateImportRowPosition("HA/TUP")).toBeNull();
    expect(validateImportRowPosition("HA / TUP")).toBeNull();
    expect(validateImportRowPosition("HA-TUP")).toBeNull();
    expect(validateImportRowPosition("HA + TUP")).toBeNull();
    expect(validateImportRowPosition("XYZ")).toBeNull();
  });

  it("does not turn missing position into an inferred role at the persistence boundary", () => {
    expect(validateImportRowPosition(null)).toBeNull();
    expect(validateImportRowPosition("")).toBeNull();
  });
});
