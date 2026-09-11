import type { CSSProperties } from "react";

export function percentColor(value: number | null | undefined): CSSProperties | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const normalized = Math.max(0, Math.min(100, value));
  const hue = normalized * 1.2;
  const lightSaturation = 68;
  const lightLightness = 34;
  const darkSaturation = 82;
  const darkLightness = 64;
  return {
    color: `light-dark(hsl(${hue} ${lightSaturation}% ${lightLightness}%), hsl(${hue} ${darkSaturation}% ${darkLightness}%))`,
    textShadow: `0 0 14px light-dark(transparent, hsl(${hue} ${darkSaturation}% ${darkLightness}% / 0.22))`,
  };
}

export function parsePercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(/%$/, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
