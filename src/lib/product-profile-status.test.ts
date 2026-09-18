import { describe, expect, it } from "vitest";
import { aggregateProfileStatus, resolvedProfileStatus } from "./product-profile-status";

// Regression test for the Master Prompt "V4014" bug: resolve_product_profile()
// (and its TS mirror, resolveOne() in import-v2-auto.ts) can find a real,
// complete Product Profile whose code has no matching row in `products` at
// all (match_source PROFILE_NO_PRODUCT). Before this fix, product_profile_status
// was computed from profile presence/completeness alone, so it read "VALID"
// for an item that also carried a PRODUCT_NOT_FOUND blocker and had no
// performance/availability/OEE - a contradictory, misleading state.
describe("resolvedProfileStatus", () => {
  it("is MISSING when no profile was found at all", () => {
    expect(resolvedProfileStatus(null)).toBe("MISSING");
    expect(resolvedProfileStatus({ profile_id: null, profile_complete: false, product_id: null })).toBe("MISSING");
  });

  it("is INCOMPLETE when the profile exists but lacks norm/capacity", () => {
    expect(resolvedProfileStatus({ profile_id: "p1", profile_complete: false, product_id: "prod1" })).toBe("INCOMPLETE");
  });

  it("V4014 regression: is INCOMPLETE (never VALID) when the profile is complete but no product row matched (PROFILE_NO_PRODUCT)", () => {
    expect(resolvedProfileStatus({ profile_id: "p1", profile_complete: true, product_id: null })).toBe("INCOMPLETE");
  });

  it("is VALID only when the profile is complete AND a product matched", () => {
    expect(resolvedProfileStatus({ profile_id: "p1", profile_complete: true, product_id: "prod1" })).toBe("VALID");
  });
});

describe("aggregateProfileStatus", () => {
  it("is MISSING for an empty list", () => {
    expect(aggregateProfileStatus([])).toBe("MISSING");
  });

  it("is MISSING when any detected code has no profile at all", () => {
    expect(aggregateProfileStatus([
      { hasProfile: true, profileComplete: true, hasProduct: true },
      { hasProfile: false, profileComplete: false, hasProduct: false },
    ])).toBe("MISSING");
  });

  it("V4014 regression: is INCOMPLETE (never VALID) when a profile is complete but its product is missing, even if other codes on the same screenshot are fully resolved", () => {
    expect(aggregateProfileStatus([
      { hasProfile: true, profileComplete: true, hasProduct: true },
      { hasProfile: true, profileComplete: true, hasProduct: false },
    ])).toBe("INCOMPLETE");
  });

  it("is INCOMPLETE when a profile exists but is missing norm/capacity", () => {
    expect(aggregateProfileStatus([{ hasProfile: true, profileComplete: false, hasProduct: true }])).toBe("INCOMPLETE");
  });

  it("is VALID only when every detected code has a complete profile and a matched product", () => {
    expect(aggregateProfileStatus([
      { hasProfile: true, profileComplete: true, hasProduct: true },
      { hasProfile: true, profileComplete: true, hasProduct: true },
    ])).toBe("VALID");
  });
});
