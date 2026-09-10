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
  const percentageStyle = unit === "%" ? percentColor(parsePercent(value)) : undefined;

  return (
    <Card className="gap-0 p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`} style={percentageStyle}>
        {value}
        {unit ? <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
