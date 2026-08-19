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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-sidebar-primary-foreground shadow-[0_6px_16px_-8px_oklch(0.58_0.21_27_/_0.9)]"
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
