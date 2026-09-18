export type ProductProfileStatus = "VALID" | "MISSING" | "INCOMPLETE";

/**
 * Computes product_profile_status from a resolve_product_profile() RPC row.
 *
 * Master Prompt "V4014" bug: resolve_product_profile() can return
 * match_source PROFILE_NO_PRODUCT - a real, complete Product Profile whose
 * code has no matching row in `products` at all. profile_id and
 * profile_complete are both truthy in that case, so a status computed from
 * those two alone reads VALID even though nothing downstream (KPIs,
 * approval) can actually be computed - the UI showed "Product Profile:
 * VALID" right next to a PRODUCT_NOT_FOUND blocker. VALID now requires a
 * matched product too.
 */
export function resolvedProfileStatus(resolved: { profile_id?: string | null; profile_complete?: boolean | null; product_id?: string | null } | null | undefined): ProductProfileStatus {
  if (!resolved?.profile_id) return "MISSING";
  if (!resolved.profile_complete || !resolved.product_id) return "INCOMPLETE";
  return "VALID";
}

/**
 * Same rule, aggregated across every product code detected on a screenshot
 * (persistOcrResult() in import-v2-auto.ts resolves possibly more than one
 * product per import). VALID only when every detected code has both a
 * complete profile AND a matched product.
 */
export function aggregateProfileStatus(states: Array<{ hasProfile: boolean; profileComplete: boolean; hasProduct: boolean }>): ProductProfileStatus {
  if (!states.length) return "MISSING";
  if (states.some((x) => !x.hasProfile)) return "MISSING";
  if (states.some((x) => !x.profileComplete || !x.hasProduct)) return "INCOMPLETE";
  return "VALID";
}
