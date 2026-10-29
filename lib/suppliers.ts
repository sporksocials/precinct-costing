import { tidyName } from "./name-tidy";

/** A supplier name as typed into "Add New Supplier": spaces tidied and capitals fixed the way every other name in the app is. */
export function cleanSupplierName(raw: string): string {
  return tidyName(raw);
}

/** Lower case with spaces, punctuation and a trailing "pty ltd" removed, so "Bidfood", "BIDFOOD" and "Bid Food Pty Ltd" read as one supplier. */
export function supplierKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|p\/l)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

/** The supplier already in the list that a typed name means, or undefined. */
export function findSupplier<T extends { name: string }>(suppliers: readonly T[], typed: string): T | undefined {
  const key = supplierKey(typed);
  if (!key) return undefined;
  return suppliers.find((s) => supplierKey(s.name) === key);
}

/* ------------------------------------------------------------------ one supplier list (Troy, 29 Oct 2026) */

/** A supplier is active unless it says otherwise (a database that predates the `active` column, or the demo data, has no flag). */
export const isSupplierActive = (s: { active?: boolean | null }): boolean => s.active !== false;

/**
 * The suppliers a pick-list may offer: every active supplier, plus the one the record already has even when it has been retired
 * (so an ingredient never shows a blank, and the person can still see who it is with). A to Z by name.
 */
export function supplierChoices<T extends { id: number; name: string; active?: boolean | null }>(all: readonly T[], currentId?: number | null): T[] {
  return all.filter((s) => isSupplierActive(s) || s.id === currentId).sort((a, b) => a.name.localeCompare(b.name));
}

/** The other supplier that already has this name, or null. Names compare ignoring capitals, spaces, punctuation and "Pty Ltd". */
export function supplierClash<T extends { id: number; name: string }>(name: string, suppliers: readonly T[], selfId: number): T | null {
  const key = supplierKey(name);
  if (!key) return null;
  return suppliers.find((s) => s.id !== selfId && supplierKey(s.name) === key) ?? null;
}

export const supplierClashMessage = (clash: { name: string }): string => `Another supplier is already called ${clash.name}. Pick a different name.`;

export interface SupplierSummary {
  id: number;
  name: string;
  active: boolean;
  /** ingredients (active and inactive) that name this supplier */
  ingredients: number;
  /** ACTIVE ingredients that name it: these block retiring the supplier */
  activeIngredients: number;
  /** names of the venues this supplier has an ordering terms row at, A to Z */
  venues: string[];
  /** an invoice supplier points at it */
  invoicesLinked: boolean;
}

/** One row per supplier for the Suppliers tab. Pure: the caller passes the rows it loaded. */
export function summariseSuppliers(input: {
  suppliers: readonly { id: number; name: string; active?: boolean | null }[];
  ingredients: readonly { supplier_id: number | null; active?: boolean | null }[];
  /** ordering_suppliers rows: which venue each supplier is ordered at */
  terms: readonly { cost_supplier_id: number; venue_id: number; active?: boolean | null }[];
  venueName: (venueId: number) => string | undefined;
  /** invoice_suppliers.cost_supplier_id values */
  invoiceLinks: readonly (number | null)[];
}): SupplierSummary[] {
  const all = new Map<number, number>();
  const live = new Map<number, number>();
  for (const i of input.ingredients) {
    if (i.supplier_id == null) continue;
    all.set(i.supplier_id, (all.get(i.supplier_id) ?? 0) + 1);
    if (i.active !== false) live.set(i.supplier_id, (live.get(i.supplier_id) ?? 0) + 1);
  }
  const venues = new Map<number, Set<string>>();
  for (const t of input.terms) {
    if (t.active === false) continue;
    const n = input.venueName(t.venue_id);
    if (!n) continue;
    let set = venues.get(t.cost_supplier_id);
    if (!set) venues.set(t.cost_supplier_id, (set = new Set()));
    set.add(n);
  }
  const linked = new Set(input.invoiceLinks.filter((x): x is number => x != null));
  return input.suppliers
    .map((s) => ({
      id: s.id,
      name: s.name,
      active: isSupplierActive(s),
      ingredients: all.get(s.id) ?? 0,
      activeIngredients: live.get(s.id) ?? 0,
      venues: [...(venues.get(s.id) ?? [])].sort((a, b) => a.localeCompare(b)),
      invoicesLinked: linked.has(s.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const ingredientCountText = (n: number): string => `${n} ${n === 1 ? "ingredient" : "ingredients"}`;

/** "Ordered at Drift and Chiobu" / "Not on any order list". */
export function orderedAtText(venues: readonly string[]): string {
  if (!venues.length) return "Not on any order list";
  if (venues.length === 1) return `Ordered at ${venues[0]}`;
  return `Ordered at ${venues.slice(0, -1).join(", ")} and ${venues[venues.length - 1]}`;
}

/** Why a supplier cannot be made inactive yet, or null. A supplier is retired by moving its items first. */
export function retireBlocker(activeIngredients: number): string | null {
  if (activeIngredients <= 0) return null;
  return `${ingredientCountText(activeIngredients)} still ${activeIngredients === 1 ? "uses" : "use"} this supplier. Move its items first.`;
}

/** The impact line shown before items move: "3 ingredients move to Star Liquor. They will move on every venue's order list." */
export function moveImpactText(count: number, targetName: string): string {
  return `${ingredientCountText(count)} ${count === 1 ? "moves" : "move"} to ${targetName}. ${count === 1 ? "It" : "They"} will move on every venue's order list.`;
}

/** The ingredients to move: those that have this supplier. Inactive ones move too, so nothing is left pointing at a retired supplier. */
export function ingredientsToMove<T extends { id: string; supplier_id: number | null }>(ingredients: readonly T[], fromId: number): T[] {
  return ingredients.filter((i) => i.supplier_id === fromId);
}
