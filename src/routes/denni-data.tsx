import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useShiftAggregates } from "@/lib/data";
import { isDuplicateLine, type ShiftAggregate } from "@/lib/shifts";
import { type DailyRecord } from "@/lib/metrics";
import { SHIFTS, fmt } from "@/lib/metrics";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Save, Plus, Pencil } from "lucide-react";
import { ScreenshotImport } from "@/components/ScreenshotImport";
import { useApprovalFields } from "@/lib/auth";

export const Route = createFileRoute("/denni-data")({
  head: () => ({
    meta: [
      { title: "Denní data – Výkonnost operátorů" },
      {
        name: "description",
        content:
          "Rychlé zadávání denních záznamů: směna, linka, výrobek, pozice HA/TUP, OEE, výpomoc a spolupracovníci.",
      },
      { property: "og:title", content: "Denní data – Výkonnost operátorů" },
      {
        property: "og:description",
        content: "Zadávání denních výkonových záznamů pracovníků výroby DPS.",
      },
    ],
  }),
  component: DailyPage,
});

const today = () => new Date().toISOString().slice(0, 10);

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

  const activeEmployees = employees.filter((e) => e.active);

  /** Spolupracovníci = pracovníci již evidovaní na stejném dni / směně / lince. */
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

  /** Existující linky pracovníka v této směně – nejde o duplicitu, ale o další linku. */
  const myShift: ShiftAggregate | undefined = shiftAggregates.find(
    (a) => a.employee_id === employeeId && a.work_date === workDate && a.shift === shift,
  );
  // Výpomoc se drží jednou za pracovníka+datum+směnu – předvyplníme existující hodnotu.
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

      // Výpomoc je hodnocení za pracovníka + datum + směnu (jednou, ne za každou linku).
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
      if (mode === "single") {
        setProduct("");
      }
      toast.success(mode === "another" ? "Uloženo – zadejte další" : "Záznam uložen");
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate")
          ? "Tento pracovník už má záznam na této lince v dané směně. Pro jinou linku zadejte jiný název linky."
          : e.message,
      ),
  });

  const update = useMutation({
    mutationFn: async (recordId: string) => {
      if (!recordId) throw new Error("Chybí ID záznamu");
      const { data, error } = await supabase
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
  });

  const canSave = workDate && shift && line.trim() && employeeId;
  // Při úpravě záznamu ignorujeme duplicateLine (záznam se aktualizuje sám sebou)
  const canSaveOrUpdate = canSave && (!duplicateLine || !!editingRecord);
  const recentShifts = shiftAggregates.slice(0, 25);

  // Funkce pro načtení záznamu do editace
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
    // coworkers se načítají z links
  };

  // Funkce pro ukončení editace
  const cancelEdit = () => {
    setEditingRecord(null);
    setOee("");
    setHelp("0");
    setNote("");
    setCoworkers([]);
    setEmployeeId("");
    setProduct("");
  };

  return (
    <AppShell
      title="Denní data"
      subtitle="Záznam se vytváří pouze když byl pracovník v práci – absence průměr OEE neovlivní."
    >
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
        <div className="grid min-w-0 gap-6">
          <ScreenshotImport employees={employees} />
          <Card className="h-fit min-w-0 overflow-hidden gap-4 p-4 shadow-[var(--shadow-card)] sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Nový záznam (ručně)
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Datum</Label>
                <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Směna</Label>
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIFTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Linka</Label>
                <Input
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  placeholder="např. L1"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Výrobek</Label>
                <Input value={product} onChange={(e) => setProduct(e.target.value)} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Zaměstnanec</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte zaměstnance" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeEmployees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Pozice</Label>
                <Select value={position} onValueChange={(v) => setPosition(v as "HA" | "TUP")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HA">HA</SelectItem>
                    <SelectItem value="TUP">TUP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>OEE (%) – nepovinné</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  className="h-11"
                  value={oee}
                  onChange={(e) => setOee(e.target.value)}
                  placeholder="bez horního limitu, prázdné = neuvedeno"
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Výpomoc ({help})</Label>
                <Input
                  type="range"
                  min={-100}
                  max={100}
                  step={5}
                  value={help}
                  onChange={(e) => setHelp(e.target.value)}
                  className="cursor-pointer p-0"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>-100</span>
                  <span>0 (výchozí)</span>
                  <span>+100</span>
                </div>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Spolupracovníci (stejná směna a linka)</Label>
                {sameShiftEmployees.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Na této směně a lince zatím nejsou evidováni jiní pracovníci.
                  </p>
                ) : (
                  <div className="grid gap-1.5 rounded-md border border-border p-2">
                    {sameShiftEmployees.map((e) => (
                      <label key={e.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={coworkers.includes(e.id)}
                          onCheckedChange={(v) =>
                            setCoworkers((prev) =>
                              v === true ? [...prev, e.id] : prev.filter((x) => x !== e.id),
                            )
                          }
                        />
                        {e.full_name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Poznámka</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            {myShift ? (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  duplicateLine
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-warning/40 bg-warning/10"
                }`}
              >
                {duplicateLine ? (
                  <>
                    Na lince <strong>{line.trim()}</strong> už tento pracovník v této směně záznam
                    má – to je duplicita.
                  </>
                ) : (
                  <>
                    Pracovník už má v této směně {myShift.lineCount}× linku (
                    {myShift.lines.join(", ")}). Nový záznam se přidá jako další linka a do denního
                    hodnocení se započítá jako průměr přes linky.
                  </>
                )}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                className="h-12"
                onClick={() => create.mutate("single")}
                disabled={!canSaveOrUpdate || create.isPending}
              >
                <Save className="h-4 w-4" /> {editingRecord ? "Uložit změny" : "Uložit záznam"}
              </Button>
              <Button
                variant="secondary"
                className="h-12"
                onClick={() => create.mutate("another")}
                disabled={!canSaveOrUpdate || create.isPending}
              >
                <Plus className="h-4 w-4" />{" "}
                {editingRecord ? "Uložit a pokračovat" : "Uložit a přidat další"}
              </Button>
            </div>
          </Card>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm font-semibold">
            <span>
              Směnová hodnocení ({shiftAggregates.length}) – pracovník může mít ve směně více linek
            </span>
            {editingRecord && (
              <Button size="sm" variant="outline" onClick={cancelEdit}>
                Zrušit úpravu
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Směna</TableHead>
                <TableHead>Zaměstnanec</TableHead>
                <TableHead>Linky</TableHead>
                <TableHead className="text-right">Ø OEE</TableHead>
                <TableHead className="text-right">Ø Výkon</TableHead>
                <TableHead className="text-right">Ø Dostup.</TableHead>
                <TableHead className="text-right">Výpomoc</TableHead>
                <TableHead>Tým</TableHead>
                <TableHead className="text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentShifts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-muted-foreground">
                    Zatím žádné záznamy.
                  </TableCell>
                </TableRow>
              ) : (
                recentShifts.flatMap((a) => [
                  <TableRow key={a.key} className="bg-muted/40">
                    <TableCell>{a.work_date}</TableCell>
                    <TableCell>{a.shift}</TableCell>
                    <TableCell className="font-medium">{empName(a.employee_id)}</TableCell>
                    <TableCell>
                      <Badge variant={a.lineCount > 1 ? "default" : "secondary"}>
                        {a.lineCount}{" "}
                        {a.lineCount === 1 ? "linka" : a.lineCount < 5 ? "linky" : "linek"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmt(a.oee)} %
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(a.performance)} %
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(a.availableTime)} %
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(a.help, 0)}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                      {a.coworkerIds.map(empName).join(", ") || "–"}
                    </TableCell>
                    <TableCell />
                  </TableRow>,
                  ...a.records.map((r) => (
                    <TableRow key={r.id} className="text-xs text-muted-foreground">
                      <TableCell colSpan={2} className="pl-6">
                        ↳ linka {r.line}
                      </TableCell>
                      <TableCell>{r.product ?? "–"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.position}</Badge>
                        {r.source === "screenshot" ? (
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            import
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.oee)} %</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(r.performance)} %
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(r.available_time)} %
                      </TableCell>
                      <TableCell />
                      <TableCell className="max-w-[180px] truncate">
                        {links
                          .filter((l) => l.record_id === r.id)
                          .map((l) => empName(l.coworker_id))
                          .join(", ") || "–"}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingRecord?.id === r.id ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => update.mutate(r.id)}
                            disabled={update.isPending}
                          >
                            <Save className="h-3.5 w-3.5" /> Uložit změny
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => loadForEdit(r)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )),
                ])
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
