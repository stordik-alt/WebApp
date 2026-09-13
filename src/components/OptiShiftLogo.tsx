import { cn } from "@/lib/utils";

/** OptiShift brand mark for the application header. */
export function OptiShiftLogo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5 shrink-0", className)} aria-label="OptiShift">
      <svg aria-hidden viewBox="0 0 54 42" className="h-9 w-11 shrink-0">
        <path d="M2 34 10 18h10l-8 16H2Z" fill="hsl(var(--primary))" />
        <path d="m15 34 9-24h10l-9 24H15Z" fill="hsl(198 92% 52%)" />
        <path d="m29 34 10-30h10L39 34H29Z" fill="hsl(166 72% 52%)" />
      </svg>
      {!compact && (
        <div className="flex flex-col leading-none">
          <span className="text-lg font-extrabold tracking-[-0.03em]">
            Opti<span className="text-primary">Shift</span>
          </span>
          <span className="mt-1 text-[9px] font-medium tracking-[0.02em] text-muted-foreground">
            Data. Lidé. Výsledky.
          </span>
        </div>
      )}
    </div>
  );
}
