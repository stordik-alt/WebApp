import { useState } from "react";
import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme, type ThemeScheme } from "@/lib/use-theme";

// Swatch hex values are computed from each scheme's own dark-mode HSL
// tokens in appearance-themes.css (background/primary/chart-2/secondary),
// not picked independently - keeps this preview accurate to what's
// actually applied instead of drifting from the real design tokens.
const SCHEMES: Array<{ id: ThemeScheme; name: string; subtitle: string; colors: string[] }> = [
  { id: "original", name: "Původní", subtitle: "Mintovo-tyrkysová", colors: ["#0c1322", "#28e29d", "#14b2f5", "#232b3e"] },
  { id: "blue", name: "Modrošedé", subtitle: "Moderní", colors: ["#091020", "#447aee", "#5fabf7", "#1e273e"] },
  { id: "warm-neutral", name: "Teplé neutrální", subtitle: "Elegantní", colors: ["#171412", "#af8a6a", "#599dc0", "#332e28"] },
  { id: "orange", name: "Krémovo-oranžové", subtitle: "Přívětivé", colors: ["#17120d", "#f9891f", "#f5743d", "#372b20"] },
  { id: "green", name: "Mintové", subtitle: "Svěží", colors: ["#0a1a12", "#26d985", "#96da2f", "#1f372b"] },
  { id: "lavender", name: "Levandulové", subtitle: "Jemné", colors: ["#160f1f", "#a57cde", "#d685d6", "#2e243d"] },
  { id: "sand", name: "Pískové", subtitle: "Přirozené", colors: ["#191510", "#c1a367", "#cf7659", "#352f27"] },
  { id: "teal", name: "Světle zelenošedé", subtitle: "Profesionální", colors: ["#101815", "#54b68d", "#55b1c3", "#27342f"] },
  { id: "red", name: "Růžově šedé", subtitle: "Moderní, jemné", colors: ["#1a0f12", "#cf6e86", "#d08d6c", "#35272a"] },
];

export function AppearanceSettings() {
  const { scheme, setScheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="ghost" className="h-10 w-full justify-start gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={() => setOpen(true)} aria-label="Nastavení vzhledu">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sidebar-accent/45"><Palette className="h-4 w-4" /></span>
        <span>Nastavení vzhledu</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border-border bg-card p-5 text-card-foreground shadow-2xl sm:p-6">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-xl"><Palette className="h-5 w-5 text-primary" />Nastavení vzhledu</DialogTitle>
            <DialogDescription>Vyberte barevné schéma aplikace. Každé schéma má vlastní tmavou i světlou variantu.</DialogDescription>
          </DialogHeader>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {SCHEMES.map((item) => {
              const active = scheme === item.id;
              return (
                <button key={item.id} type="button" onClick={() => setScheme(item.id)} className={`group relative overflow-hidden rounded-2xl border p-3 text-left transition-all ${active ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "border-border bg-background/60 hover:border-primary/50 hover:bg-accent/60"}`} aria-pressed={active}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div><div className="font-semibold">{item.name}</div><div className="text-xs text-muted-foreground">{item.subtitle}</div></div>
                    {active ? <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-4 w-4" /></span> : null}
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card p-2.5 shadow-sm">
                    <div className="mb-2 flex gap-1.5">{item.colors.map((color) => <span key={color} className="h-5 flex-1 rounded-md border border-black/10" style={{ backgroundColor: color }} />)}</div>
                    <div className="grid grid-cols-2 gap-1.5"><span className="h-8 rounded-md" style={{ backgroundColor: item.colors[0] }} /><span className="h-8 rounded-md" style={{ backgroundColor: item.colors[1] }} /></div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
