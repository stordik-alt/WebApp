import { describe, expect, it } from "vitest";
import { isValidImportPosition, normalizeImportPosition } from "./import-position";

describe("import employee position", () => {
  it("accepts only the two real positions", () => {
    expect(normalizeImportPosition("HA")).toBe("HA");
    expect(normalizeImportPosition("TUP")).toBe("TUP");
    expect(isValidImportPosition("HA")).toBe(true);
    expect(isValidImportPosition("TUP")).toBe(true);
  });

  it.each(["HA/TUP", "HA / TUP", "HA-TUP", "HA,TUP", "HA + TUP"])(
    "rejects combined OCR role %s instead of inventing a position",
    (value) => {
      expect(normalizeImportPosition(value)).toBeNull();
      expect(isValidImportPosition(value)).toBe(false);
    },
  );

  it("rejects unknown or empty values", () => {
    expect(normalizeImportPosition("")).toBeNull();
    expect(normalizeImportPosition(null)).toBeNull();
    expect(normalizeImportPosition("handler")).toBeNull();
    expect(normalizeImportPosition("operator")).toBeNull();
  });

  it("allows surrounding whitespace/case differences for valid roles", () => {
    expect(normalizeImportPosition(" ha ")).toBe("HA");
    expect(normalizeImportPosition("tup")).toBe("TUP");
  });
});
