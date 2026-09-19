import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import type { IwWorkstation } from "@/lib/floorMap";
import { deriveWorkstationStatus, StatusBadge } from "./StatusBadge";

export type FloorMapWorkstationView = {
  workstation: IwWorkstation;
  productCode: string | null;
  remainingPieces: number | null;
  designedCapacity: number | null;
  assignedCount: number;
  hasTemp: boolean;
  expectedCompletionLabel: string | null;
};

function WorkstationCard({ view }: { view: FloorMapWorkstationView }) {
  const status = deriveWorkstationStatus({
    designedCapacity: view.designedCapacity ?? 0,
    assignedCount: view.assignedCount,
    hasTemp: view.hasTemp,
    isSecondary: view.workstation.is_secondary,
  });
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{view.workstation.display_name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="text-xs text-muted-foreground">
        {view.productCode ? <div>Produkt: {view.productCode}</div> : null}
        {view.remainingPieces != null ? <div>Zbývá: {view.remainingPieces} ks</div> : null}
        <div>
          Operátoři: {view.assignedCount}
          {view.designedCapacity != null ? ` / ${view.designedCapacity}` : ""}
        </div>
        {view.expectedCompletionLabel ? <div>{view.expectedCompletionLabel}</div> : null}
      </div>
    </div>
  );
}

/**
 * Responzivní mapa haly: desktop plná topologie po skupinách, mobil skládací
 * akordeony (sekce 13 zadání - žádné pouhé zmenšení mapy na mobilu).
 */
export function FloorMap({ groups }: { groups: Map<string, FloorMapWorkstationView[]> }) {
  return (
    <>
      <div className="hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
        {[...groups.entries()].map(([groupName, views]) => (
          <Card key={groupName} className="p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{groupName}</h3>
            <div className="grid gap-2">
              {views.map((view) => (
                <WorkstationCard key={view.workstation.id} view={view} />
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Accordion type="multiple" className="grid gap-2 md:hidden">
        {[...groups.entries()].map(([groupName, views]) => (
          <AccordionItem key={groupName} value={groupName} className="rounded-xl border border-border/70 bg-card/60 px-3">
            <AccordionTrigger className="text-sm font-semibold">{groupName}</AccordionTrigger>
            <AccordionContent className="grid gap-2 pb-3">
              {views.map((view) => (
                <WorkstationCard key={view.workstation.id} view={view} />
              ))}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  );
}
