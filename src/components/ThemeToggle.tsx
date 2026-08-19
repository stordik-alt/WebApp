import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ className }: { className?: string }) {
  const { isDark, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className={`w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${className ?? ""}`}
      aria-label={isDark ? "Přepnout do světlého režimu" : "Přepnout do tmavého režimu"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {isDark ? "Světlý režim" : "Tmavý režim"}
    </Button>
  );
}
