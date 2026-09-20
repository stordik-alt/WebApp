import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./interaktivni.css";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("iw-panel", className)}>{children}</div>;
}

export function PanelHeader({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="iw-panel-header">
      {icon ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/60 text-cyan-700 dark:text-[hsl(190_70%_65%)]">{icon}</span> : null}
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-wide text-white">{title}</h2>
        {subtitle ? <p className="iw-label mt-0.5 truncate">{subtitle}</p> : null}
      </div>
    </div>
  );
}
