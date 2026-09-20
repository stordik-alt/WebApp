export type ParsedImport = { code: string; line_name: string; workplace_name: string; area: "HA" | "TUP"; source_line: string };

/**
 * Rozloží raw text `daily_records.line` (např. "041.06 - HandAssy L3/1 el.WI")
 * na kód pracoviště + název linky. Toto je jediný zdroj pravdy pro mapování
 * volného textu na kód 041.xx/050.xx (viz `workplaces`); nevytváří se druhá
 * paralelní implementace.
 */
export function parseImportedLine(value: string): ParsedImport | null {
  const source_line = value.trim();
  const match = source_line.match(/^(\d{3}\.\d{2})\s*-\s*(.+)$/i);
  if (!match) return null;
  const code = match[1] ?? "";
  const remainder = (match[2] ?? "").trim();
  const prefix = code.slice(0, 3);
  if (prefix !== "041" && prefix !== "050") return null;
  const area: "HA" | "TUP" = prefix === "050" ? "TUP" : "HA";
  // The line token (e.g. "L3/1", optionally with an underscore sub-station
  // suffix like "L1/1_1", or "Olovo") can appear ANYWHERE in the remainder -
  // real workplace strings like "HandAssy L3/1 el.WI" or "HandAssy L1/1_1 -
  // OPF" have extra descriptive text after it.
  const lineMatch = remainder.match(/(L\d+\s*\/\s*\d+(?:_\d+)?(?:\s+HF)?|Olovo)/i);
  const lineToken = lineMatch?.[1] ?? "";
  const line_name = lineMatch ? (/^olovo$/i.test(lineToken) ? "Olovo" : lineToken.replace(/\s*\/\s*/g, "/").replace(/\s+HF$/i, " HF").toUpperCase()) : "Neurčeno";
  const before = lineMatch ? remainder.slice(0, lineMatch.index).replace(/-\s*$/, "").trim() : remainder;
  const after = lineMatch ? remainder.slice((lineMatch.index ?? 0) + lineMatch[0].length).replace(/^-\s*/, "").trim() : "";
  const workplace_name = [before, after].filter(Boolean).join(" ").trim() || remainder;
  if (!workplace_name) return null;
  return { code, line_name, workplace_name, area, source_line };
}
