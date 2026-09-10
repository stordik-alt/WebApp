import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useShiftAggregates } from "@/lib/data";
import { isDuplicateLine, type ShiftAggregate } from "@/lib/shifts";
import { type DailyRecord, SHIFTS, fmt } from "@/lib/metrics";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  FilePlus2,
  Pencil,
  Save,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { ScreenshotImport } from "@/components/ScreenshotImport";
import { useApprovalFields } from "@/lib/auth";

export const Route = createFileRoute("/denni-data")({
  head: () => ({
    meta: [
      { title: "Denní data – Výkonnost operátorů" },
      {
        name: "description",
        content:
          "Rychlé zadávání denních záznamů: import screenshotů, ruční zadání a přehled výkonu pracovníků.",
      },
    ],
  }),
  component: DailyPage,
});

const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value: string) => {
  if (!value) return "–";
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}.${m}.${y}` : value;
};

function metricTone(value: number | null | undefined) {
  if (value == null) return "text-muted-foreground";
  if (value >= 100) return "text-emerald-300";
  if (value >= 80) return "text-amber-300";
  return "text-rose-300";
}

function DailyPage() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: employees = [] } = useEmployees();
  const { records, links, shifts: shiftAggregates } = useShiftAggregates();

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
  const [manualOpen, setManualOpen] = useState(false);
  const [dailyFilterText, setDailyFilterText] = useState("");
  const [dailyFilterShift, setDailyFilterShift] = useState("all");
  const [dailyFilterDate, setDailyFilterDate] = useState("");
  const [dailySort, setDailySort] = useState<"date" | "employee" | "oee" | "performance" | "availableTime">("date");
  const [dailySortDir, setDailySortDir] = useState<"asc" | "desc">("desc");

  const activeEmployees = employees.filter((e) => e.active);

  const sameShiftEmployees = useMemo(() => {
    const ids = new Set(
      records
        .filter(
          (r) =>
            r.work_date === workDate &&
            r.shift === shift &&
            r.line.trim().toLowerCase() === line.trim().toLowerCase() &&
            r.employee_id !== employeeId,
        )
        .map((r) => r.employee_id),
    );
    return employees.filter((e) => ids.has(e.id));
  }, [records, workDate, shift, line, employeeId, employees]);

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "?";

  const myShift: ShiftAggregate | undefined = shiftAggregates.find(
    (a) => a.employee_id === employeeId && a.work_date === workDate && a.shift === shift,
  );

  useEffect(() => {
    setHelp(myShift?.help !== null && myShift?.help !== undefined ? String(myShift.help) : "0");
  }, [employeeId, workDate, shift]); // eslint-disable-line react-hooks/exhaustive-deps

  const duplicateLine =
    !!employeeId && !!line.trim() && isDuplicateLine(records, employeeId, workDate, shift, line);

  const create = useMutation({
    mutationFn: async (_mode: "single" | "another" = "single") => {
      const { data, error } = await supabase
        .from("daily_records")
        .insert({
          work_date: workDate,
          shift,
          line: line.trim(),
          product: product.trim() || null,
          employee_id: employeeId,
          position,
          oee: oee === "" ? null : Number(oee),
          help_score: 0,
          note: note.trim() || null,
          ...approval(),
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: he } = await supabase.from("shift_evaluations").upsert(
        {
          employee_id: employeeId,
          work_date: workDate,
          shift,
          help_score: Number(help || 0),
          ...approval(),
        },
        { onConflict: "employee_id,work_date,shift" },
      );
      if (he) throw he;

      const valid = coworkers.filter((c) => sameShiftEmployees.some((e) => e.id === c));
      if (valid.length) {
        const { error: e2 } = await supabase
          .from("daily_record_coworkers")
          .insert(valid.map((c) => ({ record_id: data.id, coworker_id: c })));
        if (e2) throw e2;
      }
    },
    onSuccess: (_d, mode) => {
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["coworkers"] });
      qc.invalidateQueries({ queryKey: ["shift_evaluations"] });
      setOee("");
      setHelp("0");
      setNote("");
      setCoworkers([]);
      setEmployeeId("");
      if (mode === "single") setProduct("");
      setManualOpen(false);
      toast.success(mode === "another" ? "Uloženo – zadejte další" : "Záznam uložen");
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate")
          ? "Tento pracovník už má záznam na této lince v dané směně."
          : e.message,
      ),
  });

  const update = useMutation({
    mutationFn: async (recordId: string) => {
      if (!recordId) throw new Error("Chybí ID záznamu");
      const { error } = await supabase
        .from("daily_records")
        .update({
          work_date: workDate,
          shift,
          line: line.trim(),
          product: product.trim() || null,
          employee_id: employeeId,
          position,
          oee: oee === "" ? null : Number(oee),
          help_score: 0,
          note: note.trim() || null,
          ...approval(),
        })
        .eq("id", recordId)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["coworkers"] });
      setEditingRecord(null);
      setManualOpen(false);
      setOee("");
      setHelp("0");
      setNote("");
      setCoworkers([]);
      setEmployeeId("");
      setProduct("");
      toast.success("Záznam upraven");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily"] });
      toast.success("Záznam smazán");
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
      if (
        text &&
        !empName(a.employee_id).toLowerCase().includes(text) &&
        !a.lines.join(" ").toLowerCase().includes(text)
      )
        return false;
      return true;
    });
    const value = (a: ShiftAggregate) =>
      dailySort === "date"
        ? `${a.work_date} ${a.shift}`
        : dailySort === "employee"
          ? empName(a.employee_id).toLowerCase()
          : Number(
              dailySort === "oee"
                ? a.oee ?? -Infinity
                : dailySort === "performance"
                  ? a.performance ?? -Infinity
                  : a.availableTime ?? -Infinity,
            );
    filtered.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dailySortDir === "asc" ? cmp : -cmp;
    });
    return filtered.slice(0, 100);
  }, [shiftAggregates, dailyFilterText, dailyFilterShift, dailyFilterDate, dailySort, dailySortDir, employees]);

  const summary = useMemo(() => {
    const pool = dailyFilterDate
      ? shiftAggregates.filter((s) => s.work_date === dailyFilterDate)
      : shiftAggregates;
    const avg = (values: Array<number | null | undefined>) => {
      const usable = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      return usable.length ? usable.reduce((sum, v) => sum + v, 0) / usable.length : null;
    };
    return {
      records: pool.reduce((sum, s) => sum + s.records.length, 0),
      oee: avg(pool.map((s) => s.oee)),
      performance: avg(pool.map((s) => s.performance)),
      availability: avg(pool.map((s) => s.availableTime)),
    };
  }, [shiftAggregates, dailyFilterDate]);

  const loadForEdit = (record: DailyRecord) => {
    setEditingRecord(record);
    setWorkDate(record.work_date);
    setShift(record.shift);
    setLine(record.line);
    setProduct(record.product ?? "");
    setEmployeeId(record.employee_id);
    setPosition(record.position);
    setOee(record.oee?.toString() ?? "");
    setHelp(record.help_score.toString());
    setNote(record.note ?? "");
    setManualOpen(true);
  };

  const openNewManual = () => {
    setEditingRecord(null);
    setWorkDate(today());
    setShift(SHIFTS[0]);
    setLine("");
    setProduct("");
    setEmployeeId("");
    setPosition("HA");
    setOee("");
    setHelp("0");
    setNote("");
    setCoworkers([]);
    setManualOpen(true);
  };

  const cancelEdit = () => {
    setEditingRecord(null);
    setManualOpen(false);
  };

  const exportCsv = () => {
    const header = ["Datum", "Směna", "Zaměstnanec", "Linky", "OEE", "Výkon", "Dostupnost", "Výpomoc"].join(";");
    const lines = filteredShifts.map((a) =>
      [
        a.work_date,
        a.shift,
        empName(a.employee_id),
        a.lines.join(", "),
        a.oee ?? "",
        a.performance ?? "",
        a.availableTime ?? "",
        a.help ?? "",
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["\uFEFF" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `denni-data-${dailyFilterDate || "vse"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      title="Denní data"
      subtitle="Záznam se vytváří pouze když byl pracovník v práci – absence průměr OEE neovlivní."
    >
      <div className="space-y-5">
        <section className="grid gap-4 xl:grid-cols-2">
          <Card className="relative overflow-hidden border-rose-400/30 bg-slate-950/60 p-0 shadow-[0_0_35px_rgba(244,63,94,0.08)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rose-400 to-transparent" />
            <div className="p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-rose-400/30 bg-rose-400/10 text-rose-300">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">Import dat</p>
                  <h2 className="text-xl font-semibold">Screenshoty výroby</h2>
                </div>
              </div>
              <div className="rounded-2xl border border-dashed border-rose-400/50 bg-slate-900/70 p-2">
                <ScreenshotImport employees={employees} />
              </div>
            </div>
          </Card>

          <Card className="relative overflow-hidden border-fuchsia-400/25 bg-slate-950/60 p-0 shadow-[0_0_35px_rgba(217,70,239,0.08)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400 to-transparent" />
            <div className="flex h-full flex-col justify-between p-5 sm:p-6">
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300">
                    <FilePlus2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">Ruční zápis</p>
                    <h2 className="text-xl font-semibold">Zadat denní záznam ručně</h2>
                  </div>
                </div>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                  Otevře se dialog s kompletním formulářem pro jeden denní záznam. Tabulka zůstává čistá a přehledná.
                </p>
              </div>
              <Button onClick={openNewManual} className="mt-6 h-12 w-full bg-rose-500 text-slate-950 shadow-[0_0_22px_rgba(244,63,94,0.25)] hover:bg-rose-400">
                <FilePlus2 className="mr-2 h-4 w-4" /> Zadat denní záznam ručně
              </Button>
            </div>
          </Card>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: `Záznamy${dailyFilterDate ? ` (${formatDate(dailyFilterDate)})` : ""}`, value: summary.records.toLocaleString("cs-CZ"), detail: "záznamů celkem", tone: "text-sky-300" },
            { label: "Průměrné OEE", value: summary.oee == null ? "–" : `${fmt(summary.oee)} %`, detail: "ze směnových hodnocení", tone: metricTone(summary.oee) },
            { label: "Průměrný výkon", value: summary.performance == null ? "–" : `${fmt(summary.performance)} %`, detail: "bez horního limitu", tone: "text-cyan-300" },
            { label: "Průměrná dostupnost", value: summary.availability == null ? "–" : `${fmt(summary.availability)} %`, detail: "z vybraných záznamů", tone: metricTone(summary.availability) },
          ].map((item) => (
            <Card key={item.label} className="border-border/70 bg-slate-950/45 px-4 py-4">
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <div className={`mt-2 text-2xl font-semibold tabular-nums ${item.tone}`}>{item.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </Card>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/80 bg-slate-950/40 shadow-[var(--shadow-card)]">
          <div className="border-b border-border/70 p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">Production monitoring</p>
                <h2 className="mt-1 text-lg font-semibold">Směnová hodnocení</h2>
                <p className="text-xs text-muted-foreground">Pracovník může mít ve směně více linek.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1 xl:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={dailyFilterText} onChange={(e) => setDailyFilterText(e.target.value)} className="pl-9" placeholder="Hledat zaměstnance nebo linku…" />
                </div>
                <Input type="date" value={dailyFilterDate} onChange={(e) => setDailyFilterDate(e.target.value)} className="w-auto" aria-label="Filtrovat datum" />
                <Select value={dailyFilterShift} onValueChange={setDailyFilterShift}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Všechny směny" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny směny</SelectItem>
                    {SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={exportCsv} className="border-rose-400/40 text-rose-300 hover:bg-rose-400/10">
                  <Download className="mr-2 h-4 w-4" /> Exportovat
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Select value={dailySort} onValueChange={(v) => setDailySort(v as typeof dailySort)}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Řazení: datum</SelectItem>
                  <SelectItem value="employee">Řazení: zaměstnanec</SelectItem>
                  <SelectItem value="oee">Řazení: OEE</SelectItem>
                  <SelectItem value="performance">Řazení: výkon</SelectItem>
                  <SelectItem value="availableTime">Řazení: dostupnost</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setDailySortDir((v) => (v === "asc" ? "desc" : "asc"))}>
                {dailySortDir === "asc" ? "Vzestupně ↑" : "Sestupně ↓"}
              </Button>
              {dailyFilterDate ? (
                <Button variant="ghost" size="sm" onClick={() => setDailyFilterDate("")}>
                  <X className="mr-1 h-3.5 w-3.5" /> Zrušit datum
                </Button>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-900/80 text-muted-foreground">
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide">
                  {['Datum', 'Směna', 'Zaměstnanec', 'Linky', 'Ø OEE', 'Ø Výkon', 'Ø Dostupnost', 'Výpomoc', 'Tým', 'Akce'].map((head, i) => (
                    <th key={head} className={`px-4 py-3 font-medium ${i >= 4 && i <= 7 ? 'text-right' : ''} ${i === 9 ? 'text-right' : ''}`}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredShifts.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">Zatím žádné záznamy pro zvolené filtry.</td></tr>
                ) : (
                  filteredShifts.flatMap((a) => [
                    <tr key={`${a.key}-summary`} className="border-b border-border/60 bg-slate-900/35 hover:bg-slate-900/55">
                      <td className="px-4 py-3 font-medium">{formatDate(a.work_date)}</td>
                      <td className="px-4 py-3">{a.shift}</td>
                      <td className="px-4 py-3 font-medium">{empName(a.employee_id)}</td>
                      <td className="px-4 py-3"><Badge variant="secondary" className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200">{a.lineCount} {a.lineCount === 1 ? 'linka' : a.lineCount < 5 ? 'linky' : 'linek'}</Badge></td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${metricTone(a.oee)}`}>{fmt(a.oee)} %</td>
                      <td className="px-4 py-3 text-right tabular-nums text-cyan-200">{fmt(a.performance)} %</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${metricTone(a.availableTime)}`}>{fmt(a.availableTime)} %</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-200">{fmt(a.help, 0)}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-xs text-muted-foreground">{a.coworkerIds.map(empName).join(', ') || '–'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button size="icon" variant="ghost" title="Rozbalit / akce" onClick={() => document.getElementById(`detail-${a.key}`)?.scrollIntoView({ block: 'nearest' })}><span className="text-muted-foreground">⌄</span></Button>
                        </div>
                      </td>
                    </tr>,
                    <tr key={`${a.key}-details`} id={`detail-${a.key}`} className="border-b border-border/40 bg-slate-950/20">
                      <td colSpan={10} className="px-4 pb-4 pt-0">
                        <div className="grid gap-2 rounded-xl border border-border/60 bg-slate-950/40 p-3">
                          {a.records.map((r) => (
                            <div key={r.id} className="grid items-center gap-3 rounded-lg border border-border/50 bg-slate-900/45 px-3 py-2 md:grid-cols-[1.4fr_1fr_80px_90px_90px_auto]">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">↳ {r.line}</p>
                                <p className="truncate text-xs text-muted-foreground">{r.product ?? 'Produkt neuveden'}</p>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <Badge variant="outline" className={r.position === 'HA' ? 'border-cyan-400/40 text-cyan-300' : 'border-fuchsia-400/40 text-fuchsia-300'}>{r.position}</Badge>
                                {r.source === 'screenshot' ? <Badge variant="outline" className="text-[10px]">import</Badge> : null}
                              </div>
                              <div className={`text-right text-xs font-semibold tabular-nums ${metricTone(r.oee)}`}>{fmt(r.oee)} %</div>
                              <div className="text-right text-xs tabular-nums text-cyan-200">{fmt(r.performance)} %</div>
                              <div className="text-right text-xs tabular-nums">{fmt(r.available_time)} %</div>
                              <div className="flex justify-end gap-1">
                                <Button size="icon" variant="ghost" title="Upravit" onClick={() => loadForEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button size="icon" variant="ghost" title="Smazat" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>,
                  ])
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Zobrazeno {filteredShifts.reduce((sum, a) => sum + a.records.length, 0)} záznamů ve {filteredShifts.length} směnových hodnoceních.</span>
            <span className="text-muted-foreground/70">OEE a výkon mohou být nad 100 %.</span>
          </div>
        </section>
      </div>

      <Dialog open={manualOpen} onOpenChange={(open) => { setManualOpen(open); if (!open) setEditingRecord(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-fuchsia-400/30 bg-slate-950/95 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePlus2 className="h-5 w-5 text-fuchsia-300" />
              {editingRecord ? "Upravit denní záznam" : "Zadat denní záznam ručně"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 rounded-xl border border-border/60 bg-slate-900/45 p-4 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>Datum</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Směna</Label><Select value={shift} onValueChange={setShift}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>Linka</Label><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="např. L1" /></div>
              <div className="grid gap-1.5"><Label>Výrobek</Label><Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product ID / popis" /></div>
              <div className="grid gap-1.5 sm:col-span-2"><Label>Zaměstnanec</Label><Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger><SelectValue placeholder="Vyberte zaměstnance" /></SelectTrigger><SelectContent>{activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>Pozice</Label><Select value={position} onValueChange={(v) => setPosition(v as "HA" | "TUP")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>OEE (%) – nepovinné</Label><Input type="number" inputMode="decimal" step="0.1" min="0" value={oee} onChange={(e) => setOee(e.target.value)} placeholder="bez horního limitu" /></div>
              <div className="grid gap-2 sm:col-span-2"><Label>Výpomoc ({help})</Label><Input type="range" min={-100} max={100} step={5} value={help} onChange={(e) => setHelp(e.target.value)} className="cursor-pointer p-0" /><div className="flex justify-between text-[11px] text-muted-foreground"><span>-100</span><span>0 (výchozí)</span><span>+100</span></div></div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Spolupracovníci (stejná směna a linka)</Label>
                {sameShiftEmployees.length === 0 ? <p className="text-xs text-muted-foreground">Na této směně a lince zatím nejsou evidováni jiní pracovníci.</p> : <div className="grid gap-1.5 rounded-md border border-border p-2">{sameShiftEmployees.map((e) => <label key={e.id} className="flex items-center gap-2 text-sm"><Checkbox checked={coworkers.includes(e.id)} onCheckedChange={(v) => setCoworkers((prev) => v === true ? [...prev, e.id] : prev.filter((x) => x !== e.id))} />{e.full_name}</label>)}</div>}
              </div>
              <div className="grid gap-1.5 sm:col-span-2"><Label>Poznámka</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Volitelná poznámka" /></div>
            </div>
            {myShift ? <div className={`rounded-lg border px-3 py-2 text-xs ${duplicateLine ? 'border-destructive bg-destructive/10 text-destructive' : 'border-amber-400/30 bg-amber-400/5 text-amber-200'}`}>{duplicateLine ? <>Na lince <strong>{line.trim()}</strong> už tento pracovník v této směně záznam má – duplicita.</> : <>Pracovník už má v této směně {myShift.lineCount}× linku ({myShift.lines.join(', ')}). Nový záznam se přidá jako další linka.</>}</div> : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={cancelEdit}>Zrušit</Button>
            <Button
              variant="secondary"
              onClick={() => editingRecord ? update.mutate(editingRecord.id) : create.mutate("another")}
              disabled={!canSaveOrUpdate || create.isPending || update.isPending}
            >
              <PlusIcon /> Uložit a přidat další
            </Button>
            <Button
              onClick={() => editingRecord ? update.mutate(editingRecord.id) : create.mutate("single")}
              disabled={!canSaveOrUpdate || create.isPending || update.isPending}
              className="bg-rose-500 text-slate-950 hover:bg-rose-400"
            >
              <Save className="mr-2 h-4 w-4" /> {editingRecord ? "Uložit změny" : "Uložit záznam"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function PlusIcon() {
  return <span className="mr-2 inline-flex text-base leading-none">＋</span>;
}
