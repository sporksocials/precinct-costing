import type { RecipeLine } from "./types";

/**
 * Change detection for a draft that is saved later (the recipe editor). Pure, so it is tested without a browser.
 * "Dirty" means the draft differs from the last saved version in content, not in object identity: typing a value and
 * putting it back, or a refresh that hands over an equal copy, is never an unsaved change.
 */

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  venue_id: "Venue",
  category: "Category",
  section: "Menu Section",
  menu_group: "Menu Group",
  portions: "Serves",
  sell_price_inc: "Price",
  hh_price_inc: "Happy Hour Price",
  target_override: "Target GP",
  active: "Active",
  notes: "Notes",
  prep_type: "Type",
  yield_qty: "Batch Yield",
  yield_unit: "Batch Yield",
  allergen_add: "Allergens",
  allergen_remove: "Allergens",
  allergen_notes: "Allergens",
  dietary_labels: "Dietary Labels",
  diet_options: "Diet Options",
  dish_allergens: "Dish Allergens",
  seafood_label: "Seafood Label",
  glass: "Glass",
  method: "Method",
  garnish: "Garnish",
  bar_photo: "Photo",
  kitchen_method: "Method",
  kitchen_plating: "Plating",
  kitchen_photo: "Photo",
  kitchen_storage: "Storage",
  kitchen_ready: "Ready For Kitchen",
};

/** The label a field goes by in change lists ("Price", "Method"). Several fields can share one label. */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanise(key);
}

function humanise(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Content equality for the plain values a draft holds: null and undefined match, "2" matches 2, arrays and objects compare deeply. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a === b) return true;
  if (typeof a !== typeof b) {
    const na = typeof a === "string" && a.trim() !== "" ? Number(a) : a;
    const nb = typeof b === "string" && b.trim() !== "" ? Number(b) : b;
    return typeof na === "number" && typeof nb === "number" && Number.isFinite(na) && na === nb;
  }
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  const keys = new Set([...ka, ...kb]);
  for (const k of keys) if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** The fields whose content differs between the saved record and the draft. */
export function changedKeys<T extends object>(base: T, draft: T): (keyof T)[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(draft)]) as Set<keyof T>;
  return [...keys].filter((k) => !sameValue(base[k], draft[k]));
}

/** Only the changed fields, ready to send as an update. */
export function patchOf<T extends object>(base: T, draft: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of changedKeys(base, draft)) out[k] = draft[k];
  return out;
}

export interface LineChanges {
  added: number;
  removed: number;
  edited: number;
  /** only the order changed (nothing added, removed or edited) */
  reordered: boolean;
}

/** What makes two ingredient lines "the same": component, amount, unit and note (not the id or order). */
export function lineSig(l: RecipeLine) {
  return JSON.stringify([l.component_type, l.component_id, Number(l.qty) || 0, l.unit, l.note ?? null]);
}

/** Ingredient line changes by line id. Lines without a component are not saved, so they do not count. */
export function lineChanges(base: RecipeLine[], now: RecipeLine[]): LineChanges {
  const b = base.filter((l) => l.component_id);
  const n = now.filter((l) => l.component_id);
  const before = new Map(b.map((l) => [l.id, l]));
  const after = new Map(n.map((l) => [l.id, l]));
  let added = 0;
  let removed = 0;
  let edited = 0;
  for (const [id, l] of after) {
    const old = before.get(id);
    if (!old) added += 1;
    else if (lineSig(old) !== lineSig(l)) edited += 1;
  }
  for (const id of before.keys()) if (!after.has(id)) removed += 1;
  const order = (ls: RecipeLine[]) => ls.map((l) => l.id).join("|");
  const reordered = added + removed + edited === 0 && order(b) !== order(n);
  return { added, removed, edited, reordered };
}

export interface DraftChanges {
  /** how many things differ: changed fields (a shared label counts once) plus changed ingredient lines */
  count: number;
  dirty: boolean;
  fields: string[];
  lines: LineChanges;
  /** short plain-English parts for the "Discard N changes?" impact list */
  labels: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeChanges<T extends object>(base: T, draft: T, baseLines: RecipeLine[], lines: RecipeLine[]): DraftChanges {
  const keys = changedKeys(base, draft) as string[];
  const fieldLabels: string[] = [];
  for (const k of keys) {
    const label = fieldLabel(k);
    if (!fieldLabels.includes(label)) fieldLabels.push(label);
  }
  const lc = lineChanges(baseLines, lines);
  const lineLabels: string[] = [];
  if (lc.added) lineLabels.push(`${plural(lc.added, "Ingredient", "Ingredients")} Added`);
  if (lc.removed) lineLabels.push(`${plural(lc.removed, "Ingredient", "Ingredients")} Removed`);
  if (lc.edited) lineLabels.push(`${plural(lc.edited, "Ingredient", "Ingredients")} Changed`);
  if (lc.reordered) lineLabels.push("Ingredient Order");
  const count = fieldLabels.length + lc.added + lc.removed + lc.edited + (lc.reordered ? 1 : 0);
  return { count, dirty: count > 0, fields: keys, lines: lc, labels: [...fieldLabels, ...lineLabels] };
}
