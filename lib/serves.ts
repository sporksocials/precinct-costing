/**
 * "One Serve" or "Multiple Serves": how a recipe's `portions` is chosen. Every item makes ONE serve by default and the
 * number stays hidden; only a recipe that makes several (a slice tray, a pitcher) shows "Serves From This Recipe".
 * Costing is untouched (lib/costing.ts: cost per serve = recipe cost / portions); this only decides what the editor
 * shows and what number gets stored. Pure and framework free.
 */
import { money } from "./format";

export type ServesMode = "one" | "multiple";

/** The smallest number a "Multiple Serves" recipe can make. */
export const MIN_MULTIPLE_SERVES = 2;

/** Anything other than a positive number that is not 1 counts as multiple, so a stored 0.5 is shown honestly rather than hidden. Blank, 0 and 1 are One Serve. */
export function servesMode(portions: number | string | null | undefined): ServesMode {
  const n = Number(portions);
  return Number.isFinite(n) && n > 0 && n !== 1 ? "multiple" : "one";
}

/** The portions to store when the choice changes: One Serve is always 1; Multiple keeps a valid number already there, else starts at the minimum. */
export function portionsForMode(mode: ServesMode, current: number | string | null | undefined): number {
  if (mode === "one") return 1;
  const n = Number(current);
  return Number.isFinite(n) && n >= MIN_MULTIPLE_SERVES ? n : MIN_MULTIPLE_SERVES;
}

/** Reads the typed "Serves From This Recipe" number. Not a number returns null; below the minimum is lifted to it; 3 decimals at most. */
export function parseServeCount(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_MULTIPLE_SERVES, Math.round(n * 1000) / 1000);
}

/** Cost for one serve: recipe cost over portions (a blank, 0 or negative count is costed as 1, as lib/costing.ts does). */
export function costPerServe(recipeCost: number, portions: number | string | null | undefined): number {
  const n = Number(portions);
  return recipeCost / (n > 0 ? n : 1);
}

/**
 * The one-line impact note for switching Multiple Serves to One Serve: "Cost per serve will become $X". Null when
 * the switch changes nothing (already one serve, or a recipe that costs $0).
 */
export function switchToOneNote(recipeCost: number, portions: number | string | null | undefined): string | null {
  if (!(recipeCost > 0)) return null;
  const before = costPerServe(recipeCost, portions);
  if (Math.abs(before - recipeCost) < 0.005) return null;
  return `Cost per serve will become ${money(recipeCost)}`;
}
