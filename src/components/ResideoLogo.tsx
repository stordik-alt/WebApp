import { cn } from "@/lib/utils";

/**
 * Firemní značka Resideo – vektorová wordmark verze (bez rastrových assetů),
 * takže zůstává ostrá na všech rozlišeních a respektuje barvy design systému.
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
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[20px] font-bold text-sidebar-primary-foreground",
          compact
            ? "h-16 w-16 text-[30px] ring-1 ring-sidebar-primary/35 shadow-[0_0_30px_-8px_hsl(var(--sidebar-primary)),inset_0_0_22px_hsl(var(--sidebar-primary)/0.12)]"
            : "h-10 w-10 rounded-xl text-lg shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.8)]",
        )}
        style={{ backgroundImage: "var(--gradient-brand)" }}
      >
        R
      </span>
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
              "mt-1 text-[10px] uppercase tracking-[0.18em]",
              variant === "light" ? "text-sidebar-foreground/55" : "text-muted-foreground",
            )}
          >
            Výkonnost operátorů
          </span>
        </span>
      )}
    </span>
  );
}
