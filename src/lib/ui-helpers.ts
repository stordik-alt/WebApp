import React from "react";

export function applyNavActiveStyles() {
  // Helper to be used where nav items are rendered — keeps styling centralized
  return {
    active: "bg-surface-elevated shadow-sm",
    activeBar: "absolute left-0 top-2 bottom-2 w-1 rounded-r-md bg-gradient-to-b from-[var(--color-primary)] to-[var(--color-primary-600)]",
  };
}

export default function useUiHelpers() {
  return { applyNavActiveStyles };
}
