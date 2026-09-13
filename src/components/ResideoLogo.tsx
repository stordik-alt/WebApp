import { cn } from "@/lib/utils";

/**
 * OptiShift brand mark. The component name is kept for compatibility with
 * existing imports while the product identity is being migrated.
 */
export function ResideoLogo({
  className,
  variant = "light",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
  variant?: "light" | "dark";
}) {
  const bars = (
    <span aria-hidden className="flex h-14 items-end gap-1.5">
      <span className="h-7 w-4 -skew-x-[20deg] rounded-[3px] bg-gradient-to-t from-blue-600 to-blue-400 shadow-[0_0_18px_hsl(210_100%_55%_/_0.28)]" />
      <span className="h-10 w-4 -skew-x-[20deg] rounded-[3px] bg-gradient-to-t from-blue-500 to-cyan-400 shadow-[0_0_18px_hsl(190_100%_55%_/_0.24)]" />
      <span className="h-14 w-4 -skew-x-[20deg] rounded-[3px] bg-gradient-to-t from-emerald-500 to-green-400 shadow-[0_0_20px_hsl(155_80%_55%_/_0.28)]" />
    </span>
  );

  if (compact) {
    return <span className={cn("inline-flex", className)}>{bars}</span>;
  }

  return (
    <span className={cn("flex items-center gap-4", className)}>
      {bars}
      <span className="flex flex-col">
        <span className="text-[2rem] font-bold leading-none tracking-[-0.055em] text-foreground sm:text-[2.25rem]">
          Opti<span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">Shift</span>
        </span>
        <span className={cn(
          "mt-2 text-xs font-medium tracking-[0.12em] sm:text-sm",
          variant === "light" ? "text-sidebar-foreground/65" : "text-muted-foreground",
        )}>
          Data. Lidé. Výsledky.
        </span>
      </span>
    </span>
  );
}

export const OptiShiftLogo = ResideoLogo;
