import { cn } from "@/lib/utils";

/**
 * Firemní značka Resideo – výrazný symbol R s vnitřním stínováním,
 * navržený pro tmavé navy prostředí i světlý režim.
 */
export function ResideoLogo({
  className,
  variant = "light",
  compact = false,
}: {
  className?: string;
  /** Pouze značka bez textu – pro úzké mobilní hlavičky. */
  compact?: boolean;
  /** `light` = tmavé pozadí (sidebar), `dark` = světlé pozadí (mobilní hlavička). */
  variant?: "light" | "dark";
}) {
  const symbol = (
    <span
      aria-hidden
      className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-primary/70 bg-[linear-gradient(145deg,hsl(var(--primary)/0.2),hsl(var(--sidebar-background)/0.96)_52%,hsl(var(--primary)/0.08))] shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_10px_28px_-8px_hsl(var(--primary)/0.75),inset_0_1px_0_hsl(0_0%_100%_/_0.08),inset_0_-10px_18px_hsl(0_0%_0%_/_0.24)]"
    >
      <span className="absolute inset-[5px] rounded-[14px] bg-[radial-gradient(circle_at_35%_25%,hsl(var(--primary)/0.22),transparent_42%),linear-gradient(160deg,hsl(var(--primary)/0.12),transparent_65%)] shadow-[inset_0_2px_7px_hsl(0_0%_0%_/_0.28)]" />
      <span className="relative z-10 text-[29px] font-black leading-none tracking-[-0.06em] text-primary drop-shadow-[0_2px_5px_hsl(var(--primary)/0.45)]">
        R
      </span>
    </span>
  );

  return (
    <span className={cn("flex items-center gap-3", className)}>
      {symbol}
      {compact ? null : (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "text-[15px] font-semibold tracking-tight",
              variant === "light" ? "text-sidebar-foreground" : "text-foreground",
            )}
          >
            Resideo
          </span>
          <span
            className={cn(
              "mt-1 text-[10px] font-medium tracking-tight",
              variant === "light" ? "text-sidebar-foreground/60" : "text-muted-foreground",
            )}
          >
            Monitoring výkonu
          </span>
        </span>
      )}
    </span>
  );
}
