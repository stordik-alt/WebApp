import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Category = "controllable" | "uncontrollable";
type DowntimeReason = { id: string; reason_text: string; category: Category; note: string | null; active: boolean };

const CATEGORY_LABEL: Record<Category, string> = { controllable: "Ovlivnitelná", uncontrollable: "Neovlivnitelná" };
const CATEGORY_BADGE: Record<Category, string> = {
  controllable: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  uncontrollable: "border-red-400/40 bg-red-400/10 text-red-300",
};

export function DowntimeReasonManager() {
  const qc = useQueryClient();
  const { isReadOnly } = useAuth();
  const [reasonText, setReasonText] = useState("");
  const [category, setCategory] = useState<Category>("uncontrollable");
  const [note, setNote] = useState("");

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ["downtime_reason_classifications"],
    queryFn: async () => {
      const { data, error } = await supabase.from("downtime_reason_classifications").select("*").order("category").order("reason_text");
      if (error) throw error;
      return (data ?? []) as DowntimeReason[];
    },
  });

  const grouped = useMemo(() => ({
    uncontrollable: reasons.filter((r) => r.category === "uncontrollable"),
    controllable: reasons.filter((r) => r.category === "controllable"),
  }), [reasons]);

  const create = useMutation({
    mutationFn: async () => {
      const text = reasonText.trim();
      if (!text) throw new Error("Zadejte text odstávky.");
      const { error } = await supabase.from("downtime_reason_classifications").insert({ reason_text: text, category, note: note.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      setReasonText("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["downtime_reason_classifications"] });
      toast.success("Odstávka byla přidána do seznamu.");
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "Tato odstávka (nebo velmi podobná) už v seznamu je." : e.message),
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, category: next }: { id: string; category: Category }) => {
      const { error } = await supabase.from("downtime_reason_classifications").update({ category: next }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downtime_reason_classifications"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (r: DowntimeReason) => {
      const { error } = await supabase.from("downtime_reason_classifications").update({ active: !r.active }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downtime_reason_classifications"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("downtime_reason_classifications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["downtime_reason_classifications"] });
      toast.success("Odstávka byla odstraněna.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renderRow = (r: DowntimeReason) => (
    <div key={r.id} className={`flex flex-wrap items-center gap-3 border-b border-border/50 p-3 last:border-0 ${r.active ? "" : "opacity-50"}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{r.reason_text}</div>
        {r.note ? <div className="truncate text-xs text-muted-foreground">{r.note}</div> : null}
      </div>
      <Select value={r.category} onValueChange={(v) => updateCategory.mutate({ id: r.id, category: v as Category })} disabled={isReadOnly}>
        <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="uncontrollable">Neovlivnitelná</SelectItem>
          <SelectItem value="controllable">Ovlivnitelná</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Switch checked={r.active} onCheckedChange={() => toggleActive.mutate(r)} disabled={isReadOnly} />
        <Button type="button" variant="ghost" size="icon" disabled={isReadOnly} onClick={() => { if (window.confirm(`Odstranit „${r.reason_text}" ze seznamu?`)) remove.mutate(r.id); }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Wrench className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Klasifikace odstávek</h2>
          <p className="text-xs text-muted-foreground">Neovlivnitelná odstávka (porucha, změna výroby, nedostatek materiálu…) spouští TEFF výpočet. Ovlivnitelná (WC, pití) se k TEFF času přičítá. Shoda s OCR textem je nepřesná (bez diakritiky, jako podřetězec).</p>
        </div>
      </div>

      {!isReadOnly && (
        <div className="mb-5 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_180px_1fr_auto] sm:items-end">
          <div className="grid gap-1.5"><Label>Text odstávky</Label><Input value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Např. Porucha dopravníku" /></div>
          <div className="grid gap-1.5">
            <Label>Kategorie</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="uncontrollable">Neovlivnitelná</SelectItem>
                <SelectItem value="controllable">Ovlivnitelná</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Poznámka (nepovinné)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Volitelný popis" /></div>
          <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}><Plus className="h-4 w-4" /> Přidat</Button>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">Načítám seznam odstávek…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2"><Badge className={CATEGORY_BADGE.uncontrollable}>{CATEGORY_LABEL.uncontrollable}</Badge><span className="text-xs text-muted-foreground">spouští TEFF</span></div>
            {grouped.uncontrollable.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Zatím žádné položky.</p> : grouped.uncontrollable.map(renderRow)}
          </div>
          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2"><Badge className={CATEGORY_BADGE.controllable}>{CATEGORY_LABEL.controllable}</Badge><span className="text-xs text-muted-foreground">přičítá se k TEFF</span></div>
            {grouped.controllable.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Zatím žádné položky.</p> : grouped.controllable.map(renderRow)}
          </div>
        </div>
      )}
    </Card>
  );
}
