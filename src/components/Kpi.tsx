import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { parsePercent, percentColor } from "@/lib/percent-color";

export function KpiCard({
  label,
  value,
  unit,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
  icon?: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-foreground";
  const isPercentage = unit === "%";
  const percentageStyle = isPercentage ? percentColor(parsePercent(value)) : undefined;
  // The global .text-foreground rule is intentionally !important, so do not
  // apply that class to percentage KPIs; the inline semantic percentage color
  // must be allowed to control the rendered value.
  const valueClass = isPercentage ? "" : toneClass;

  return (
    <Card className="gap-0 p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${valueClass}`} style={percentageStyle}>
        {value}
        {unit ? <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
