import type { CSSProperties } from "react";

export function percentColor(value: number | null | undefined): CSSProperties | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;

  // Jednotné hodnocení všech procent v aplikaci:
  // >= 96 % zelená, 80–95,9 % žlutá, < 80 % červená.
  const color =
    value >= 96
      ? "hsl(var(--success))"
      : value >= 80
        ? "hsl(var(--warning))"
        : "hsl(var(--destructive))";

  return {
    color,
    textShadow: `0 0 8px color-mix(in srgb, ${color} 18%, transparent)`,
  };
}

export function parsePercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(/%$/, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
