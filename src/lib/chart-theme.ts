/** Shared Recharts tooltip styling using design tokens (WCAG-safe in both themes). */
export const tooltipStyle = {
  contentStyle: {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--popover-foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--popover-foreground)" },
  cursor: { fill: "var(--muted)", stroke: "var(--border)" },
} as const;
