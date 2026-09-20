/**
 * Interaktivní výběr výrob kliknutím: pořadí kliknutí = priorita (1 = první
 * klik = nejvyšší priorita). Klik na už vybranou výrobu ji z výběru odebere.
 */

// # dělá: přepne výrobu ve výběru (přidá na konec pořadí, nebo odebere, pokud už tam je)
export function toggleProductionSelection(currentOrder: string[], productionId: string): string[] {
  if (currentOrder.includes(productionId)) return currentOrder.filter((id) => id !== productionId);
  return [...currentOrder, productionId];
}

// # dělá: převede pořadí kliknutí na mapu productionId -> priorita (1-indexováno)
export function priorityMapFromOrder(order: string[]): Map<string, number> {
  return new Map(order.map((id, index) => [id, index + 1]));
}
