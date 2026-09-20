/**
 * Odlišuje "kapacitu produktu" (vlastnost jedné výroby) od "kapacity výroby"
 * (součet potřeb všech aktuálně vybraných výrob směny). Zdrojem obou je vždy
 * `product_profiles` (přes RPC `resolve_product_profile`) – tento modul nic
 * neukládá, jen počítá.
 */
export type ProfileCapacity = {
  area: "HA" | "TUP";
  h_capacity: number | null;
  t_capacity: number | null;
};

// # dělá: vrátí kapacitu PRODUKTU (kolik lidí je pro danou výrobu navrženo) podle strany HA/TUP
export function productCapacityFor(profile: ProfileCapacity): number | null {
  const raw = profile.area === "HA" ? profile.h_capacity : profile.t_capacity;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

// # dělá: sečte kapacitu produktu přes všechny aktuálně aktivní výroby směny = kapacita VÝROBY
export function productionCapacity(activeProductions: ProfileCapacity[]): number {
  return activeProductions.reduce((sum, production) => sum + (productCapacityFor(production) ?? 0), 0);
}
