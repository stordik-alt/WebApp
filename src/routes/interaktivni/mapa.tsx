import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory, Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { FloorMap, type FloorMapWorkstationView } from "@/components/interaktivni/FloorMap";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
import { useShiftSelection } from "@/components/interaktivni/ShiftSelectionContext";
import { listWorkstations, normalizeParentLine, type IwWorkstation } from "@/lib/floorMap";
import { computeExpectedCompletion } from "@/lib/shift-eta";
import { productCapacityFor, productionCapacity } from "@/lib/production-capacity";
import { listAssignments } from "@/lib/shiftAssignments";
import { ensureShift, listActiveProductions, listActiveProducts, resolveProductProfile, startProduction, updateProduction } from "@/lib/shiftProductions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/interaktivni/mapa")({
  head: () => ({
    meta: [
      { title: "Mapa haly – Interaktivní prostředí" },
      { name: "description", content: "Zadání výroby a zbývajících kusů na každou linku + aktuální stav haly." },
    ],
  }),
  component: FloorMapPage,
});

function nowHHMM() {
  return new Date().toISOString().slice(11, 16);
}

function FloorMapPage() {
  const { leaderUserId, canManage, teamId, workDate, shift } = useShiftSelection();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, { productId: string; code: string; pieces: string }>>({});
  const [openProductSelector, setOpenProductSelector] = useState<string | null>(null);

  const shiftQuery = useQuery({
    queryKey: ["iw_shift", teamId, workDate, shift],
    queryFn: () => ensureShift({ teamId: teamId as string, workDate, shift, createdBy: leaderUserId as string }),
    enabled: Boolean(teamId) && Boolean(leaderUserId),
  });

  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const mainWorkstations = (workstationsQuery.data ?? []).filter((w) => !w.is_secondary);

  const productsQuery = useQuery({
    queryKey: ["iw_active_products"],
    queryFn: listActiveProducts,
    staleTime: 60_000,
  });

  const products = productsQuery.data ?? [];
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const productByCode = useMemo(() => new Map(products.map((p) => [p.code, p])), [products]);

  const productionsQuery = useQuery({
    queryKey: ["iw_shift_productions", shiftQuery.data?.id],
    queryFn: () => listActiveProductions(shiftQuery.data!.id),
    enabled: Boolean(shiftQuery.data),
  });
  const productions = productionsQuery.data ?? [];
  const productionByWorkstation = useMemo(() => new Map(productions.map((p) => [p.workstation_id, p])), [productions]);

  const assignmentsQuery = useQuery({ queryKey: ["iw_shift_assignments", shiftQuery.data?.id], queryFn: () => listAssignments(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });

  const profilesQuery = useQuery({
    queryKey: ["iw_resolved_profiles", productions.map((p) => p.product_code).join(","), workDate],
    queryFn: async () => {
      const entries = await Promise.all(productions.map(async (p) => [p.product_code, await resolveProductProfile(p.product_code, workDate)] as const));
      return new Map(entries);
    },
    enabled: productions.length > 0,
  });

  const totalCapacity = useMemo(() => {
    if (!profilesQuery.data) return 0;
    return productionCapacity(
      productions.map((p) => {
        const profile = profilesQuery.data!.get(p.product_code);
        return { area: p.area, h_capacity: profile?.h_capacity ?? null, t_capacity: profile?.t_capacity ?? null };
      }),
    );
  }, [productions, profilesQuery.data]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["iw_shift_productions", shiftQuery.data?.id] });
  }

  async function setProduction(workstation: IwWorkstation) {
    const draft = drafts[workstation.id];
    if (!draft?.productId) return;
    const pieces = Number(draft.pieces);
    if (!Number.isFinite(pieces) || pieces < 0) return;

    const product = productById.get(draft.productId);
    if (!product) return;

    const existing = productionByWorkstation.get(workstation.id);
    if (existing) {
      await updateProduction(existing.id, { remaining_pieces: pieces });
      if (existing.product_id !== product.id) {
        await updateProduction(existing.id, { product_id: product.id, product_code: product.code });
      }
    } else {
      await startProduction({
        shiftId: shiftQuery.data!.id,
        workstationId: workstation.id,
        productId: product.id,
        productCode: product.code,
        area: workstation.area === "TUP" ? "TUP" : "HA",
        remainingPieces: pieces,
      });
    }
    await invalidate();
  }

  const groups = useMemo(() => {
    const workstations = workstationsQuery.data ?? [];
    const assignmentsByWorkstation = new Map<string, { count: number; hasTemp: boolean }>();
    for (const a of assignmentsQuery.data ?? []) {
      if (!a.workstation_id) continue;
      const current = assignmentsByWorkstation.get(a.workstation_id) ?? { count: 0, hasTemp: false };
      current.count += 1;
      if (a.assignment_type === "temp") current.hasTemp = true;
      assignmentsByWorkstation.set(a.workstation_id, current);
    }

    const views: FloorMapWorkstationView[] = workstations.map((workstation) => {
      const production = productionByWorkstation.get(workstation.id);
      const assignment = assignmentsByWorkstation.get(workstation.id) ?? { count: 0, hasTemp: false };
      const profile = production ? profilesQuery.data?.get(production.product_code) : null;
      const capacity = profile ? (workstation.area === "TUP" ? profile.t_capacity : profile.h_capacity) : null;
      const norm = profile ? (workstation.area === "TUP" ? profile.t_norm_per_hour : profile.h_norm_per_hour) : null;
      let expectedCompletionLabel: string | null = null;
      if (production && capacity && norm && assignment.count > 0) {
        const eta = computeExpectedCompletion({
          shift,
          workDate,
          fromTime: nowHHMM(),
          remainingPieces: production.remaining_pieces,
          normPerHour: norm,
          designedCapacity: capacity,
          assignedOperators: assignment.count,
        });
        if (eta.status === "WILL_FINISH") expectedCompletionLabel = `Dokončení: ${new Date(eta.expectedCompletionAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
        if (eta.status === "WONT_FINISH") expectedCompletionLabel = "Výrobek se během této směny nevyrobí.";
      }
      const selectedProduct = production
        ? (production.product_id ? productById.get(production.product_id) : productByCode.get(production.product_code))
        : null;
      return {
        workstation,
        productCode: selectedProduct?.code ?? production?.product_code ?? null,
        remainingPieces: production?.remaining_pieces ?? null,
        designedCapacity: capacity,
        assignedCount: assignment.count,
        hasTemp: assignment.hasTemp,
        expectedCompletionLabel,
      };
    });
    const result = new Map<string, FloorMapWorkstationView[]>();
    for (const view of views) {
      const parentLine = normalizeParentLine(view.workstation.line_name, view.workstation.workplace_name);
      const list = result.get(parentLine) ?? [];
      list.push(view);
      result.set(parentLine, list);
    }
    for (const [parentLine, list] of result) {
      list.sort((a, b) => {
        const areaOrder = (a.workstation.area === "HA" ? 0 : 1) - (b.workstation.area === "HA" ? 0 : 1);
        return areaOrder || a.workstation.code.localeCompare(b.workstation.code, "cs");
      });
      result.set(parentLine, list);
    }
    return result;
  }, [workstationsQuery.data, productionByWorkstation, assignmentsQuery.data, profilesQuery.data, shift, workDate, productById, productByCode]);

  if (!canManage) {
    return <Panel className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Panel>;
  }

  return (
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Panel className="overflow-hidden">
          <PanelHeader icon={<Factory className="h-4 w-4" />} title="Výroba na lince" subtitle="Produkty se vybírají z aktivních a schválených produktů. Každá nadřazená linka obsahuje svá HA a TUP pracoviště." />
          <div className="divide-y divide-border/70">
            {[...groups.entries()].map(([parentLine, lineWorkstations]) => (
              <details key={parentLine} open={parentLine === [...groups.keys()][0]} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-border/70 bg-muted/10 px-4 py-3 sm:px-5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="iw-mono text-base font-bold text-foreground">{parentLine}</span>
                    <span className="text-xs text-muted-foreground">{lineWorkstations.length} pracovišť</span>
                  </span>
                  <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <div className="divide-y divide-border/60">
              const production = productionByWorkstation.get(workstation.id);
              const selectedProduct = production
                ? (production.product_id ? productById.get(production.product_id) : productByCode.get(production.product_code))
                : null;
              const storedDraft = drafts[workstation.id];
              const draft = storedDraft ?? {
                productId: selectedProduct?.id ?? "",
                code: selectedProduct?.code ?? production?.product_code ?? "",
                pieces: production ? String(production.remaining_pieces) : "",
              };
              const capacity = selectedProduct
                ? productCapacityFor({
                    area: workstation.area === "TUP" ? "TUP" : "HA",
                    h_capacity: profilesQuery.data?.get(selectedProduct.code)?.h_capacity ?? null,
                    t_capacity: profilesQuery.data?.get(selectedProduct.code)?.t_capacity ?? null,
                  })
                : null;

              return (
                <div key={workstation.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[110px_minmax(220px,1.25fr)_minmax(280px,2fr)_90px_auto] sm:items-center sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="iw-chip shrink-0">{workstation.area}</span>
                    <span className="iw-mono text-xs text-muted-foreground">{workstation.code}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="iw-mono break-words text-sm font-semibold leading-5 text-foreground/90">{workstation.workplace_name || workstation.display_name}</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{workstation.area === "TUP" ? "TouchUp" : "HandAssy"}</div>
                  </div>

                  <Popover open={openProductSelector === workstation.id} onOpenChange={(open) => setOpenProductSelector(open ? workstation.id : null)}>
                    <PopoverTrigger asChild>
                      <button type="button" className="iw-btn min-w-0 w-full items-center justify-between gap-2 text-left">
                        <span className="min-w-0 break-words">
                          {selectedProduct ? `${selectedProduct.code}${selectedProduct.name ? ` · ${selectedProduct.name}` : ""}` : "Vyber produkt"}
                        </span>
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Hledat kód nebo název produktu..." />
                        <CommandList>
                          <CommandEmpty>Žádný aktivní a schválený produkt.</CommandEmpty>
                          {products.map((product) => (
                            <CommandItem
                              key={product.id}
                              value={`${product.code} ${product.name ?? ""}`}
                              onSelect={() => {
                                setDrafts((d) => ({
                                  ...d,
                                  [workstation.id]: { productId: product.id, code: product.code, pieces: draft.pieces },
                                }));
                                setOpenProductSelector(null);
                              }}
                            >
                              <Check className={cn("h-4 w-4", draft.productId === product.id ? "opacity-100" : "opacity-0")} />
                              <div className="min-w-0">
                                <div className="truncate font-medium">{product.code}</div>
                                {product.name ? <div className="truncate text-xs text-muted-foreground">{product.name}</div> : null}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <input
                    value={draft.pieces}
                    onChange={(e) => setDrafts((d) => ({ ...d, [workstation.id]: { ...draft, pieces: e.target.value } }))}
                    placeholder="Ks"
                    inputMode="numeric"
                    aria-label="Zbývající kusy"
                  />

                  <button type="button" className="iw-btn" disabled={!draft.productId || !draft.pieces} onClick={() => void setProduction(workstation)}>
                    {production ? "Aktualizovat" : "Uložit"}
                  </button>

                  <div className="iw-mono min-w-0 text-[11px] text-muted-foreground">{capacity ? <span>Kapacita: {capacity}</span> : null}</div>
                </div>
              );
                ))}
                </div>
              </details>
            ))}
          </div>
        </Panel>

        <div className="iw-mono px-1 text-sm text-foreground/80">
          <span className="text-muted-foreground">Kapacita výroby (součet přes všechny aktivní linky):</span> <span className="font-semibold text-[hsl(152_65%_58%)]">{totalCapacity} operátorů</span>
        </div>

        <FloorMap groups={groups} />
      </div>
  );
}
