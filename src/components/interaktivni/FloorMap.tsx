import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { IwWorkstation } from "@/lib/floorMap";
import { Panel } from "./Panel";
import { deriveWorkstationStatus, StatusBadge } from "./StatusBadge";
import "./interaktivni.css";

export type FloorMapWorkstationView = {
  workstation: IwWorkstation;
  productCode: string | null;
  remainingPieces: number | null;
  designedCapacity: number | null;
  assignedCount: number;
  hasTemp: boolean;
  expectedCompletionLabel: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  full: "iw-status-full",
  under_capacity: "iw-status-under",
  no_operator: "iw-status-none",
  temp: "iw-status-temp",
  secondary: "iw-status-secondary",
};

function WorkstationCard({ view }: { view: FloorMapWorkstationView }) {
  const status = deriveWorkstationStatus({
    designedCapacity: view.designedCapacity ?? 0,
    assignedCount: view.assignedCount,
    hasTemp: view.hasTemp,
    isSecondary: view.workstation.is_secondary,
  });
  const ratio = view.designedCapacity ? Math.min(1, view.assignedCount / view.designedCapacity) : view.assignedCount > 0 ? 1 : 0;

  return (
    <div className={`iw-panel iw-panel-live rounded-lg p-3 ${STATUS_CLASS[status]}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="iw-mono truncate text-xs font-semibold text-white/90">{view.workstation.display_name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="iw-mono space-y-0.5 text-[11px] text-white/50">
        {view.productCode ? <div>PRODUKT · {view.productCode}</div> : null}
        {view.remainingPieces != null ? <div>ZBÝVÁ · {view.remainingPieces} ks</div> : null}
        <div>
          OPERÁTOŘI · {view.assignedCount}
          {view.designedCapacity != null ? ` / ${view.designedCapacity}` : ""}
        </div>
        {view.expectedCompletionLabel ? <div className="text-white/70">{view.expectedCompletionLabel}</div> : null}
      </div>
      {!view.workstation.is_secondary ? (
        <div className="iw-capacity-track mt-2">
          <div className="iw-capacity-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      ) : null}
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
          <Panel key={groupName} className="p-4">
            <h3 className="iw-label mb-3">{groupName}</h3>
            <div className="grid gap-2">
              {views.map((view) => (
                <WorkstationCard key={view.workstation.id} view={view} />
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <Accordion type="multiple" className="grid gap-2 md:hidden">
        {[...groups.entries()].map(([groupName, views]) => (
          <AccordionItem key={groupName} value={groupName} className="iw-panel rounded-lg border-0 px-3">
            <AccordionTrigger className="iw-label py-3 hover:no-underline">{groupName}</AccordionTrigger>
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
