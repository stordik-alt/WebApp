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
    <div className={`iw-panel iw-panel-live iw-motion-enter ${status === "full" ? "iw-motion-live" : ""} rounded-lg p-3 ${STATUS_CLASS[status]}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="iw-mono truncate text-xs font-semibold text-foreground">{view.workstation.display_name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="iw-mono space-y-0.5 text-[11px] text-muted-foreground">
        {view.productCode ? <div>PRODUKT · {view.productCode}</div> : null}
        {view.remainingPieces != null ? <div>ZBÝVÁ · {view.remainingPieces} ks</div> : null}
        <div>
          OPERÁTOŘI · {view.assignedCount}
          {view.designedCapacity != null ? ` / ${view.designedCapacity}` : ""}
        </div>
        {view.expectedCompletionLabel ? <div className="text-foreground/70">{view.expectedCompletionLabel}</div> : null}
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
  const entries = [...groups.entries()];
  const leftGroups = entries.filter(([name]) => /delta|linka\s*1|ha\s*1/i.test(name));
  const rightGroups = entries.filter(([name]) => !leftGroups.some(([n]) => n === name));

  const renderGroup = ([groupName, views]: [string, FloorMapWorkstationView[]]) => (
    <section key={groupName} className="iw-hall-zone">
      <div className="iw-hall-zone-title">
        <span>{groupName}</span>
        <span className="iw-hall-zone-count">{views.length} prac.</span>
      </div>
      <div className="iw-hall-stations">
        {views.map((view) => <WorkstationCard key={view.workstation.id} view={view} />)}
      </div>
    </section>
  );

  return (
    <div className="iw-hall-map" aria-label="Vizualizace výrobní haly">
      <div className="iw-hall-header">
        <div>
          <div className="iw-label">FLOOR PLAN / LIVE PRODUCTION</div>
          <div className="iw-hall-title">Výrobní hala</div>
        </div>
        <div className="iw-hall-legend">
          <span><i className="iw-legend-dot iw-legend-live" /> Výroba</span>
          <span><i className="iw-legend-dot iw-legend-warn" /> Snížená kapacita</span>
          <span><i className="iw-legend-dot iw-legend-off" /> Bez operátora</span>
        </div>
      </div>

      <div className="iw-hall-floor">
        <div className="iw-hall-lane iw-hall-lane-one">
          <div className="iw-hall-lane-label">LINKA 1</div>
          <div className="iw-hall-flow iw-motion-flow" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <div className="iw-hall-machine iw-hall-ersa">ERSA</div>
          <div className="iw-hall-lane-groups">{leftGroups.map(renderGroup)}</div>
        </div>

        <div className="iw-hall-center">
          <div className="iw-hall-center-line" />
          <div className="iw-hall-center-node">HA<br /><span>→ TUP</span></div>
          <div className="iw-hall-center-line" />
        </div>

        <div className="iw-hall-lane iw-hall-lane-two">
          <div className="iw-hall-lane-label">LINKA 2</div>
          <div className="iw-hall-lane-groups">{rightGroups.map(renderGroup)}</div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="iw-hall-empty">Mapa čeká na konfiguraci pracovišť.</div>
      ) : null}

      <div className="md:hidden">
        <Accordion type="multiple" className="grid gap-2">
          {entries.map(([groupName, views]) => (
            <AccordionItem key={groupName} value={groupName} className="iw-panel rounded-lg border-0 px-3">
              <AccordionTrigger className="iw-label py-3 hover:no-underline">{groupName}</AccordionTrigger>
              <AccordionContent className="grid gap-2 pb-3">
                {views.map((view) => <WorkstationCard key={view.workstation.id} view={view} />)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
