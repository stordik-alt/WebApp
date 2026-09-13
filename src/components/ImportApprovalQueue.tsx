import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, UserPlus, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEmployees } from "@/lib/data";
import { upsertImportedProductProfile } from "@/lib/productProfiles";

const db = supabase as any;

type PendingImport = {
  id: string; batch_id: string; created_at: string; screenshot_path: string | null;
  work_date: string | null; shift: string | null; line: string | null; product_code: string | null; product_name: string | null;
  norm_per_hour: number | null; ocr_confidence: number | null; ocr_data: any; admin_corrections: any; pending_reasons: string[] | null;
  product_id: string | null; product_match_status: string | null; product_profile_status: string | null;
};

type PendingRow = { id: string; import_item_id: string; row_index: number; ocr_employee_name: string | null; employee_id: string | null; position: "HA" | "TUP" | null; oee: number | null; performance: number | null; available_time: number | null; confidence: number | null; match_status: string; validation_status: string; admin_corrections: any };

type ProfileDraft = { profileName: string; haCode: string; haNorm: string; haCapacity: string; tupCode: string; tupNorm: string; tupCapacity: string; validFrom: string };

const reasonLabels: Record<string, string> = {
  MISSING_DATE: "Chybí datum", MISSING_SHIFT: "Chybí směna", MISSING_LINE: "Chybí linka", PRODUCT_NOT_FOUND: "Produkt není v databázi",
  PRODUCT_PROFILE_MISSING: "Chybí Product Profile", PRODUCT_PROFILE_INCOMPLETE: "Product Profile není kompletní", EMPLOYEE_UNMATCHED: "Zaměstnanec není přiřazen",
  POSITION_MISSING: "Chybí HA/TUP", OEE_MISSING: "Chybí OEE", PERFORMANCE_MISSING: "Chybí výkon", AVAILABILITY_MISSING: "Chybí dostupnost",
  HOURLY_DATA_MISSING: "Chybí hodinová data", HOURLY_KPI_MISSING: "Hodinová data nemají platné KPI", DUPLICATE_RECORD: "Denní záznam již existuje",
};

function labelReason(v: string) { return reasonLabels[v] ?? v; }

export function ImportApprovalQueue() {
  const qc = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const [selected, setSelected] = useState<PendingImport | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileDraft>({ profileName: "", haCode: "", haNorm: "", haCapacity: "", tupCode: "", tupNorm: "", tupCapacity: "", validFrom: new Date().toISOString().slice(0, 10) });
  const [editing, setEditing] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["import-approval-queue"],
    queryFn: async () => {
      const { data: items, error } = await db.from("import_items").select("*").eq("status", "PENDING_APPROVAL").order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (items ?? []).map((x: any) => x.id);
      if (!ids.length) return { items: [] as PendingImport[], rows: [] as PendingRow[] };
      const { data: rows, error: rowError } = await db.from("import_item_rows").select("*").in("import_item_id", ids).order("row_index");
      if (rowError) throw rowError;
      return { items: items as PendingImport[], rows: rows as PendingRow[] };
    },
  });

  const items = query.data?.items ?? [];
  const rows = query.data?.rows ?? [];
  const selectedRows = useMemo(() => selected ? rows.filter(r => r.import_item_id === selected.id) : [], [rows, selected]);

  const openPreview = async (item: PendingImport) => {
    setSelected(item);
    if (!item.screenshot_path) return setPreviewUrl(null);
    const { data, error } = await supabase.storage.from("screenshots").createSignedUrl(item.screenshot_path, 600);
    if (error) { toast.error(`Screenshot nelze zobrazit: ${error.message}`); return; }
    setPreviewUrl(data.signedUrl);
  };

  const updateItem = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await db.from("import_items").update({ ...patch, admin_corrections: { ...((selected?.admin_corrections as any) ?? {}), ...patch } }).eq("id", id).eq("status", "PENDING_APPROVAL");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-approval-queue"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const assignEmployee = useMutation({
    mutationFn: async ({ row, employeeId }: { row: PendingRow; employeeId: string }) => {
      const { error } = await db.from("import_item_rows").update({ employee_id: employeeId, match_status: "ASSIGNED_MANUALLY", validation_status: "VALID", admin_corrections: { ...(row.admin_corrections ?? {}), employee_id: employeeId } }).eq("id", row.id);
      if (error) throw error;
      await db.from("import_items").update({ pending_reasons: null }).eq("id", row.import_item_id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["import-approval-queue"] }); toast.success("Zaměstnanec byl přiřazen."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createEmployee = useMutation({
    mutationFn: async ({ row, fullName }: { row: PendingRow; fullName: string }) => {
      const name = fullName.trim();
      if (!name) throw new Error("Jméno zaměstnance nesmí být prázdné.");
      const { data, error } = await db.from("employees").insert({ full_name: name, active: true }).select("id").single();
      if (error) throw error;
      const { error: rowError } = await db.from("import_item_rows").update({ employee_id: data.id, match_status: "CREATED_NEW", validation_status: "VALID", admin_corrections: { ...(row.admin_corrections ?? {}), created_employee_id: data.id } }).eq("id", row.id);
      if (rowError) throw rowError;
    },
    onSuccess: () => { qc.invalidateQueries(); qc.invalidateQueries({ queryKey: ["import-approval-queue"] }); toast.success("Zaměstnanec byl vytvořen a přiřazen."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createProfile = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Není vybrán import.");
      const validFrom = profile.validFrom || selected.work_date || new Date().toISOString().slice(0, 10);
      const ha = profile.haCode.trim() ? { code: profile.haCode.trim(), norm: Number(profile.haNorm), capacity: Number(profile.haCapacity) } : undefined;
      const tup = profile.tupCode.trim() ? { code: profile.tupCode.trim(), norm: Number(profile.tupNorm), capacity: Number(profile.tupCapacity) } : undefined;
      if (!ha || !tup) throw new Error("Product Profile musí obsahovat HA i TUP Product ID.");
      if (!Number.isFinite(ha.norm) || ha.norm <= 0 || !Number.isInteger(ha.capacity) || ha.capacity < 1) throw new Error("HA norma musí být kladná a kapacita celé číslo ≥ 1.");
      if (!Number.isFinite(tup.norm) || tup.norm <= 0 || !Number.isInteger(tup.capacity) || tup.capacity < 1) throw new Error("TUP norma musí být kladná a kapacita celé číslo ≥ 1.");
      await upsertImportedProductProfile({ profileName: profile.profileName || selected.product_name, ha, tup, validFrom });
      const { data: fresh, error } = await db.from("import_items").select("ocr_data").eq("id", selected.id).single();
      if (error) throw error;
      await db.from("import_items").update({ product_profile_status: "VALID", admin_corrections: { ...(selected.admin_corrections ?? {}), product_profile_created: true, product_profile: profile } }).eq("id", selected.id);
      return fresh;
    },
    onSuccess: () => { setProfileOpen(false); qc.invalidateQueries({ queryKey: ["import-approval-queue"] }); toast.success("Product Profile byl vytvořen. Záznam je nyní připraven k další kontrole."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: async (item: PendingImport) => {
      const currentRows = rows.filter(r => r.import_item_id === item.id);
      if (!item.work_date || !item.shift || !item.line || !item.product_id) throw new Error("Před schválením musí být vyplněno datum, směna, linka a produkt.");
      if (item.product_profile_status !== "VALID") throw new Error("Product Profile musí být kompletní a platný.");
      if (!currentRows.length || currentRows.some(r => !r.employee_id || !r.position || r.oee == null || r.performance == null || r.available_time == null)) throw new Error("Všechny řádky zaměstnanců musí být kompletní.");
      const { data: meta, error: metaError } = await db.from("import_items").select("screenshot_path,batch_id,ocr_data").eq("id", item.id).single();
      if (metaError) throw metaError;
      const hourly = (meta.ocr_data?.hourly_metrics ?? []) as any[];
      const performance = hourly.map(x => Number(x.performance_pct)).filter(Number.isFinite);
      const availability = hourly.map(x => Number(x.availability_pct)).filter(Number.isFinite);
      const avg = (v: number[]) => v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
      const oee = Number(meta.ocr_data?.actual_shift_oee_pct);
      const finalOee = Number.isFinite(oee) ? oee : currentRows.reduce((s,r)=>s+Number(r.oee),0)/currentRows.length;
      const finalPerformance = avg(performance) ?? currentRows.reduce((s,r)=>s+Number(r.performance),0)/currentRows.length;
      const finalAvailability = avg(availability) ?? currentRows.reduce((s,r)=>s+Number(r.available_time),0)/currentRows.length;
      for (const row of currentRows) {
        const { data: existing, error } = await db.from("daily_records").select("id").eq("employee_id", row.employee_id).eq("work_date", item.work_date).eq("shift", item.shift).eq("line", item.line).maybeSingle();
        if (error) throw error;
        if (existing) throw new Error(`Pro zaměstnance již existuje denní záznam (${row.ocr_employee_name ?? row.employee_id}).`);
        const { data: record, error: insertError } = await db.from("daily_records").insert({ employee_id: row.employee_id, work_date: item.work_date, shift: item.shift, line: item.line, product_id: item.product_id, product: item.product_code, position: row.position, oee: Number(finalOee.toFixed(2)), performance: Number(finalPerformance.toFixed(2)), available_time: Number(finalAvailability.toFixed(2)), help_score: 0, screenshot_path: meta.screenshot_path, approval_status: "approved", import_batch_id: meta.batch_id }).select("id").single();
        if (insertError) throw insertError;
        await db.from("import_item_rows").update({ daily_record_id: record.id, validation_status: "VALID" }).eq("id", row.id);
      }
      await db.from("import_items").update({ status: "APPROVED", approved_at: new Date().toISOString(), pending_reasons: null, completed_at: new Date().toISOString() }).eq("id", item.id).eq("status", "PENDING_APPROVAL");
      await db.from("import_item_events").insert({ import_item_id: item.id, event_type: "ADMIN_APPROVED", to_status: "APPROVED", payload: { created_by_admin: true } });
    },
    onSuccess: () => { setSelected(null); setPreviewUrl(null); qc.invalidateQueries({ queryKey: ["import-approval-queue"] }); qc.invalidateQueries(); toast.success("Import byl schválen a zařazen do denních dat."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async ({ item, reason }: { item: PendingImport; reason: string }) => {
      if (!reason.trim()) throw new Error("U zamítnutí je nutný důvod.");
      const { error } = await db.from("import_items").update({ status: "REJECTED", rejection_reason: reason.trim(), completed_at: new Date().toISOString() }).eq("id", item.id).eq("status", "PENDING_APPROVAL");
      if (error) throw error;
      await db.from("import_item_events").insert({ import_item_id: item.id, event_type: "ADMIN_REJECTED", to_status: "REJECTED", payload: { reason: reason.trim() } });
    },
    onSuccess: () => { setSelected(null); setPreviewUrl(null); qc.invalidateQueries({ queryKey: ["import-approval-queue"] }); toast.success("Import byl zamítnut."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startProfile = () => {
    if (!selected) return;
    const products = selected.ocr_data?.products ?? [];
    const main = products.find((p: any) => p.product_code === selected.product_code) ?? products[0];
    setProfile({ profileName: selected.product_name ?? selected.product_code ?? "", haCode: main?.product_code ?? selected.product_code ?? "", haNorm: main?.norm_per_hour != null ? String(main.norm_per_hour) : "", haCapacity: "", tupCode: "", tupNorm: "", tupCapacity: "", validFrom: selected.work_date ?? new Date().toISOString().slice(0,10) });
    setProfileOpen(true);
  };

  const blockerList = selected?.pending_reasons ?? [];

  return <div className="grid gap-4">
    <Card className="p-4"><div className="flex items-center justify-between gap-3"><div><div className="font-semibold">Importy čekající na schválení</div><div className="text-sm text-muted-foreground">OCR je pouze návrh. Každá hodnota může být před schválením opravena.</div></div><Badge variant={items.length ? "default" : "outline"}>{items.length} čeká</Badge></div></Card>
    {query.isLoading ? <Card className="p-6 text-sm text-muted-foreground">Načítám importy…</Card> : query.error ? <Card className="p-6 text-sm text-destructive">Nepodařilo se načíst importy: {(query.error as Error).message}</Card> : items.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">Žádný import nečeká na schválení.</Card> : <div className="grid gap-3">{items.map(item => <Card key={item.id} className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge variant="secondary">PENDING</Badge>{item.product_code && <Badge variant="outline">{item.product_code}</Badge>}{item.ocr_confidence != null && <Badge variant="outline">OCR {Math.round(Number(item.ocr_confidence)*100)}%</Badge>}</div><div className="mt-2 font-medium">{item.work_date ?? "Bez data"} · {item.shift ?? "Bez směny"} · {item.line ?? "Bez linky"}</div><div className="text-sm text-muted-foreground">{item.product_name || item.product_code || "Neurčený produkt"} · {rows.filter(r=>r.import_item_id===item.id).length} zaměstnanců</div><div className="mt-2 flex flex-wrap gap-1">{(item.pending_reasons ?? []).map(r => <Badge key={r} variant="destructive" className="text-xs">{labelReason(r)}</Badge>)}</div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void openPreview(item)}>Detail / screenshot</Button><Button variant="destructive" onClick={() => { const reason = window.prompt("Důvod zamítnutí:", ""); if (reason?.trim()) reject.mutate({ item, reason }); }}>Zamítnout</Button></div></div></Card>)}</div>}

    <Dialog open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setPreviewUrl(null); } }}>
      <DialogContent className="max-h-[95vh] max-w-6xl overflow-y-auto">
        {selected && <><DialogHeader><DialogTitle>Kontrola importu · {selected.product_code ?? "bez produktu"}</DialogTitle></DialogHeader>
          <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-4"><Card className="overflow-hidden p-2">{previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer"><img src={previewUrl} alt="Originální screenshot importu" className="max-h-[520px] w-full rounded-lg object-contain" /></a> : <div className="p-8 text-center text-sm text-muted-foreground">Screenshot není dostupný.</div>}<div className="p-2 text-xs text-muted-foreground">Kliknutím otevřete screenshot ve větším zobrazení.</div></Card><Card className="p-4"><div className="font-semibold">Důvody kontroly</div><div className="mt-2 flex flex-wrap gap-2">{blockerList.length ? blockerList.map(x => <Badge key={x} variant="destructive">{labelReason(x)}</Badge>) : <Badge variant="outline">Žádný známý blocker</Badge>}</div></Card></div>
            <div className="space-y-4"><Card className="p-4"><div className="font-semibold">OCR data – upravitelná</div><div className="mt-3 grid gap-3 sm:grid-cols-2">{(["work_date","shift","line","product_code","product_name","norm_per_hour"] as const).map(key => <label key={key} className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">{key}</span><Input defaultValue={String((selected as any)[key] ?? "")} onChange={e => setEditing(p=>({...p,[key]:e.target.value}))} /></label>)}</div><Button className="mt-3" variant="outline" disabled={updateItem.isPending} onClick={() => updateItem.mutate({ id: selected.id, patch: { work_date: editing.work_date ?? selected.work_date, shift: editing.shift ?? selected.shift, line: editing.line ?? selected.line, product_code: editing.product_code ?? selected.product_code, product_name: editing.product_name ?? selected.product_name, norm_per_hour: editing.norm_per_hour === undefined ? selected.norm_per_hour : Number(editing.norm_per_hour) } })}>Uložit opravy</Button></Card>
              <Card className="p-4"><div className="font-semibold">Zaměstnanci</div><div className="mt-3 space-y-3">{selectedRows.map(row => <div key={row.id} className="rounded-xl border p-3"><div className="font-medium">{row.ocr_employee_name ?? "Neznámý zaměstnanec"}</div><div className="mt-2 grid gap-2 sm:grid-cols-2"><select className="h-10 rounded-md border bg-background px-3 text-sm" value={row.employee_id ?? ""} onChange={e => { if (e.target.value) assignEmployee.mutate({ row, employeeId: e.target.value }); }}><option value="">Vyberte stávajícího zaměstnance…</option>{employees.map((e:any)=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select><Button variant="outline" onClick={() => { const name=window.prompt("Jméno nového zaměstnance:", row.ocr_employee_name ?? ""); if (name?.trim()) createEmployee.mutate({ row, fullName:name }); }}><UserPlus className="mr-2 h-4 w-4"/>Vytvořit nového</Button></div><div className="mt-2 text-xs text-muted-foreground">{row.position ?? "bez pozice"} · OEE {row.oee ?? "–"} · výkon {row.performance ?? "–"} · dostupnost {row.available_time ?? "–"} · OCR {row.confidence != null ? `${Math.round(Number(row.confidence)*100)}%` : "–"}</div></div>)}</div></Card>
              <Card className="p-4"><div className="font-semibold">Product Profile</div><div className="mt-1 text-sm text-muted-foreground">Nový profil se vytvoří až po výslovném zásahu správce. Jeho vytvoření samo o sobě neschvaluje výrobní data.</div><Button className="mt-3" variant="outline" onClick={startProfile}><ExternalLink className="mr-2 h-4 w-4"/>Vytvořit / upravit Product Profile</Button></Card>
            </div>
          </div>
          <DialogFooter className="gap-2"><Button variant="destructive" onClick={() => { const reason=window.prompt("Důvod zamítnutí:",""); if(reason?.trim()) reject.mutate({item:selected,reason}); }}><XCircle className="mr-2 h-4 w-4"/>Zamítnout</Button><Button disabled={approve.isPending} onClick={() => approve.mutate(selected)}><CheckCircle2 className="mr-2 h-4 w-4"/>Schválit a zařadit do statistik</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>

    <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Product Profile – kontrola a vytvoření</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2">{([ ["profileName","Název profilu"],["haCode","HA Product ID"],["haNorm","HA norma / h"],["haCapacity","HA kapacita"],["tupCode","TUP Product ID"],["tupNorm","TUP norma / h"],["tupCapacity","TUP kapacita"],["validFrom","Platnost od"]] as [keyof ProfileDraft,string][]).map(([key,label])=><label key={key} className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">{label}</span><Input value={profile[key]} onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))}/></label>)}</div><DialogFooter><Button variant="outline" onClick={()=>setProfileOpen(false)}>Zrušit</Button><Button disabled={createProfile.isPending} onClick={()=>createProfile.mutate()}>Vytvořit Product Profile</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
