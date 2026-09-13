import { cn } from "@/lib/utils";

/** OptiShift brand mark for the application header and navigation. */
export function OptiShiftLogo({ className, compact = false, size = "default" }: { className?: string; compact?: boolean; size?: "default" | "sidebar" }) {
  const isSidebar = size === "sidebar";

  return (
    <div className={cn("flex items-center gap-2.5 shrink-0", isSidebar && "gap-3.5", className)} aria-label="OptiShift">
      <svg aria-hidden viewBox="0 0 54 42" className={cn("shrink-0", isSidebar ? "h-12 w-16" : "h-9 w-11")}>
        <path d="M2 34 10 18h10l-8 16H2Z" fill="hsl(var(--primary))" />
        <path d="m15 34 9-24h10l-9 24H15Z" fill="hsl(198 92% 52%)" />
        <path d="m29 34 10-30h10L39 34H29Z" fill="hsl(166 72% 52%)" />
      </svg>
      {!compact && (
        <div className="flex flex-col leading-none">
          <span className={cn("font-extrabold tracking-[-0.03em]", isSidebar ? "text-2xl" : "text-lg")}>
            Opti<span className="text-primary">Shift</span>
          </span>
          <span className={cn("font-medium tracking-[0.02em] text-muted-foreground", isSidebar ? "mt-1.5 text-[10px]" : "mt-1 text-[9px]")}>
            Data. Lidé. Výsledky.
          </span>
        </div>
      )}
    </div>
  );
}
