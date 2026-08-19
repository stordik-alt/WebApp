import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Ruler } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDailyRecords, useNormRemeasurements, useProductNorms, useProducts } from "@/lib/data";
import { currentNorm, findProductByCode } from "@/lib/products";
import { fmt } from "@/lib/metrics";
import { newProposals, type NormRemeasurement, type ProductShift } from "@/lib/remeasure";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/premereni-norem")({
  head: () => ({
    meta: [
      { title: "Přeměření norem – Výkonnost operátorů" },
      {
        name: "description",
        content:
          "Návrhy na přeměření hodinových norem, pokud produkt nesplní OEE tři odpracované směny v řadě.",
      },
      { property: "og:title", content: "Přeměření norem – Výkonnost operátorů" },
      {
        property: "og:description",
        content: "Analytické návrhy k přezkoumání normy, jejich přijetí, odmítnutí a výsledky přeměření.",
      },
    ],
  }),
  component: RemeasurePage,
});

function ShiftList({ shifts }: { shifts: ProductShift[] }) {
  return (
    <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
      {shifts.map((s) => (
        <div key={`${s.work_date}-${s.shift}`} className="rounded-md bg-muted/60 px-2 py-1.5">
          <div className="font-medium text-foreground">
            {s.work_date} · {s.shift}
          </div>
          <div>OEE {fmt(s.oee)} %</div>
          <div className="truncate">Linky: {s.lines.join(", ") || "–"}</div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: NormRemeasurement["status"] }) {
  if (status === "accepted") return <Badge>Přijato</Badge>;
  if (status === "rejected") return <Badge variant="outline">Odmítnuto</Badge>;
  return <Badge variant="secondary">Čeká na rozhodnutí</Badge>;
}

function RemeasurePage() {
  const qc = useQueryClient();
  const { data: records = [] } = useDailyRecords();
  const { data: products = [] } = useProducts();
  const { data: norms = [] } = useProductNorms();
  const { data: rows = [] } = useNormRemeasurements();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["norm_remeasurements"] });
    qc.invalidateQueries({ queryKey: ["product_norms"] });
  };

  const proposals = useMemo(() => newProposals(records, rows), [records, rows]);

  const createProposal = useMutation({
    mutationFn: async (p: (typeof proposals)[number]) => {
      const product = findProductByCode(products, p.product);
      const ha = product ? currentNorm(norms, product.id, "HA") : undefined;
      const tup = product ? currentNorm(norms, product.id, "TUP") : undefined;
      const { error } = await supabase.from("norm_remeasurements").insert({
        product_id: product?.id ?? null,
        product_code: p.product,
        trigger_key: p.triggerKey,
        shifts: p.shifts as unknown as never,
        avg_oee: p.avgOee,
        current_norm_ha: ha?.norm_per_hour ?? null,
        current_norm_tup: tup?.norm_per_hour ?? null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Návrh zařazen k rozhodnutí");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "accepted" | "rejected" }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("norm_remeasurements")
        .update({
          status,
          decided_at: new Date().toISOString(),
          decided_by: userData.user?.email ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Rozhodnutí uloženo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = rows.filter((r) => r.status === "pending");
  const accepted = rows.filter((r) => r.status === "accepted");
  const history = rows.filter((r) => r.status === "rejected");

  return (
    <AppShell
      title="Přeměření norem"
      subtitle="Analytický návrh k přezkoumání normy – přijetí neznamená automatickou změnu normy."
    >
      <div className="grid gap-6">
        <Card className="p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Nové detekce ({proposals.length})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pravidlo: 3 po sobě jdoucí relevantní směny stejného produktu s OEE pod 100 %. Směny bez
            validního OEE se ignorují.
          </p>
          {proposals.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Žádná nová detekce.</p>
          ) : (
            <div className="mt-3 grid gap-3">
              {proposals.map((p) => (
                <div key={p.triggerKey} className="rounded-lg border border-destructive/40 p-3">
                  <div className="text-sm font-medium">
                    Produkt {p.product} nesplnil OEE 3 směny v řadě. Doporučeno přeměření normy.
                  </div>
                  <ShiftList shifts={p.shifts} />
                  <div className="mt-2 text-xs text-muted-foreground">
                    Průměr OEE za 3 směny: <span className="font-medium text-foreground">{fmt(p.avgOee)} %</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => createProposal.mutate(p)}>
                      Zařadit k rozhodnutí
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Čeká na rozhodnutí ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nic nečeká na rozhodnutí.</p>
          ) : (
            <div className="mt-3 grid gap-3">
              {pending.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      Produkt {r.product_code} nesplnil OEE 3 směny v řadě. Doporučeno přeměření normy.
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <ShiftList shifts={r.shifts} />
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>Ø OEE: {fmt(r.avg_oee)} %</div>
                    <div>Norma HA: {fmt(r.current_norm_ha, 0)} ks/h</div>
                    <div>Norma TUP: {fmt(r.current_norm_tup, 0)} ks/h</div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Vytvořeno: {new Date(r.created_at).toLocaleString("cs-CZ")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => decide.mutate({ id: r.id, status: "accepted" })}>
                      Přijmout – zařadit do Přeměření norem
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decide.mutate({ id: r.id, status: "rejected" })}
                    >
                      Odmítnout
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Ruler className="h-4 w-4" /> Aktivní přeměření ({accepted.length})
          </h2>
          {accepted.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Žádné aktivní přeměření.</p>
          ) : (
            <div className="mt-3 grid gap-3">
              {accepted.map((r) => (
                <AcceptedItem key={r.id} row={r} onDone={invalidate} />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Historie odmítnutých ({history.length})</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Zatím nic odmítnuto.</p>
          ) : (
            <div className="mt-3 grid gap-2">
              {history.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{r.product_code}</span>
                  <span className="text-xs text-muted-foreground">
                    Ø OEE {fmt(r.avg_oee)} % · vytvořeno{" "}
                    {new Date(r.created_at).toLocaleDateString("cs-CZ")}
                    {r.decided_at
                      ? ` · odmítnuto ${new Date(r.decided_at).toLocaleDateString("cs-CZ")}`
                      : ""}
                    {r.decided_by ? ` (${r.decided_by})` : ""}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function AcceptedItem({ row, onDone }: { row: NormRemeasurement; onDone: () => void }) {
  const [ha, setHa] = useState("");
  const [tup, setTup] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!ha && !tup) throw new Error("Zadejte alespoň jednu novou normu");
      if (row.product_id) {
        const ops: { operation: "HA" | "TUP"; value: string }[] = [
          { operation: "HA", value: ha },
          { operation: "TUP", value: tup },
        ];
        for (const op of ops) {
          if (!op.value) continue;
          // Uzavře platnost staré verze, historii zachová.
          const { error: closeErr } = await supabase
            .from("product_norms")
            .update({ valid_to: validFrom })
            .eq("product_id", row.product_id)
            .eq("operation", op.operation)
            .is("valid_to", null);
          if (closeErr) throw closeErr;
          const { error: insErr } = await supabase.from("product_norms").insert({
            product_id: row.product_id,
            operation: op.operation,
            norm_per_hour: Number(op.value),
            valid_from: validFrom,
            source: "remeasurement",
            confirmed: true,
            note: note || null,
          });
          if (insErr) throw insErr;
        }
      }
      const { error } = await supabase
        .from("norm_remeasurements")
        .update({
          result_norm_ha: ha ? Number(ha) : null,
          result_norm_tup: tup ? Number(tup) : null,
          result_valid_from: validFrom,
          result_note: note || null,
          confirmed_by: by || null,
          result_applied_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      onDone();
      toast.success("Výsledek přeměření uložen, stará norma zůstala v historii");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{row.product_code}</div>
        <StatusBadge status={row.status} />
      </div>
      <ShiftList shifts={row.shifts} />
      <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div>Ø OEE: {fmt(row.avg_oee)} %</div>
        <div>Norma HA: {fmt(row.current_norm_ha, 0)} ks/h</div>
        <div>Norma TUP: {fmt(row.current_norm_tup, 0)} ks/h</div>
      </div>

      {row.result_applied_at ? (
        <div className="mt-3 rounded-md bg-muted/60 p-3 text-xs">
          Výsledek přeměření: HA {fmt(row.result_norm_ha, 0)} ks/h · TUP {fmt(row.result_norm_tup, 0)}{" "}
          ks/h · platnost od {row.result_valid_from} · potvrdil {row.confirmed_by ?? "–"}
          {row.result_note ? ` · ${row.result_note}` : ""}
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Nová norma HA (ks/h)</Label>
              <Input inputMode="decimal" value={ha} onChange={(e) => setHa(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Nová norma TUP (ks/h)</Label>
              <Input inputMode="decimal" value={tup} onChange={(e) => setTup(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Platnost od</Label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Přeměření potvrdil</Label>
              <Input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Jméno" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Poznámka</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            Uložit výsledek přeměření
          </Button>
        </div>
      )}
    </div>
  );
}
