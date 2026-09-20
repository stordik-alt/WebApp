import { rotationScore, type RotationRecord } from "./rotation";

export type EmployeeQualification = { id: string; qual_ha: boolean; qual_tup: boolean };

export type ProductionSlot = {
  productionId: string;
  workstationId: string;
  workstationCode: string;
  productCode: string | null;
  area: "HA" | "TUP";
  designedCapacity: number;
  priority: number | null;
  sortOrder: number;
};

export type SecondaryWorkstation = { id: string; code: string };

/** employeeId -> Set of workstation ids the employee is excluded from. */
export type RestrictionMap = Map<string, Set<string>>;

export type AssignmentType = "main" | "secondary" | "temp";

export type Assignment = {
  employeeId: string;
  workstationId: string | null;
  productionId: string | null;
  assignmentType: AssignmentType;
};

export type SuggestionResult = {
  assignments: Assignment[];
  /** productionId -> kolik operátorů chybí do designedCapacity (0 = plná kapacita). */
  shortfallByProduction: Map<string, number>;
  /** zůstali zcela bez umístění (přebytek, ale plně vyloučeni ze všech sekundárních pracovišť). */
  unassigned: string[];
};

/**
 * Implementuje pořadí rozhodování z dokumentu (sekce 12): kapacita -> kvalifikace
 * (tvrdé omezení) -> priorita TL -> přidělení do kapacity (0 lidí je platný
 * výsledek, nikdy neblokuje) -> rotace jako tiebreaker -> přebytek na TESTY/PREP.
 */
export function suggestAssignments(input: {
  rosterEmployeeIds: string[];
  tempEmployeeIds: string[];
  employees: EmployeeQualification[];
  productions: ProductionSlot[];
  secondaryWorkstations: SecondaryWorkstation[];
  restrictions: RestrictionMap;
  rotationHistory: RotationRecord[];
}): SuggestionResult {
  const employeesById = new Map(input.employees.map((e) => [e.id, e]));
  const tempSet = new Set(input.tempEmployeeIds);
  let pool = [...new Set([...input.rosterEmployeeIds, ...input.tempEmployeeIds])];

  const assignments: Assignment[] = [];
  const shortfallByProduction = new Map<string, number>();

  // # dělá: seřadí výroby podle priority TL (1 = nejvyšší); bez priority podle pořadí na mapě
  const orderedProductions = [...input.productions].sort((a, b) => {
    if (a.priority != null && b.priority != null) return a.priority - b.priority;
    if (a.priority != null) return -1;
    if (b.priority != null) return 1;
    return a.sortOrder - b.sortOrder;
  });

  for (const production of orderedProductions) {
    // # dělá: tvrdý filtr kvalifikace HA/TUP - nikdy neobcházený rotací ani prioritou
    const eligible = pool.filter((id) => {
      const employee = employeesById.get(id);
      if (!employee) return false;
      return production.area === "HA" ? employee.qual_ha : employee.qual_tup;
    });

    const selected: string[] = [];
    while (selected.length < production.designedCapacity) {
      const remaining = eligible.filter((id) => !selected.includes(id));
      if (remaining.length === 0) break;
      // # dělá: mezi zbylými kvalifikovanými kandidáty vybere nejméně "opakovaného" za poslední 3 dny
      const ranked = [...remaining].sort((a, b) => {
        const target = { workstationCode: production.workstationCode, productCode: production.productCode };
        const scoreDiff = rotationScore(a, target, input.rotationHistory, selected) - rotationScore(b, target, input.rotationHistory, selected);
        return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b);
      });
      selected.push(ranked[0]);
    }

    for (const employeeId of selected) {
      assignments.push({
        employeeId,
        workstationId: production.workstationId,
        productionId: production.productionId,
        assignmentType: tempSet.has(employeeId) ? "temp" : "main",
      });
      pool = pool.filter((id) => id !== employeeId);
    }

    const shortfall = production.designedCapacity - selected.length;
    // Nedostatek se vždy zaznamená, i 0 lidí je platný výsledek - proces se nikdy nepřeruší.
    shortfallByProduction.set(production.productionId, Math.max(0, shortfall));
  }

  // # dělá: přebytek operátorů rozdělí na TESTY/PREP (bez nutnosti HA/TUP), respektuje individuální omezení
  const unassigned: string[] = [];
  let secondaryCursor = 0;
  for (const employeeId of [...pool]) {
    const excluded = input.restrictions.get(employeeId);
    const eligibleSecondary = input.secondaryWorkstations.filter((w) => !excluded?.has(w.id));
    if (eligibleSecondary.length === 0) {
      unassigned.push(employeeId);
      continue;
    }
    const workstation = eligibleSecondary[secondaryCursor % eligibleSecondary.length];
    secondaryCursor += 1;
    assignments.push({
      employeeId,
      workstationId: workstation.id,
      productionId: null,
      assignmentType: tempSet.has(employeeId) ? "temp" : "secondary",
    });
  }

  return { assignments, shortfallByProduction, unassigned };
}
