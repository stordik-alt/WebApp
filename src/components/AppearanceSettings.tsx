import { useState } from "react";
import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme, type ThemeScheme } from "@/lib/use-theme";

const SCHEMES: Array<{ id: ThemeScheme; name: string; subtitle: string; colors: string[] }> = [
  { id: "original", name: "Původní", subtitle: "Modro-tyrkysová", colors: ["#081220", "#14F195", "#0EA5E9", "#1E293B"] },
  { id: "blue", name: "Modrá", subtitle: "Professional", colors: ["#0A1F44", "#2563EB", "#60A5FA", "#1E3A8A"] },
  { id: "green", name: "Zelená", subtitle: "Nature", colors: ["#052E16", "#22C55E", "#84CC16", "#14532D"] },
  { id: "teal", name: "Teal", subtitle: "Modern", colors: ["#081F2A", "#14B8A6", "#06B6D4", "#164E63"] },
  { id: "orange", name: "Oranžová", subtitle: "Energetic", colors: ["#241B0E", "#F59E0B", "#F97316", "#C2410C"] },
  { id: "red", name: "Červená", subtitle: "Focus", colors: ["#2A0F14", "#EF4444", "#F87171", "#7F1D1D"] },
];

export function AppearanceSettings() {
  const { scheme, setScheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="ghost" className="w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={() => setOpen(true)} aria-label="Nastavení vzhledu">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent/45"><Palette className="h-4 w-4" /></span>
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
