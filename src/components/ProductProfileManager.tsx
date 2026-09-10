import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProducts } from "@/lib/data";
import { useApprovalFields } from "@/lib/auth";
import type { Product } from "@/lib/products";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type ProductProfile = {
  id: string;
  profile_name?: string | null;
  ha_subassy: string | null;
  h_capacity: number | null;
  h_norm_per_hour: number | null;
  tup_subassy: string | null;
  t_capacity: number | null;
  t_norm_per_hour: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  version_no?: number | null;
  created_at?: string | null;
};

type Draft = {
  name: string;
  haCode: string;
  tupCode: string;
  haNorm: string;
  tupNorm: string;
  haCapacity: string;
  tupCapacity: string;
};

const emptyDraft: Draft = {
  name: "",
  haCode: "",
  tupCode: "",
  haNorm: "",
  tupNorm: "",
  haCapacity: "1",
  tupCapacity: "1",
};

const normalizeCode = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, "");

function productProfileKey(haCode: string, tupCode: string) {
  return `${normalizeCode(haCode)}|${normalizeCode(tupCode)}`;
}

function profileKey(profile: ProductProfile) {
  return productProfileKey(profile.ha_subassy ?? "", profile.tup_subassy ?? "");
}

export function ProductProfileManager() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: products = [] } = useProducts();
  const { data: profiles = [], isLoading, refetch } = useQuery({
    queryKey: ["product_profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_profiles")
        .select("*")
        .order("valid_from", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        h_capacity: row.h_capacity == null ? null : Number(row.h_capacity),
        h_norm_per_hour: row.h_norm_per_hour == null ? null : Number(row.h_norm_per_hour),
        t_capacity: row.t_capacity == null ? null : Number(row.t_capacity),
        t_norm_per_hour: row.t_norm_per_hour == null ? null : Number(row.t_norm_per_hour),
        version_no: row.version_no == null ? null : Number(row.version_no),
      })) as ProductProfile[];
    },
  });

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<ProductProfile | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profiles.length && !expanded) {
      const firstCurrent = profiles.find((p) => !p.valid_to) ?? profiles[0];
      setExpanded(firstCurrent ? `profile:${profileKey(firstCurrent)}` : null);
    }
  }, [profiles, expanded]);

  const productsByCode = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(normalizeCode(p.code), p);
    return map;
  }, [products]);

  const currentProfiles = useMemo(() => {
    const grouped = new Map<string, ProductProfile>();
    for (const profile of profiles) {
      const key = profileKey(profile);
      if (!key || key === "|") continue;
      const existing = grouped.get(key);
      if (!existing || (profile.valid_from ?? "") > (existing.valid_from ?? "")) grouped.set(key, profile);
    }
    return Array.from(grouped.values());
  }, [profiles]);

  const histories = useMemo(() => {
    const map = new Map<string, ProductProfile[]>();
    for (const profile of profiles) {
      const key = profileKey(profile);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(profile);
    }
    for (const rows of map.values()) rows.sort((a, b) => (b.valid_from ?? "").localeCompare(a.valid_from ?? ""));
    return map;
  }, [profiles]);

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
    setExpanded(`profile:${profileKey(profile)}`);
    window.requestAnimationFrame(() => document.getElementById("product-profile-form")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const reset = () => {
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
    if (!/^T_/i.test(tupCode)) throw new Error("TUP Product ID musí začínat T_.");
    if (!Number.isFinite(haNorm) || haNorm <= 0 || !Number.isFinite(tupNorm) || tupNorm <= 0) throw new Error("Zadejte platnou normu pro HA i TUP.");
    if (!Number.isInteger(haCapacity) || haCapacity < 1 || !Number.isInteger(tupCapacity) || tupCapacity < 1) throw new Error("Kapacita musí být celé číslo alespoň 1.");

    setBusy(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const previous = editing ? editing : currentProfiles.find((p) => profileKey(p) === productProfileKey(haCode, tupCode));

      if (previous && (previous.valid_from ?? date) === date) {
        const { error } = await supabase.from("product_profiles").update({
          profile_name: name,
          ha_subassy: haCode,
          h_capacity: haCapacity,
          h_norm_per_hour: haNorm,
          tup_subassy: tupCode,
          t_capacity: tupCapacity,
          t_norm_per_hour: tupNorm,
          ...approval(),
        }).eq("id", previous.id);
        if (error) throw error;
      } else {
        if (previous?.valid_to == null) {
          const previousDay = new Date(`${date}T00:00:00Z`);
          previousDay.setUTCDate(previousDay.getUTCDate() - 1);
          const { error } = await supabase.from("product_profiles").update({ valid_to: previousDay.toISOString().slice(0, 10) }).eq("id", previous.id);
          if (error) throw error;
        }

        const historyCount = histories.get(productProfileKey(haCode, tupCode))?.length ?? 0;
        const { error } = await supabase.from("product_profiles").insert({
          profile_name: name,
          ha_subassy: haCode,
          h_capacity: haCapacity,
          h_norm_per_hour: haNorm,
          tup_subassy: tupCode,
          t_capacity: tupCapacity,
          t_norm_per_hour: tupNorm,
          valid_from: date,
          valid_to: null,
          version_no: historyCount + 1,
          ...approval(),
        });
        if (error) throw error;
      }

      // Product rows remain as the operational entity, but no longer require
      // product_families. The profile owns the H_/T_ pairing and capacities.
      const syncProduct = async (code: string, capacity: number, variant: "H" | "T") => {
        const product = productsByCode.get(normalizeCode(code));
        if (!product) {
          const { error } = await supabase.from("products").insert({
            code,
            name,
            employees_per_product: capacity,
            first_seen_date: date,
            variant_type: variant,
            ...approval(),
          });
          if (error) throw error;
          return;
        }
        const { error } = await supabase.from("products").update({ name, employees_per_product: capacity, variant_type: variant }).eq("id", product.id);
        if (error) throw error;
      };

      await syncProduct(haCode, haCapacity, "H");
      await syncProduct(tupCode, tupCapacity, "T");

      await refetch();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_profiles"] });
      toast.success(editing ? "Product Profile byl upraven a nová verze uložena." : "Product Profile byl uložen.");
      reset();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (profile: ProductProfile) => {
    if (!window.confirm(`Odstranit aktuální Product Profile „${profile.profile_name ?? profile.ha_subassy ?? ""}"? Historii ostatních verzí zachovat?`)) return;
    const { error } = await supabase.from("product_profiles").delete().eq("id", profile.id);
    if (error) { toast.error(error.message); return; }
    await refetch();
    toast.success("Aktuální verze Product Profile byla odstraněna.");
  };

  const resolveProduct = (code: string | null | undefined) => (code ? productsByCode.get(normalizeCode(code)) : undefined);

  return (
    <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Save className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Product Profiles</h2>
          <p className="text-xs text-muted-foreground">Jedno místo pro HA/TUP Product ID, normy, kapacitu a jejich verzování. Product Profile je zdroj pravdy pro párování.</p>
        </div>
      </div>

      <div id="product-profile-form" className="mb-5 rounded-xl border bg-muted/20 p-4">
        <div className="mb-3 text-sm font-semibold">{editing ? "Úprava Product Profile" : "Nový Product Profile"}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-1.5 md:col-span-2 xl:col-span-4"><Label>Název profilu</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Např. Henry Ford 3596" /></div>
          <div className="grid gap-1.5"><Label>HA Product ID</Label><Input value={draft.haCode} onChange={(e) => setDraft((d) => ({ ...d, haCode: e.target.value }))} placeholder="H_..." /></div>
          <div className="grid gap-1.5"><Label>HA norma (ks/h)</Label><Input type="number" step="0.1" value={draft.haNorm} onChange={(e) => setDraft((d) => ({ ...d, haNorm: e.target.value }))} /></div>
          <div className="grid gap-1.5"><Label>HA kapacita</Label><Input type="number" min="1" value={draft.haCapacity} onChange={(e) => setDraft((d) => ({ ...d, haCapacity: e.target.value }))} /></div>
          <div className="grid gap-1.5"><Label>TUP Product ID</Label><Input value={draft.tupCode} onChange={(e) => setDraft((d) => ({ ...d, tupCode: e.target.value }))} placeholder="T_..." /></div>
          <div className="grid gap-1.5"><Label>TUP norma (ks/h)</Label><Input type="number" step="0.1" value={draft.tupNorm} onChange={(e) => setDraft((d) => ({ ...d, tupNorm: e.target.value }))} /></div>
          <div className="grid gap-1.5"><Label>TUP kapacita</Label><Input type="number" min="1" value={draft.tupCapacity} onChange={(e) => setDraft((d) => ({ ...d, tupCapacity: e.target.value }))} /></div>
          <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
            <Button type="button" disabled={busy} onClick={() => void save().catch((e: Error) => toast.error(e.message))}>{editing ? <><Save className="h-4 w-4" /> Uložit novou verzi</> : <><Plus className="h-4 w-4" /> Založit profil</>}</Button>
            {editing ? <Button type="button" variant="outline" onClick={reset}>Zrušit</Button> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        {isLoading && <div className="rounded-lg border p-4 text-sm text-muted-foreground">Načítám Product Profiles…</div>}
        {!isLoading && currentProfiles.map((profile) => {
          const key = profileKey(profile);
          const open = expanded === `profile:${key}`;
          const history = histories.get(key) ?? [];
          const haProduct = resolveProduct(profile.ha_subassy);
          const tupProduct = resolveProduct(profile.tup_subassy);
          return (
            <div key={key} className="overflow-hidden rounded-xl border">
              <div className="flex items-center gap-2">
                <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left hover:bg-muted/30" onClick={() => setExpanded(open ? null : `profile:${key}`)}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{profile.profile_name ?? profile.ha_subassy ?? "Product Profile"}</span><Badge variant="outline">v{profile.version_no ?? history.length}</Badge></div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>HA: {profile.ha_subassy ?? "–"}</span><span>TUP: {profile.tup_subassy ?? "–"}</span>
                      <span>HA norma: {profile.h_norm_per_hour ?? "–"} ks/h</span><span>TUP norma: {profile.t_norm_per_hour ?? "–"} ks/h</span>
                    </div>
                  </div>
                  {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                </button>
                <Button type="button" variant="outline" size="sm" className="mr-3 shrink-0" onClick={() => startEdit(profile)}><Pencil className="mr-1 h-4 w-4" /> Upravit</Button>
              </div>

              {open && (
                <div className="border-t bg-muted/10 p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border bg-background p-4">
                      <div className="mb-3 flex items-center justify-between"><div className="font-semibold">HA verze</div><Badge>HA</Badge></div>
                      <div className="grid gap-3 text-sm">
                        <div><Label>Product ID</Label><Input value={profile.ha_subassy ?? "–"} readOnly /></div>
                        <div><Label>Norma ks/h</Label><Input value={profile.h_norm_per_hour == null ? "–" : String(profile.h_norm_per_hour)} readOnly /></div>
                        <div><Label>Kapacita operátorů</Label><Input value={profile.h_capacity == null ? "–" : String(profile.h_capacity)} readOnly /></div>
                        <div className="text-xs text-muted-foreground">Produkt v evidenci: {haProduct ? "ano" : "ne"}</div>
                      </div>
                    </div>
                    <div className="rounded-lg border bg-background p-4">
                      <div className="mb-3 flex items-center justify-between"><div className="font-semibold">TUP verze</div><Badge variant="secondary">TUP</Badge></div>
                      <div className="grid gap-3 text-sm">
                        <div><Label>Product ID</Label><Input value={profile.tup_subassy ?? "–"} readOnly /></div>
                        <div><Label>Norma ks/h</Label><Input value={profile.t_norm_per_hour == null ? "–" : String(profile.t_norm_per_hour)} readOnly /></div>
                        <div><Label>Kapacita operátorů</Label><Input value={profile.t_capacity == null ? "–" : String(profile.t_capacity)} readOnly /></div>
                        <div className="text-xs text-muted-foreground">Produkt v evidenci: {tupProduct ? "ano" : "ne"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border bg-background">
                    <div className="border-b px-4 py-3 text-sm font-semibold">Historie profilu ({history.length})</div>
                    <div className="divide-y">
                      {history.map((version) => (
                        <div key={version.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                          <Badge variant="outline">v{version.version_no ?? "?"}</Badge>
                          <span className="font-medium">{version.h_norm_per_hour ?? "–"} / {version.t_norm_per_hour ?? "–"} ks/h</span>
                          <span className="text-xs text-muted-foreground">{version.valid_from ?? "bez data"} – {version.valid_to ?? "nyní"}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => startEdit(profile)}><Pencil className="mr-1 h-4 w-4" /> Upravit profil</Button>
                    <Button type="button" variant="ghost" onClick={() => void remove(profile)}><Trash2 className="mr-1 h-4 w-4" /> Odstranit aktuální verzi</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!isLoading && currentProfiles.length === 0 && <div className="rounded-lg border p-4 text-sm text-muted-foreground">Zatím nejsou založené žádné Product Profiles.</div>}
      </div>
    </Card>
  );
}
