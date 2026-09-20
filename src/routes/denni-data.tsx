import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useShiftAggregates } from "@/lib/data";
import { isDuplicateLine, type ShiftAggregate } from "@/lib/shifts";
import { type DailyRecord, SHIFTS, fmt, localDateKey } from "@/lib/metrics";
import { saveDraft, loadDraft, clearDraft } from "@/lib/form-draft";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Eye, FilePlus2, Pencil, Save, Search, ShieldAlert, Trash2, UploadCloud, X } from "lucide-react";
import { ScreenshotImport } from "@/components/ScreenshotImport";
import { useApprovalFields, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/denni-data")({
  head: () => ({
    meta: [
      { title: "Denní data – Výkonnost operátorů" },
      { name: "description", content: "Rychlé zadávání denních záznamů: import screenshotů, ruční zadání a přehled výkonu pracovníků." },
    ],
  }),
  component: DailyPage,
});

const today = () => localDateKey();
const formatDate = (value: string) => {
  if (!value) return "–";
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}.${m}.${y}` : value;
};

function metricTone(value: number | null | undefined) {
  if (value == null) return "text-muted-foreground";
  if (value >= 96) return "text-success";
  if (value >= 80) return "text-warning";
  return "text-destructive";
}

type HourlyDetail = {
  id: string;
  hour: number;
  product_code: string | null;
  actual_output: number | null;
  performance_pct: number | null;
  availability_pct: number | null;
  norm_per_hour: number | null;
  capacity: number | null;
  operator_count: number | null;
  actual_oee_pct: number | null;
  productive_minutes: number | null;
  expected_output: number | null;
  reconstruction_status: string | null;
  calculation_mode: string | null;
  availability_measured: number | null;
  availability_applied_to_oee: number | null;
  ha_tup_linkage: { ha_product_code?: string | null; ha_cumulative_available?: number | null; allocation_fraction?: number | null; capped?: boolean | null } | null;
  stat_status: string;
};

// Master Prompt body 4-5 (anomální hodiny / statistická izolace): a hodinový
// záznam se ze statistik vylučuje pouze na úrovni té konkrétní hodiny, nikdy
// automaticky celý den/zaměstnanec/produkt - viz set_hourly_stat_status().
const STAT_STATUS_LABEL: Record<string, string> = {
  INCLUDED: "Zahrnuto",
  ANOMALY_PENDING_REVIEW: "Anomálie – čeká na kontrolu",
  MANUALLY_INCLUDED: "Ručně zahrnuto",
  MANUALLY_EXCLUDED: "Ručně vyřazeno",
};
function statStatusIsExcluded(status: string): boolean {
  return status === "ANOMALY_PENDING_REVIEW" || status === "MANUALLY_EXCLUDED";
}

// Master Prompt Problem 11's required hourly-audit field "stav hodiny vůči
// výrobě" (this hour's status relative to production) - read straight from
// reconstruct_import_item_hourly()'s own calculation_mode, never re-derived.
function hourProductionStatusLabel(mode: string | null): string {
  switch (mode) {
    case "EMPTY": return "Prázdná hodina";
    case "LAST_HOUR_SCREENSHOT_TIME": return "Poslední hodina (čas screenshotu)";
    case "TEFF": return "Začátek/konec výroby (TEFF)";
    case "CLASSIC": return "Pokračující výroba";
    default: return "–";
  }
}

function DailyPage() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { isAdmin } = useAuth();
  const { data: employees = [] } = useEmployees();
  const { records, links, evaluations, shifts: shiftAggregates } = useShiftAggregates();

  const [workDate, setWorkDate] = useState(today());
  const [shift, setShift] = useState<string>(SHIFTS[0]);
  const [line, setLine] = useState("");
  const [product, setProduct] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [position, setPosition] = useState<"HA" | "TUP">("HA");
  const [oee, setOee] = useState("");
  const [help, setHelp] = useState("0");
  const [note, setNote] = useState("");
  const [coworkers, setCoworkers] = useState<string[]>([]);
  const [editingRecord, setEditingRecord] = useState<DailyRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<DailyRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailHourly, setDetailHourly] = useState<HourlyDetail[]>([]);
  const [detailImageUrl, setDetailImageUrl] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // A background tab discarded and reloaded by the browser (common on
  // mobile, also happens on desktop under memory pressure) would otherwise
  // silently lose an in-progress manual entry - restore it on mount, and
  // keep it saved while the dialog is open. Scoped to NEW entries only
  // (editingRecord is null); editing an existing record already loads its
  // real current values from the database, and restoring a stale draft
  // over that would be more confusing than helpful.
  const MANUAL_DRAFT_KEY = "denni-data-manual-new";
  type ManualDraft = { workDate: string; shift: string; line: string; product: string; employeeId: string; position: "HA" | "TUP"; oee: string; help: string; note: string; coworkers: string[] };
  useEffect(() => {
    const draft = loadDraft<ManualDraft>(MANUAL_DRAFT_KEY);
    if (!draft) return;
    if (!(draft.line || draft.product || draft.employeeId || draft.note || draft.oee)) return;
    setWorkDate(draft.workDate); setShift(draft.shift); setLine(draft.line); setProduct(draft.product); setEmployeeId(draft.employeeId); setPosition(draft.position); setOee(draft.oee); setHelp(draft.help); setNote(draft.note); setCoworkers(draft.coworkers);
    setManualOpen(true);
    toast.info("Obnoven rozepsaný záznam, který se neuložil (např. po obnovení stránky na pozadí).");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (editingRecord || !manualOpen) return;
    const hasContent = Boolean(line || product || employeeId || note || (oee && oee !== ""));
    if (hasContent) saveDraft<ManualDraft>(MANUAL_DRAFT_KEY, { workDate, shift, line, product, employeeId, position, oee, help, note, coworkers });
    else clearDraft(MANUAL_DRAFT_KEY);
  }, [workDate, shift, line, product, employeeId, position, oee, help, note, coworkers, editingRecord, manualOpen]);
  const [dailyFilterText, setDailyFilterText] = useState("");
  const [dailyFilterShift, setDailyFilterShift] = useState("all");
  const [dailyFilterDate, setDailyFilterDate] = useState("");
  const [dailySort, setDailySort] = useState<"date" | "employee" | "oee" | "performance" | "availableTime">("date");
  const [dailySortDir, setDailySortDir] = useState<"asc" | "desc">("desc");

  const activeEmployees = employees.filter((e) => e.active);

  const sameShiftEmployees = useMemo(() => {
    const ids = new Set(
      records.filter((r) => r.work_date === workDate && r.shift === shift && r.line.trim().toLowerCase() === line.trim().toLowerCase() && r.employee_id !== employeeId).map((r) => r.employee_id),
    );
    return employees.filter((e) => ids.has(e.id));
  }, [records, workDate, shift, line, employeeId, employees]);

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "?";
  const myShift: ShiftAggregate | undefined = shiftAggregates.find((a) => a.employee_id === employeeId && a.work_date === workDate && a.shift === shift);

  useEffect(() => {
    setHelp(myShift?.help !== null && myShift?.help !== undefined ? String(myShift.help) : "0");
  }, [employeeId, workDate, shift]);

  const duplicateLine = !!employeeId && !!line.trim() && isDuplicateLine(records, employeeId, workDate, shift, line);

  const openDetail = async (record: DailyRecord) => {
    setDetailRecord(record);
    setDetailOpen(true);
    setDetailHourly([]);
    setDetailImageUrl(null);
    setDetailLoading(true);
    try {
      const typed = record as DailyRecord & { screenshot_path?: string | null };
      if (typed.screenshot_path) {
        const { data: signed, error: signedError } = await supabase.storage.from("screenshots").createSignedUrl(typed.screenshot_path, 600);
        if (!signedError) setDetailImageUrl(signed.signedUrl);
      }
      if (typed.screenshot_path) {
        const { data: item } = await supabase.from("import_items").select("id").eq("screenshot_path", typed.screenshot_path).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (item?.id) {
          const { data: hourly } = await supabase.from("import_item_hourly").select("id,hour,product_code,actual_output,performance_pct,availability_pct,norm_per_hour,capacity,operator_count,actual_oee_pct,raw_data,stat_status").eq("import_item_id", item.id).order("hour", { ascending: true });
          const mapped = (hourly ?? []).map((row: any) => {
            const raw = row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};
            const calculation = raw.calculation && typeof raw.calculation === "object" ? raw.calculation : {};
            // Same field the backend's compute_import_item_product_kpis()
            // weights its averages by - this table's own weighted cross-check
            // below must use the identical minutes value the canonical KPI
            // actually used, or the two can silently disagree.
            const productiveMinutes = Number(calculation.reconstructed_productive_minutes ?? calculation.productive_minutes);
            const expectedOutput = Number(calculation.expected_output_at_current_staffing);
            return {
              id: String(row.id), stat_status: String(row.stat_status ?? "INCLUDED"),
              hour: Number(row.hour), product_code: row.product_code ?? raw.product_code ?? null,
              actual_output: row.actual_output ?? raw.actual_output ?? null,
              performance_pct: row.performance_pct ?? raw.performance_pct ?? null,
              availability_pct: row.availability_pct ?? raw.availability_pct ?? null,
              norm_per_hour: row.norm_per_hour ?? raw.norm_per_hour ?? null,
              capacity: row.capacity ?? raw.capacity ?? null,
              operator_count: row.operator_count ?? raw.operator_count ?? null,
              actual_oee_pct: row.actual_oee_pct ?? raw.actual_oee_pct ?? null,
              productive_minutes: Number.isFinite(productiveMinutes) ? productiveMinutes : null,
              expected_output: Number.isFinite(expectedOutput) ? expectedOutput : null,
              reconstruction_status: typeof calculation.reconstruction_status === "string" ? calculation.reconstruction_status : null,
              calculation_mode: typeof calculation.calculation_mode === "string" ? calculation.calculation_mode : null,
              availability_measured: Number.isFinite(Number(calculation.availability_measured)) ? Number(calculation.availability_measured) : null,
              availability_applied_to_oee: Number.isFinite(Number(calculation.availability_applied_to_oee)) ? Number(calculation.availability_applied_to_oee) : null,
              ha_tup_linkage: calculation.ha_tup_linkage && typeof calculation.ha_tup_linkage === "object" ? calculation.ha_tup_linkage : null,
            } as HourlyDetail;
          });
          const isNight = (record.shift ?? "").toLowerCase().startsWith("no");
          const normalizeNight = (hour: number) => hour >= 22 ? hour - 22 : hour + 2;
          mapped.sort((a, b) => isNight ? normalizeNight(a.hour) - normalizeNight(b.hour) : a.hour - b.hour);
          setDetailHourly(mapped);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Detail záznamu se nepodařilo načíst.");
    } finally {
      setDetailLoading(false);
    }
  };

  // Bod 5 (statistická izolace): hodina se stavem ANOMALY_PENDING_REVIEW nebo
  // MANUALLY_EXCLUDED nesmí ovlivnit žádný agregát, včetně tohoto zde
  // zobrazovaného průměru - aby se nerozcházel s tím, co skutečně obsahuje
  // daily_records.oee po refresh_daily_records_for_import_item().
  const detailWeights = useMemo(() => detailHourly.map((row) => statStatusIsExcluded(row.stat_status) ? 0 : row.productive_minutes ?? 0), [detailHourly]);

  const detailCalc = useMemo(() => {
    if (!detailHourly.length) return { oee: null, performance: null, availability: null, usedWeight: 0 };
    let oeeTotal = 0, perfTotal = 0, perfWeight = 0, availTotal = 0, availWeight = 0, usedWeight = 0;
    detailHourly.forEach((row, i) => {
      const weight = detailWeights[i] ?? 0;
      if (weight <= 0) return;
      if (typeof row.actual_oee_pct === "number" && Number.isFinite(row.actual_oee_pct)) { oeeTotal += row.actual_oee_pct * weight; usedWeight += weight; }
      if (typeof row.performance_pct === "number" && Number.isFinite(row.performance_pct)) { perfTotal += row.performance_pct * weight; perfWeight += weight; }
      if (typeof row.availability_pct === "number" && Number.isFinite(row.availability_pct)) { availTotal += row.availability_pct * weight; availWeight += weight; }
    });
    return { oee: usedWeight ? oeeTotal / usedWeight : detailRecord?.oee ?? null, performance: perfWeight ? perfTotal / perfWeight : detailRecord?.performance ?? null, availability: availWeight ? availTotal / availWeight : detailRecord?.available_time ?? null, usedWeight };
  }, [detailHourly, detailWeights, detailRecord]);

  const create = useMutation({
    mutationFn: async (_mode: "single" | "another" = "single") => {
      const { data, error } = await supabase.from("daily_records").insert({ work_date: workDate, shift, line: line.trim(), product: product.trim() || null, employee_id: employeeId, position, oee: oee === "" ? null : Number(oee), help_score: 0, note: note.trim() || null, ...approval() }).select("id").single();
      if (error) throw error;
      const { error: he } = await supabase.from("shift_evaluations").upsert({ employee_id: employeeId, work_date: workDate, shift, help_score: Number(help || 0), ...approval() }, { onConflict: "employee_id,work_date,shift" });
      if (he) throw he;
      const valid = coworkers.filter((c) => sameShiftEmployees.some((e) => e.id === c));
      if (valid.length) {
        const { error: e2 } = await supabase.from("daily_record_coworkers").insert(valid.map((c) => ({ record_id: data.id, coworker_id: c })));
        if (e2) throw e2;
      }
    },
    onSuccess: (_d, mode) => {
      qc.invalidateQueries({ queryKey: ["daily"] }); qc.invalidateQueries({ queryKey: ["coworkers"] }); qc.invalidateQueries({ queryKey: ["shift_evaluations"] });
      setOee(""); setHelp("0"); setNote(""); setCoworkers([]); setEmployeeId(""); if (mode === "single") setProduct(""); setManualOpen(false);
      clearDraft(MANUAL_DRAFT_KEY);
      toast.success(mode === "another" ? "Uloženo – zadejte další" : "Záznam uložen");
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "Tento pracovník už má záznam na této lince v dané směně." : e.message),
  });

  const update = useMutation({
    mutationFn: async (recordId: string) => {
      if (!recordId) throw new Error("Chybí ID záznamu");
      const { error } = await supabase.from("daily_records").update({ work_date: workDate, shift, line: line.trim(), product: product.trim() || null, employee_id: employeeId, position, oee: oee === "" ? null : Number(oee), help_score: 0, note: note.trim() || null, ...approval() }).eq("id", recordId).select("id").single();
      if (error) throw error;
      // Výpomoc lives in shift_evaluations (one row per employee/date/shift,
      // not per daily_records line) - create already upserted it here, but
      // update never did, so editing an existing record's Výpomoc silently
      // had no effect.
      const { error: he } = await supabase.from("shift_evaluations").upsert({ employee_id: employeeId, work_date: workDate, shift, help_score: Number(help || 0), ...approval() }, { onConflict: "employee_id,work_date,shift" });
      if (he) throw he;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily"] }); qc.invalidateQueries({ queryKey: ["coworkers"] }); qc.invalidateQueries({ queryKey: ["shift_evaluations"] });
      setEditingRecord(null); setManualOpen(false); setOee(""); setHelp("0"); setNote(""); setCoworkers([]); setEmployeeId(""); setProduct(""); toast.success("Záznam upraven");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("daily_records").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["daily"] }); toast.success("Záznam smazán"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Bod 3.5/3.6: ruční zahrnutí/vyřazení hodiny ze statistik - nikdy nemaže
  // ani nemění výrobní data, jen mění stat_status a ukládá auditní stopu
  // (set_hourly_stat_status je jediné místo, které tuhle změnu smí provést -
  // viz Master Prompt bod 3.5). Po úspěchu se přenačte detail i denní/týdenní
  // agregace, protože daily_records.oee se mohlo změnit.
  const [statDialog, setStatDialog] = useState<{ row: HourlyDetail; newStatus: "MANUALLY_INCLUDED" | "MANUALLY_EXCLUDED" } | null>(null);
  const [statReason, setStatReason] = useState("");
  const [statNote, setStatNote] = useState("");
  const setHourlyStat = useMutation({
    mutationFn: async ({ hourlyId, newStatus, reason, note }: { hourlyId: string; newStatus: "MANUALLY_INCLUDED" | "MANUALLY_EXCLUDED"; reason: string; note: string }) => {
      const { data, error } = await (supabase as any).rpc("set_hourly_stat_status", { p_hourly_id: hourlyId, p_new_status: newStatus, p_reason: reason.trim() || null, p_note: note.trim() || null });
      if (error) throw error;
      return data as { status: string };
    },
    onSuccess: (_d, { hourlyId, newStatus }) => {
      setDetailHourly((prev) => prev.map((row) => row.id === hourlyId ? { ...row, stat_status: newStatus } : row));
      qc.invalidateQueries({ queryKey: ["daily"] });
      setStatDialog(null); setStatReason(""); setStatNote("");
      toast.success(newStatus === "MANUALLY_EXCLUDED" ? "Hodina byla vyřazena ze statistik." : "Hodina byla zahrnuta do statistik.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave = workDate && shift && line.trim() && employeeId;
  const canSaveOrUpdate = canSave && (!duplicateLine || !!editingRecord);

  const filteredShifts = useMemo(() => {
    const text = dailyFilterText.trim().toLowerCase();
    const filtered = shiftAggregates.filter((a) => {
      if (dailyFilterShift !== "all" && a.shift !== dailyFilterShift) return false;
      if (dailyFilterDate && a.work_date !== dailyFilterDate) return false;
      if (text && !empName(a.employee_id).toLowerCase().includes(text) && !a.lines.join(" ").toLowerCase().includes(text)) return false;
      return true;
    });
    const value = (a: ShiftAggregate) => dailySort === "date" ? `${a.work_date} ${a.shift}` : dailySort === "employee" ? empName(a.employee_id).toLowerCase() : Number(dailySort === "oee" ? a.oee ?? -Infinity : dailySort === "performance" ? a.performance ?? -Infinity : a.availableTime ?? -Infinity);
    filtered.sort((a, b) => { const av = value(a); const bv = value(b); const cmp = av < bv ? -1 : av > bv ? 1 : 0; return dailySortDir === "asc" ? cmp : -cmp; });
    return filtered.slice(0, 100);
  }, [shiftAggregates, dailyFilterText, dailyFilterShift, dailyFilterDate, dailySort, dailySortDir, employees]);

  const summary = useMemo(() => {
    const pool = dailyFilterDate ? shiftAggregates.filter((s) => s.work_date === dailyFilterDate) : shiftAggregates;
    const avg = (values: Array<number | null | undefined>) => { const usable = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)); return usable.length ? usable.reduce((sum, v) => sum + v, 0) / usable.length : null; };
    return { records: pool.reduce((sum, s) => sum + s.records.length, 0), oee: avg(pool.map((s) => s.oee)), performance: avg(pool.map((s) => s.performance)), availability: avg(pool.map((s) => s.availableTime)) };
  }, [shiftAggregates, dailyFilterDate]);

  const loadForEdit = (record: DailyRecord) => {
    // record.help_score (daily_records) is not the real Výpomoc value - it's
    // always 0 there. The actual current value lives in shift_evaluations,
    // one row per employee/date/shift.
    const currentEval = evaluations.find((ev) => ev.employee_id === record.employee_id && ev.work_date === record.work_date && ev.shift === record.shift);
    setEditingRecord(record); setWorkDate(record.work_date); setShift(record.shift); setLine(record.line); setProduct(record.product ?? ""); setEmployeeId(record.employee_id); setPosition(record.position); setOee(record.oee?.toString() ?? ""); setHelp((currentEval?.help_score ?? 0).toString()); setNote(record.note ?? ""); setManualOpen(true);
  };
  const openNewManual = () => { setEditingRecord(null); setWorkDate(today()); setShift(SHIFTS[0]); setLine(""); setProduct(""); setEmployeeId(""); setPosition("HA"); setOee(""); setHelp("0"); setNote(""); setCoworkers([]); setManualOpen(true); };
  const cancelEdit = () => { setEditingRecord(null); setManualOpen(false); clearDraft(MANUAL_DRAFT_KEY); };

  const exportCsv = () => {
    const header = ["Datum", "Směna", "Zaměstnanec", "Linky", "OEE", "Výkon", "Dostupnost", "Výpomoc"].join(";");
    const lines = filteredShifts.map((a) => [a.work_date, a.shift, empName(a.employee_id), a.lines.join(", "), a.oee ?? "", a.performance ?? "", a.availableTime ?? "", a.help ?? ""].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(";"));
    const blob = new Blob(["\uFEFF" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `denni-data-${dailyFilterDate || "vse"}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Denní data" subtitle="Záznam se vytváří pouze když byl pracovník v práci – absence průměr OEE neovlivní.">
      <div className="space-y-5">
        <section className="grid gap-4 xl:grid-cols-2">
          <Card className="relative overflow-hidden border-rose-400/30 bg-card p-0"><div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rose-400 to-transparent" /><div className="p-5 sm:p-6"><div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-rose-400/30 bg-rose-400/10 text-rose-700 dark:text-rose-300"><UploadCloud className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700 dark:text-rose-300">Import dat</p><h2 className="text-lg font-semibold">Screenshoty výroby</h2></div></div><div className="rounded-2xl border border-dashed border-border bg-muted/20 p-2"><ScreenshotImport employees={employees} /></div></div></Card>
          <Card className="relative overflow-hidden border-fuchsia-400/25 bg-card p-0"><div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400 to-transparent" /><div className="flex h-full flex-col justify-between p-5 sm:p-6"><div><div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-700 dark:text-fuchsia-300"><FilePlus2 className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700 dark:text-fuchsia-300">Ruční zápis</p><h2 className="text-lg font-semibold">Zadat denní záznam ručně</h2></div></div><p className="max-w-xl text-sm leading-6 text-muted-foreground">Otevře se dialog s kompletním formulářem pro jeden denní záznam. Tabulka zůstává čistá a přehledná.</p></div><Button onClick={openNewManual} className="mt-6 w-full"><FilePlus2 className="mr-2 h-4 w-4" /> Zadat denní záznam ručně</Button></div></Card>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[{ label: `Záznamy${dailyFilterDate ? ` (${formatDate(dailyFilterDate)})` : ""}`, value: summary.records.toLocaleString("cs-CZ"), detail: "záznamů celkem", tone: "text-foreground" },{ label: "Průměrné OEE", value: summary.oee == null ? "–" : `${fmt(summary.oee)} %`, detail: "ze směnových hodnocení", tone: metricTone(summary.oee) },{ label: "Průměrný výkon", value: summary.performance == null ? "–" : `${fmt(summary.performance)} %`, detail: "bez horního limitu", tone: metricTone(summary.performance) },{ label: "Průměrná dostupnost", value: summary.availability == null ? "–" : `${fmt(summary.availability)} %`, detail: "z vybraných záznamů", tone: metricTone(summary.availability) }].map((item) => <Card key={item.label} className="border-border/70 bg-card/70 px-4 py-4"><p className="text-sm text-muted-foreground">{item.label}</p><div className={`mt-2 text-2xl font-semibold tabular-nums ${item.tone}`}>{item.value}</div><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></Card>)}</section>

        <section className="overflow-hidden rounded-2xl border border-border/80 bg-card/60"><div className="border-b border-border/70 p-4 sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700 dark:text-rose-300">Production monitoring</p><h2 className="mt-1 text-lg font-semibold">Směnová hodnocení</h2><p className="text-xs text-muted-foreground">Pracovník může mít ve směně více linek.</p></div><div className="flex flex-wrap items-center gap-2"><div className="relative min-w-[220px] flex-1 xl:flex-none"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={dailyFilterText} onChange={(e) => setDailyFilterText(e.target.value)} className="pl-9" placeholder="Hledat zaměstnance nebo linku…" /></div><Input type="date" value={dailyFilterDate} onChange={(e) => setDailyFilterDate(e.target.value)} className="w-auto" aria-label="Filtrovat datum" /><Select value={dailyFilterShift} onValueChange={setDailyFilterShift}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Všechny směny" /></SelectTrigger><SelectContent><SelectItem value="all">Všechny směny</SelectItem>{SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={exportCsv} className="border-rose-400/40 text-rose-700 dark:text-rose-300 hover:bg-rose-400/10"><Download className="mr-2 h-4 w-4" /> Exportovat</Button></div></div><div className="mt-4 flex flex-wrap gap-2"><Select value={dailySort} onValueChange={(v) => setDailySort(v as typeof dailySort)}><SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="date">Řazení: datum</SelectItem><SelectItem value="employee">Řazení: zaměstnanec</SelectItem><SelectItem value="oee">Řazení: OEE</SelectItem><SelectItem value="performance">Řazení: výkon</SelectItem><SelectItem value="availableTime">Řazení: dostupnost</SelectItem></SelectContent></Select><Button variant="ghost" size="sm" onClick={() => setDailySortDir((v) => v === "asc" ? "desc" : "asc")}>{dailySortDir === "asc" ? "Vzestupně ↑" : "Sestupně ↓"}</Button>{dailyFilterDate ? <Button variant="ghost" size="sm" onClick={() => setDailyFilterDate("")}><X className="mr-1 h-3.5 w-3.5" /> Zrušit datum</Button> : null}</div></div>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/70 text-muted-foreground"><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide">{['Datum', 'Směna', 'Zaměstnanec', 'Linky', 'Ø OEE', 'Ø Výkon', 'Ø Dostupnost', 'Výpomoc', 'Tým', 'Akce'].map((head, i) => <th key={head} className={`px-4 py-3 font-medium ${i >= 4 && i <= 7 ? 'text-right' : ''} ${i === 9 ? 'text-right' : ''}`}>{head}</th>)}</tr></thead><tbody>{filteredShifts.length === 0 ? <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">Zatím žádné záznamy pro zvolené filtry.</td></tr> : filteredShifts.flatMap((a) => [<tr key={`${a.key}-summary`} className="border-b border-border/60 bg-muted/25 hover:bg-muted/45"><td className="px-4 py-3 font-medium">{formatDate(a.work_date)}</td><td className="px-4 py-3">{a.shift}</td><td className="px-4 py-3 font-medium">{empName(a.employee_id)}</td><td className="px-4 py-3"><Badge variant="secondary" className="border-cyan-400/20 bg-cyan-400/10 text-foreground">{a.lineCount} {a.lineCount === 1 ? 'linka' : a.lineCount < 5 ? 'linky' : 'linek'}</Badge></td><td className={`px-4 py-3 text-right font-semibold tabular-nums ${metricTone(a.oee)}`}>{fmt(a.oee)} %</td><td className={`px-4 py-3 text-right tabular-nums ${metricTone(a.performance)}`}>{fmt(a.performance)} %</td><td className={`px-4 py-3 text-right tabular-nums ${metricTone(a.availableTime)}`}>{fmt(a.availableTime)} %</td><td className="px-4 py-3 text-right tabular-nums text-amber-800 dark:text-amber-200">{fmt(a.help, 0)}</td><td className="max-w-[180px] truncate px-4 py-3 text-xs text-muted-foreground">{a.coworkerIds.map(empName).join(', ') || '–'}</td><td className="px-4 py-3 text-right"><Button size="icon" variant="ghost" title="Rozbalit / akce" onClick={() => document.getElementById(`detail-${a.key}`)?.scrollIntoView({ block: 'nearest' })}><span className="text-muted-foreground">⌄</span></Button></td></tr>,<tr key={`${a.key}-details`} id={`detail-${a.key}`} className="border-b border-border/40 bg-slate-950/20"><td colSpan={10} className="px-4 pb-4 pt-0"><div className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">{a.records.map((r) => <div key={r.id} className="grid items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 md:grid-cols-[1.4fr_1fr_80px_90px_90px_auto]"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">↳ {r.line}</p><p className="truncate text-xs text-muted-foreground">{r.product ?? 'Produkt neuveden'}</p></div><div className="flex items-center gap-2 text-xs"><Badge variant="outline" className={r.position === 'HA' ? 'border-cyan-400/40 text-cyan-700 dark:text-cyan-300' : 'border-fuchsia-400/40 text-fuchsia-700 dark:text-fuchsia-300'}>{r.position}</Badge>{r.source === 'screenshot' ? <Badge variant="outline" className="text-[10px]">import</Badge> : null}</div><div className={`text-right text-xs font-semibold tabular-nums ${metricTone(r.oee)}`}>{fmt(r.oee)} %</div><div className={`text-right text-xs tabular-nums ${metricTone(r.performance)}`}>{fmt(r.performance)} %</div><div className={`text-right text-xs tabular-nums ${metricTone(r.available_time)}`}>{fmt(r.available_time)} %</div><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Detail" onClick={() => openDetail(r)}><Eye className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" title="Upravit" onClick={() => loadForEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" title="Smazat" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}><Trash2 className="h-3.5 w-3.5" /></Button></div></div>)}</div></td></tr>])}</tbody></table></div>
          <div className="space-y-3 p-3 md:hidden">{filteredShifts.length === 0 ? <div className="rounded-xl border border-border/60 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">Zatím žádné záznamy pro zvolené filtry.</div> : filteredShifts.map((a) => <Card key={a.key} className="overflow-hidden border-border/70 bg-muted/25 p-0 shadow-none"><div className="border-b border-border/60 px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{formatDate(a.work_date)} · {a.shift}</p><h3 className="mt-1 truncate text-base font-semibold text-foreground">{empName(a.employee_id)}</h3></div><Badge variant="secondary" className="shrink-0 border-cyan-400/20 bg-cyan-400/10 text-foreground">{a.lineCount} {a.lineCount === 1 ? "linka" : a.lineCount < 5 ? "linky" : "linek"}</Badge></div>{a.coworkerIds.length ? <p className="mt-2 truncate text-xs text-muted-foreground">Výpomoc: {a.coworkerIds.map(empName).join(", ")}</p> : null}</div><div className="grid grid-cols-2 gap-px border-b border-border/60 bg-border/50">{[{ label: "Ø OEE", value: `${fmt(a.oee)} %`, tone: metricTone(a.oee) }, { label: "Ø Výkon", value: `${fmt(a.performance)} %`, tone: metricTone(a.performance) }, { label: "Ø Dostupnost", value: `${fmt(a.availableTime)} %`, tone: metricTone(a.availableTime) }, { label: "Výpomoc", value: fmt(a.help, 0), tone: "text-amber-800 dark:text-amber-200" }].map((metric) => <div key={metric.label} className="bg-background/55 px-3 py-2.5"><p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{metric.label}</p><p className={`mt-0.5 text-sm font-semibold tabular-nums ${metric.tone}`}>{metric.value}</p></div>)}</div><div className="space-y-2 p-3">{a.records.map((r) => <div key={r.id} className="rounded-xl border border-border/60 bg-background/55 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold">↳ {r.line}</p><p className="truncate text-xs text-muted-foreground">{r.product ?? "Produkt neuveden"}</p></div><div className="flex shrink-0 items-center gap-1"><Badge variant="outline" className={r.position === "HA" ? "border-cyan-400/40 text-cyan-700 dark:text-cyan-300" : "border-fuchsia-400/40 text-fuchsia-700 dark:text-fuchsia-300"}>{r.position}</Badge>{r.source === "screenshot" ? <Badge variant="outline" className="text-[9px]">import</Badge> : null}</div></div><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/50 pt-2.5"><div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">OEE</p><p className={`text-sm font-semibold tabular-nums ${metricTone(r.oee)}`}>{fmt(r.oee)} %</p></div><div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Výkon</p><p className={`text-sm font-semibold tabular-nums ${metricTone(r.performance)}`}>{fmt(r.performance)} %</p></div><div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Dostupnost</p><p className={`text-sm font-semibold tabular-nums ${metricTone(r.available_time)}`}>{fmt(r.available_time)} %</p></div><div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Pozice</p><p className="text-sm text-foreground">{r.position}</p></div></div><div className="mt-3 flex justify-end gap-1 border-t border-border/50 pt-2"><Button size="sm" variant="ghost" onClick={() => openDetail(r)}><Eye className="mr-1.5 h-3.5 w-3.5" /> Detail</Button><Button size="sm" variant="ghost" onClick={() => loadForEdit(r)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Upravit</Button><Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Smazat</Button></div></div>)}</div></Card>)}</div><div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Zobrazeno {filteredShifts.reduce((sum, a) => sum + a.records.length, 0)} záznamů ve {filteredShifts.length} směnových hodnoceních.</span><span className="text-muted-foreground/70">OEE a výkon mohou být nad 100 %.</span></div>
        </section>
      </div>

      <Dialog open={detailOpen} onOpenChange={(open) => { setDetailOpen(open); if (!open) { setDetailRecord(null); setDetailHourly([]); setDetailImageUrl(null); } }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-border/70 bg-background/95 sm:max-w-5xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-cyan-700 dark:text-cyan-300" /> Detail denního záznamu</DialogTitle></DialogHeader>
          {detailRecord ? <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Card className="bg-muted/35 p-3"><p className="text-xs text-muted-foreground">Zaměstnanec</p><p className="mt-1 font-semibold">{empName(detailRecord.employee_id)}</p></Card><Card className="bg-muted/35 p-3"><p className="text-xs text-muted-foreground">Datum / směna</p><p className="mt-1 font-semibold">{formatDate(detailRecord.work_date)} · {detailRecord.shift}</p></Card><Card className="bg-muted/35 p-3"><p className="text-xs text-muted-foreground">Linka / produkt</p><p className="mt-1 font-semibold">{detailRecord.line} · {detailRecord.product ?? "–"}</p></Card><Card className="bg-muted/35 p-3"><p className="text-xs text-muted-foreground">Pozice</p><p className="mt-1 font-semibold">{detailRecord.position}</p></Card></div>
            <div className="grid gap-3 sm:grid-cols-3"><Card className={`bg-muted/35 p-4 ${metricTone(detailCalc.oee)}`}><p className="text-xs text-muted-foreground">Skutečné OEE</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmt(detailCalc.oee)} %</p><p className="mt-1 text-xs text-muted-foreground">vážený výpočet z produktivních minut</p></Card><Card className={`bg-muted/35 p-4 ${metricTone(detailCalc.performance)}`}><p className="text-xs text-muted-foreground">Výkon</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmt(detailCalc.performance)} %</p><p className="mt-1 text-xs text-muted-foreground">vážený průměr produktivních minut</p></Card><Card className={`bg-muted/35 p-4 ${metricTone(detailCalc.availability)}`}><p className="text-xs text-muted-foreground">Dostupnost</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmt(detailCalc.availability)} %</p><p className="mt-1 text-xs text-muted-foreground">vážený průměr produktivních minut</p></Card></div>
            {detailImageUrl ? <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20"><img src={detailImageUrl} alt={`Screenshot ${detailRecord.product ?? "výroby"}`} className="max-h-[420px] w-full object-contain" /></div> : <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">Screenshot k tomuto záznamu není k dispozici.</div>}
            {detailHourly.some((row) => statStatusIsExcluded(row.stat_status)) ? <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200"><ShieldAlert className="h-4 w-4 shrink-0" /><span>⚠ {detailHourly.filter((row) => statStatusIsExcluded(row.stat_status)).length} {detailHourly.filter((row) => statStatusIsExcluded(row.stat_status)).length === 1 ? "hodinová anomálie vyřazena" : "hodinových anomálií vyřazeno"} ze statistik – vidíte je v tabulce níže označené a nezapočítávají se do čísel nahoře.</span></div> : null}
            <div className="rounded-xl border border-border/70 bg-muted/25 p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Podrobný výpočet skutečného OEE</h3><p className="text-xs text-muted-foreground">OEE = Výkon × Dostupnost × (kapacita Product Profile / skutečný počet operátorů)</p></div><Badge variant="outline">{detailHourly.length} hodin</Badge></div>{detailLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Načítám hodinová data…</p> : detailHourly.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-xs"><thead><tr className="border-b border-border/70 text-left text-muted-foreground"><th className="px-2 py-2">Hodina</th><th className="px-2 py-2">Stav vůči výrobě</th><th className="px-2 py-2 text-right">Skutečný výstup</th><th className="px-2 py-2 text-right">Očekáváno/h</th><th className="px-2 py-2 text-right">Norma/h</th><th className="px-2 py-2 text-right">Kapacita PP</th><th className="px-2 py-2 text-right">Operátoři</th><th className="px-2 py-2 text-right">Výkon</th><th className="px-2 py-2 text-right">Dostupnost</th><th className="px-2 py-2 text-right">Skutečné OEE</th><th className="px-2 py-2 text-right">Produktivní min.</th><th className="px-2 py-2">Stat. stav</th><th className="px-2 py-2">Akce</th></tr></thead><tbody>{detailHourly.map((row) => <Fragment key={row.hour}>
              <tr className={`border-b border-border/40 ${statStatusIsExcluded(row.stat_status) ? "opacity-60" : ""}`}><td className="px-2 py-2 font-medium">{row.hour}:00</td><td className="px-2 py-2"><Badge variant="outline" className="text-[10px]">{hourProductionStatusLabel(row.calculation_mode)}</Badge></td><td className="px-2 py-2 text-right">{row.actual_output == null ? "–" : fmt(row.actual_output, 2)}</td><td className="px-2 py-2 text-right">{row.expected_output == null ? "–" : fmt(row.expected_output, 2)}</td><td className="px-2 py-2 text-right">{row.norm_per_hour == null ? "–" : fmt(row.norm_per_hour, 2)}</td><td className="px-2 py-2 text-right">{row.capacity == null ? "–" : fmt(row.capacity, 2)}</td><td className="px-2 py-2 text-right">{row.operator_count == null ? "–" : fmt(row.operator_count, 0)}</td><td className={`px-2 py-2 text-right font-semibold ${metricTone(row.performance_pct)}`}>{fmt(row.performance_pct)} %</td><td className={`px-2 py-2 text-right font-semibold ${metricTone(row.availability_pct)}`}>{fmt(row.availability_pct)} %</td><td className={`px-2 py-2 text-right font-semibold ${metricTone(row.actual_oee_pct)}`}>{fmt(row.actual_oee_pct)} %</td><td className="px-2 py-2 text-right">{row.productive_minutes == null ? "–" : fmt(row.productive_minutes, 0)}</td><td className="px-2 py-2"><Badge variant="outline" className={`text-[10px] ${row.stat_status === "ANOMALY_PENDING_REVIEW" ? "border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300" : row.stat_status === "MANUALLY_EXCLUDED" ? "border-rose-400/50 bg-rose-400/10 text-rose-700 dark:text-rose-300" : row.stat_status === "MANUALLY_INCLUDED" ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-700 dark:text-cyan-300" : ""}`}>{STAT_STATUS_LABEL[row.stat_status] ?? row.stat_status}</Badge></td><td className="px-2 py-2">{isAdmin ? <div className="flex flex-wrap gap-1">{row.stat_status !== "MANUALLY_EXCLUDED" ? <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setStatDialog({ row, newStatus: "MANUALLY_EXCLUDED" }); setStatReason(row.stat_status === "ANOMALY_PENDING_REVIEW" ? "Nelze spolehlivě určit efektivní čas výroby." : ""); setStatNote(""); }}>Vyřadit</Button> : null}{row.stat_status !== "INCLUDED" && row.stat_status !== "MANUALLY_INCLUDED" ? <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setStatDialog({ row, newStatus: "MANUALLY_INCLUDED" }); setStatReason(""); setStatNote(""); }}>Zahrnout</Button> : null}</div> : null}</td></tr>
              {(row.reconstruction_status || row.ha_tup_linkage || (row.availability_measured != null && row.availability_applied_to_oee != null && row.availability_measured !== row.availability_applied_to_oee)) ? <tr className="border-b border-border/40 bg-amber-500/5"><td colSpan={13} className="px-2 py-1 text-[11px] text-amber-800 dark:text-amber-800/80 dark:text-amber-200/80">
                {row.reconstruction_status ? <span className="mr-3">Mezivýpočet: {row.reconstruction_status}</span> : null}
                {row.availability_measured != null && row.availability_applied_to_oee != null && row.availability_measured !== row.availability_applied_to_oee ? <span className="mr-3">Dostupnost {fmt(row.availability_measured)} % naměřená a auditovaná, ale nepočítá se do OEE (OEE = Výkon)</span> : null}
                {row.ha_tup_linkage ? <span>HA→TUP vazba: {row.ha_tup_linkage.ha_product_code ?? "?"} · dostupné HA {row.ha_tup_linkage.ha_cumulative_available ?? "–"} ks{row.ha_tup_linkage.allocation_fraction != null && row.ha_tup_linkage.allocation_fraction !== 1 ? ` · alokace ${Math.round(Number(row.ha_tup_linkage.allocation_fraction) * 100)} %` : ""}{row.ha_tup_linkage.capped ? " · limitováno" : ""}</span> : null}
              </td></tr> : null}
            </Fragment>)}</tbody></table></div> : <p className="py-6 text-center text-sm text-muted-foreground">K tomuto záznamu nejsou dostupná hodinová data. Zobrazuji uložené hodnoty denního záznamu.</p>}</div>
            {detailHourly.length ? <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm"><p className="font-semibold">Výpočet směny</p><p className="mt-1 text-muted-foreground">Skutečné KPI = vážený průměr hodin podle skutečně produktivních minut. Směna má 438 produktivních minut; započítává se 7 min příprava, 5 min úklid a skutečná 30min přestávka. U screenshotu se poslední hodina ořízne podle času screenshotu.</p><p className="mt-2 text-muted-foreground">Celkový použitý součet produktivních minut: <strong>{fmt(detailCalc.usedWeight, 0)}</strong> min.</p></div> : null}
          </div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setDetailOpen(false)}>Zavřít</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statDialog} onOpenChange={(open) => { if (!open) { setStatDialog(null); setStatReason(""); setStatNote(""); } }}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-1rem)] overflow-y-auto sm:w-[calc(100%-3rem)] sm:max-w-lg">
          <DialogHeader><DialogTitle>{statDialog?.newStatus === "MANUALLY_EXCLUDED" ? "Vyřadit hodinu ze statistik" : "Zahrnout hodinu do statistik"}</DialogTitle></DialogHeader>
          {statDialog ? <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Hodina {statDialog.row.hour}:00 · {statDialog.row.product_code ?? "bez produktu"}. Vyřazení nemaže ani nemění výrobní data, mění pouze statistický stav - záznam zůstává viditelný v detailu a auditu.</p>
            <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Důvod</span><Input value={statReason} onChange={(e) => setStatReason(e.target.value)} placeholder="Nelze spolehlivě určit efektivní čas výroby." /></label>
            <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Poznámka (nepovinné)</span><Input value={statNote} onChange={(e) => setStatNote(e.target.value)} /></label>
          </div> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatDialog(null)}>Zrušit</Button>
            <Button disabled={!statDialog || !statReason.trim() || setHourlyStat.isPending} onClick={() => statDialog && setHourlyStat.mutate({ hourlyId: statDialog.row.id, newStatus: statDialog.newStatus, reason: statReason, note: statNote })}>{statDialog?.newStatus === "MANUALLY_EXCLUDED" ? "Vyřadit" : "Zahrnout"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={(open) => { setManualOpen(open); if (!open) setEditingRecord(null); }}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-1rem)] overflow-y-auto border-border/70 bg-background/95 sm:w-[calc(100%-3rem)] sm:max-w-3xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><FilePlus2 className="h-5 w-5 text-fuchsia-700 dark:text-fuchsia-300" />{editingRecord ? "Upravit denní záznam" : "Zadat denní záznam ručně"}</DialogTitle></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-4 rounded-xl border border-border/60 bg-muted/30 p-4 sm:grid-cols-2"><div className="grid gap-1.5"><Label>Datum</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div><div className="grid gap-1.5"><Label>Směna</Label><Select value={shift} onValueChange={setShift}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1.5"><Label>Linka</Label><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="např. L1" /></div><div className="grid gap-1.5"><Label>Výrobek</Label><Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product ID / popis" /></div><div className="grid gap-1.5 sm:col-span-2"><Label>Zaměstnanec</Label><Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger><SelectValue placeholder="Vyberte zaměstnance" /></SelectTrigger><SelectContent>{activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1.5"><Label>Pozice</Label><Select value={position} onValueChange={(v) => setPosition(v as "HA" | "TUP")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></div><div className="grid gap-1.5"><Label>OEE (%) – nepovinné</Label><Input type="number" inputMode="decimal" step="0.1" min="0" value={oee} onChange={(e) => setOee(e.target.value)} placeholder="bez horního limitu" /></div><div className="grid gap-2 sm:col-span-2"><Label>Výpomoc ({help})</Label><Input type="range" min={-100} max={100} step={5} value={help} onChange={(e) => setHelp(e.target.value)} className="cursor-pointer p-0" /><div className="flex justify-between text-[11px] text-muted-foreground"><span>-100</span><span>0 (výchozí)</span><span>+100</span></div></div><div className="grid gap-1.5 sm:col-span-2"><Label>Spolupracovníci (stejná směna a linka)</Label>{sameShiftEmployees.length === 0 ? <p className="text-xs text-muted-foreground">Na této směně a lince zatím nejsou evidováni jiní pracovníci.</p> : <div className="grid gap-1.5 rounded-md border border-border p-2">{sameShiftEmployees.map((e) => <label key={e.id} className="flex items-center gap-2 text-sm"><Checkbox checked={coworkers.includes(e.id)} onCheckedChange={(v) => setCoworkers((prev) => v === true ? [...prev, e.id] : prev.filter((x) => x !== e.id))} />{e.full_name}</label>)}</div>}</div><div className="grid gap-1.5 sm:col-span-2"><Label>Poznámka</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Volitelná poznámka" /></div></div>{myShift ? <div className={`rounded-lg border px-3 py-2 text-xs ${duplicateLine ? 'border-destructive bg-destructive/10 text-destructive' : 'border-amber-400/30 bg-amber-400/5 text-amber-800 dark:text-amber-200'}`}>{duplicateLine ? <>Na lince <strong>{line.trim()}</strong> už tento pracovník v této směně záznam má – duplicita.</> : <>Pracovník už má v této směně {myShift.lineCount}× linku ({myShift.lines.join(', ')}). Nový záznam se přidá jako další linka.</>}</div> : null}</div><DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={cancelEdit}>Zrušit</Button><Button variant="secondary" onClick={() => editingRecord ? update.mutate(editingRecord.id) : create.mutate("another")} disabled={!canSaveOrUpdate || create.isPending || update.isPending}><PlusIcon /> Uložit a přidat další</Button><Button onClick={() => editingRecord ? update.mutate(editingRecord.id) : create.mutate("single")} disabled={!canSaveOrUpdate || create.isPending || update.isPending} className="bg-rose-500 text-slate-950 hover:bg-rose-400"><Save className="mr-2 h-4 w-4" /> {editingRecord ? "Uložit změny" : "Uložit záznam"}</Button></DialogFooter></DialogContent>
      </Dialog>
    </AppShell>
  );
}

function PlusIcon() { return <span className="mr-2 inline-flex text-base leading-none">＋</span>; }
