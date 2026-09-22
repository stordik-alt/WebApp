export type ImportPosition = "HA" | "TUP" | null;

/**
 * Canonicalizes an OCR/manual employee position.
 *
 * The import pipeline has exactly two valid positions. Values such as
 * "HA/TUP", "HA / TUP" or "HA-TUP" are ambiguous and must never be stored
 * as a position. When OCR is ambiguous, return null so validation sends the
 * row to approval instead of silently assigning the wrong role.
 */
export function normalizeImportPosition(value: unknown): ImportPosition {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (normalized === "HA") return "HA";
  if (normalized === "TUP") return "TUP";

  // Explicitly reject combined/ambiguous role labels.
  if (
    normalized.includes("HA") &&
    normalized.includes("TUP")
  ) {
    return null;
  }

  return null;
}

export function isValidImportPosition(value: unknown): value is "HA" | "TUP" {
  return normalizeImportPosition(value) !== null;
}
