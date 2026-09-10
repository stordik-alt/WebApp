import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Pencil, Plus, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProducts } from "@/lib/data";
import { useApprovalFields } from "@/lib/auth";
import type { Product } from "@/lib/products";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ProductProfile = {
  id: string;
  profile_name: string | null;
  ha_subassy: string | null;
  h_capacity: number | null;
  h_norm_per_hour: number | null;
  tup_subassy: string | null;
  t_capacity: number | null;
  t_norm_per_hour: number | null;
  valid_from: string;
  valid_to: string | null;
  version_no: number;
  created_at: string | null;
};

type Draft = { name: string; haCode: string; tupCode: string; haNorm: string; tupNorm: string; haCapacity: string; tupCapacity: string };
const emptyDraft: Draft = { name: "", haCode: "", tupCode: "", haNorm: "", tupNorm: "", haCapacity: "1", tupCapacity: "1" };
const normalizeCode = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
const keyOf = (ha: string | null | undefined, tup: string | null | undefined) => `${normalizeCode(ha)}|${normalizeCode(tup)}`;
const keyOfProfile = (profile: ProductProfile) => keyOf(profile.ha_subassy, profile.tup_subassy);

export function ProductProfileManagerV2() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: products = [] } = useProducts();
  const profilesQuery = useQuery({
    queryKey: ["product_profiles"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("product_profiles") as any)
        .select("*")
        .order("valid_from", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row,
        h_capacity: row.h_capacity == null ? null : Number(row.h_capacity),
        h_norm_per_hour: row.h_norm_per_hour == null ? null : Number(row.h_norm_per_hour),
        t_capacity: row.t_capacity == null ? null : Number(row.t_capacity),
        t_norm_per_hour: row.t_norm_per_hour == null ? null : Number(row.t_norm_per_hour),
        version_no: row.version_no == null ? 1 : Number(row.version_no),
      })) as ProductProfile[];
    },
  });
  const { data: profiles = [], isLoading, isError, error } = profilesQuery;

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<ProductProfile | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!expanded && profiles.length) setExpanded(`profile:${keyOfProfile(profiles[0])}`);
  }, [profiles, expanded]);

  const productsByCode = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products) map.set(normalizeCode(product.code), product);
    return map;
  }, [products]);

  const grouped = useMemo(() => {
    const current = new Map<string, ProductProfile>();
    const history = new Map<string, ProductProfile[]>();
    for (const profile of profiles) {
      const key = keyOfProfile(profile);
      const rows = history.get(key) ?? [];
      rows.push(profile);
      history.set(key, rows);
      const existing = current.get(key);
      if (!existing || profile.valid_from > existing.valid_from) current.set(key, profile);
    }
    for (const rows of history.values()) rows.sort((a, b) => b.valid_from.localeCompare(a.valid_from));
    return { current: Array.from(current.values()), history };
  }, [profiles]);

  const openNew = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setDialogOpen(true);
  };

  const startEdit = (profile: ProductProfile) => {
    setEditing(profile);
    setDraft({
      name: profile.profile_name ?? "",
      haCode: profile.ha_subassy ?? "",
      tupCode: profile.tup_subassy ?? "",
      haNorm: profile.h_norm_per_hour == null ? "" : String(profile.h_norm_per_hour),
      tupNorm: profile.t_norm_per_hour == null ? "" : String(profile.t_norm_per_hour),
      haCapacity: profile.h_capacity == null ? "1" : String(profile.h_capacity),
      tupCapacity: profile.t_capacity == null ? "1" : String(profile.t_capacity),
    });
    setExpanded(`profile:${keyOfProfile(profile)}`);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialogOpen(false);
    setEditing(null);
    setDraft(emptyDraft);
  };

  const save = async () => {
    const name = draft.name.trim();
    const haCode = draft.haCode.trim();
    const tupCode = draft.tupCode.trim();
    const haNorm = Number(draft.haNorm);
    const tupNorm = Number(draft.tupNorm);
    const haCapacity = Number(draft.haCapacity);
    const tupCapacity = Number(draft.tupCapacity);
    if (!name) throw new Error("Zadejte název Product Profile.");
    if (!/^H_/i.test(haCode)) throw new Error("HA Product ID musí začínat H_.");
    if (!tupCode) throw new Error("Zadejte TUP Product ID.");
    if (!Number.isFinite(haNorm) || haNorm <= 0 || !Number.isFinite(tupNorm) || tupNorm <= 0) throw new Error("Zadejte platnou normu pro HA i TUP.");
    if (!Number.isInteger(haCapacity) || haCapacity < 1 || !Number.isInteger(tupCapacity) || tupCapacity < 1) throw new Error("Kapacita musí být celé číslo alespoň 1.");

    setBusy(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const targetKey = keyOf(haCode, tupCode);
      const current = grouped.current.find((profile) => keyOfProfile(profile) === targetKey);
      const editableSamePair = editing && keyOfProfile(editing) === targetKey ? editing : current;
      const table = supabase.from("product_profiles") as any;

      const profilePayload = {
        profile_name: name,
        ha_subassy: haCode,
        h_capacity: haCapacity,
        h_norm_per_hour: haNorm,
        tup_subassy: tupCode,
        t_capacity: tupCapacity,
        t_norm_per_hour: tupNorm,
      };

      if (editableSamePair && editableSamePair.valid_from === date) {
        const { error: updateError } = await table.update(profilePayload).eq("id", editableSamePair.id);
        if (updateError) throw updateError;
      } else {
        if (editableSamePair?.valid_to == null) {
          const previousDay = new Date(`${date}T00:00:00Z`);
          previousDay.setUTCDate(previousDay.getUTCDate() - 1);
          const { error: closeError } = await table.update({ valid_to: previousDay.toISOString().slice(0, 10) }).eq("id", editableSamePair.id);
          if (closeError) throw closeError;
        }
        const versionCount = (grouped.history.get(targetKey) ?? []).length;
        const { error: insertError } = await table.insert({ ...profilePayload, valid_from: date, valid_to: null, version_no: versionCount + 1 });
        if (insertError) throw insertError;
      }

      const syncProduct = async (code: string, productCapacity: number, variant: "H" | "T") => {
        const existingProduct = productsByCode.get(normalizeCode(code));
        if (existingProduct) {
          const { error: updateError } = await supabase.from("products").update({ name, employees_per_product: productCapacity, variant_type: variant }).eq("id", existingProduct.id);
          if (updateError) throw updateError;
          return;
        }
        const { error: insertError } = await supabase.from("products").insert({ code, name, employees_per_product: productCapacity, first_seen_date: date, variant_type: variant, ...approval() });
        if (insertError) throw insertError;
      };
      await syncProduct(haCode, haCapacity, "H");
      await syncProduct(tupCode, tupCapacity, "T");

      await profilesQuery.refetch();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_profiles"] });
      toast.success(editing ? "Product Profile byl upraven." : "Product Profile byl založen.");
      reset();
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDialogOpen(false);
    setEditing(null);
    setDraft(emptyDraft);
  };

  return <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Save className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Product Profiles</h2><p className="text-xs text-muted-foreground">Jediný zdroj pro HA/TUP Product ID, normy, kapacitu a historii verzí. Product Families se zde nepoužívají.</p></div></div>
      <Button type="button" onClick={openNew}><Plus className="h-4 w-4" /> Nový Product Profile</Button>
    </div>

    {isError ? <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">Product Profiles se nepodařilo načíst: {(error as Error)?.message ?? "neznámá chyba"}</div> : null}
    <div className="grid gap-2">
      {!isLoading && grouped.current.map((profile) => {
        const key = keyOfProfile(profile);
        const open = expanded === `profile:${key}`;
        const history = grouped.history.get(key) ?? [];
        return <div key={key} className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2">
            <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left hover:bg-muted/30" onClick={() => setExpanded(open ? null : `profile:${key}`)}>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{profile.profile_name ?? profile.ha_subassy ?? "Product Profile"}</span><Badge variant="outline">v{profile.version_no}</Badge></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>HA: {profile.ha_subassy ?? "–"}</span><span>TUP: {profile.tup_subassy ?? "–"}</span><span>HA norma: {profile.h_norm_per_hour ?? "–"} ks/h</span><span>TUP norma: {profile.t_norm_per_hour ?? "–"} ks/h</span><span>HA kap.: {profile.h_capacity ?? "–"}</span><span>TUP kap.: {profile.t_capacity ?? "–"}</span></div></div>
              {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
            </button>
            <Button type="button" variant="outline" size="sm" className="mr-3 shrink-0" onClick={() => startEdit(profile)}><Pencil className="mr-1 h-4 w-4" /> Upravit</Button>
          </div>
          {open && <div className="border-t bg-muted/10 p-4"><div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-background p-4"><div className="mb-3 flex items-center justify-between"><div className="font-semibold">HA verze</div><Badge>HA</Badge></div><div className="grid gap-3"><div><Label>Product ID</Label><Input value={profile.ha_subassy ?? "–"} readOnly /></div><div><Label>Norma ks/h</Label><Input value={profile.h_norm_per_hour == null ? "–" : String(profile.h_norm_per_hour)} readOnly /></div><div><Label>Kapacita operátorů</Label><Input value={profile.h_capacity == null ? "–" : String(profile.h_capacity)} readOnly /></div></div></div>
            <div className="rounded-lg border bg-background p-4"><div className="mb-3 flex items-center justify-between"><div className="font-semibold">TUP verze</div><Badge variant="secondary">TUP</Badge></div><div className="grid gap-3"><div><Label>Product ID</Label><Input value={profile.tup_subassy ?? "–"} readOnly /></div><div><Label>Norma ks/h</Label><Input value={profile.t_norm_per_hour == null ? "–" : String(profile.t_norm_per_hour)} readOnly /></div><div><Label>Kapacita operátorů</Label><Input value={profile.t_capacity == null ? "–" : String(profile.t_capacity)} readOnly /></div></div></div>
          </div><div className="mt-4 rounded-lg border bg-background"><div className="border-b px-4 py-3 text-sm font-semibold">Historie verzí ({history.length})</div><div className="divide-y">{history.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-2 p-3 text-sm"><Badge variant="outline">v{version.version_no}</Badge><span>HA {version.h_norm_per_hour ?? "–"} ks/h · TUP {version.t_norm_per_hour ?? "–"} ks/h</span><span className="text-xs text-muted-foreground">{version.valid_from} – {version.valid_to ?? "nyní"}</span></div>)}</div></div></div>}
        </div>;
      })}
      {!isLoading && !isError && grouped.current.length === 0 ? <div className="rounded-lg border p-4 text-sm text-muted-foreground">Zatím nejsou založené žádné Product Profiles.</div> : null}
    </div>

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1.5rem)] max-w-5xl overflow-y-auto sm:w-[calc(100%-3rem)]">
        <DialogHeader>
          <DialogTitle>{editing ? "Upravit Product Profile" : "Nový Product Profile"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">TUP Product ID nemusí začínat T_. Může mít stejný formát jako HA Product ID, tedy například H_....</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5 md:col-span-2"><Label>Název profilu</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Např. Henry Ford 3596" /></div>
            <div className="grid gap-1.5"><Label>HA Product ID</Label><Input value={draft.haCode} onChange={(e) => setDraft((d) => ({ ...d, haCode: e.target.value }))} placeholder="H_..." /></div>
            <div className="grid gap-1.5"><Label>HA norma (ks/h)</Label><Input type="number" step="0.1" value={draft.haNorm} onChange={(e) => setDraft((d) => ({ ...d, haNorm: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label>HA kapacita</Label><Input type="number" min="1" value={draft.haCapacity} onChange={(e) => setDraft((d) => ({ ...d, haCapacity: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label>TUP Product ID</Label><Input value={draft.tupCode} onChange={(e) => setDraft((d) => ({ ...d, tupCode: e.target.value }))} placeholder="H_... nebo jiný kód" /></div>
            <div className="grid gap-1.5"><Label>TUP norma (ks/h)</Label><Input type="number" step="0.1" value={draft.tupNorm} onChange={(e) => setDraft((d) => ({ ...d, tupNorm: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label>TUP kapacita</Label><Input type="number" min="1" value={draft.tupCapacity} onChange={(e) => setDraft((d) => ({ ...d, tupCapacity: e.target.value }))} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={closeDialog}><X className="h-4 w-4" /> Zrušit</Button>
          <Button type="button" disabled={busy} onClick={() => void save().catch((e: Error) => toast.error(e.message))}>{editing ? <><Save className="h-4 w-4" /> Uložit verzi</> : <><Plus className="h-4 w-4" /> Založit profil</>}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}
