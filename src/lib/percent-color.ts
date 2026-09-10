export function percentColor(value: number | null | undefined): React.CSSProperties | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const normalized = Math.max(0, Math.min(100, value));
  const hue = normalized * 1.2;
  const saturation = 82;
  const lightness = 64;
  return {
    color: `hsl(${hue} ${saturation}% ${lightness}%)`,
    textShadow: `0 0 14px hsl(${hue} ${saturation}% ${lightness}% / 0.22)`,
  };
}

export function parsePercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(/%$/, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
