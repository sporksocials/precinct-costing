import { allergenLabel, type AllergenId } from "./allergens";
import type { DietMarkId, DietOptionId } from "./diet-legend";
import { isConfirmed, type DishAllergens } from "./dish-allergens";
import { compareGroups, groupLabel } from "./kitchen";

/**
 * The Allergy Matrix (Troy, 10 Oct 2026): the laminated A4 sheet each kitchen keeps for its dishes, built from the app's data.
 * Pure rules shared by the costing app, the printed sheet and the kitchen iPad. No React, no database, no money.
 *
 * NO GUESSING, NO OVERRIDES. A cell is read ONLY from the dish's own allergens section (lib/dish-allergens.ts), its hand-set
 * marks (GF, V, VG) and its options (GFO, VO, VGO, DFO). Nothing here looks at ingredients, roll-ups or keyword suggestions,
 * and there is no way to override a cell: a chef changes the dish in the recipe editor. `tests/allergy-matrix.test.ts` pins that.
 *
 * Four colours, each backed by a word and an icon so a black and white print still reads:
 *   red    "No"           cannot eat
 *   yellow "Swap"         must be substituted; the note says how
 *   green  "Yes"          can eat with no substitutions
 *   grey   "Not checked"  the dish has not been signed off
 */

export type MatrixState = "red" | "yellow" | "green" | "grey";

export const STATE_WORD: Record<MatrixState, string> = { red: "No", yellow: "Swap", green: "Yes", grey: "Not checked" };
/** one glyph per state for places that cannot draw an icon (plain text, the print file name); the screens draw real icons */
export const STATE_MARK: Record<MatrixState, string> = { red: "x", yellow: "!", green: "ok", grey: "?" };

export const MATRIX_LEGEND = "Red = cannot eat. Yellow = must be substituted, see the note. Green = can eat with no substitutions. Grey = not checked, ask the head chef.";
export const MATRIX_FOOTER_NOTE = "Confirm with the head chef if unsure";
export const SEE_CHEF = "See chef";

export type MatrixColumnId = "gluten_free" | "onion_garlic" | "dairy" | "seafood" | "chilli" | "eggs" | "nuts_seeds" | "vegetarian" | "vegan" | "sulphites" | "nitrites";

export interface MatrixColumn {
  id: MatrixColumnId;
  /** Title Case heading, Troy's wording */
  label: string;
  /** a short heading for chips on a phone */
  short: string;
  kind: "gluten" | "allergen" | "vegetarian" | "vegan";
  /** the dish allergens that fill this column (several can map into one) */
  allergens: readonly AllergenId[];
}

/** Troy's nine columns in his order, then Sulphites and Nitrites. */
export const MATRIX_COLUMNS: readonly MatrixColumn[] = [
  { id: "gluten_free", label: "Gluten Free", short: "GF", kind: "gluten", allergens: ["gluten"] },
  { id: "onion_garlic", label: "Onion And Garlic", short: "Onion", kind: "allergen", allergens: ["onion_garlic"] },
  { id: "dairy", label: "Dairy", short: "Dairy", kind: "allergen", allergens: ["milk"] },
  { id: "seafood", label: "Seafood", short: "Seafood", kind: "allergen", allergens: ["fish", "crustacea", "molluscs"] },
  { id: "chilli", label: "Chilli", short: "Chilli", kind: "allergen", allergens: ["chilli"] },
  { id: "eggs", label: "Eggs", short: "Eggs", kind: "allergen", allergens: ["egg"] },
  { id: "nuts_seeds", label: "Nuts And Seeds", short: "Nuts", kind: "allergen", allergens: ["peanuts", "tree_nuts", "sesame"] },
  { id: "vegetarian", label: "Vegetarian", short: "Veg", kind: "vegetarian", allergens: [] },
  { id: "vegan", label: "Vegan", short: "Vegan", kind: "vegan", allergens: [] },
  { id: "sulphites", label: "Sulphites", short: "Sulph", kind: "allergen", allergens: ["sulphites"] },
  { id: "nitrites", label: "Nitrites", short: "Nitr", kind: "allergen", allergens: ["nitrites"] },
];

export function matrixColumn(id: MatrixColumnId): MatrixColumn {
  return MATRIX_COLUMNS.find((c) => c.id === id) as MatrixColumn;
}
export function isMatrixColumnId(id: string): id is MatrixColumnId {
  return MATRIX_COLUMNS.some((c) => c.id === id);
}

/** Dish allergens a chef can tick that no matrix column covers (Troy's mapping leaves Soy and Lupin out). Shown beside the grid, never hidden. */
export const UNCOLUMNED_ALLERGENS: readonly AllergenId[] = (["soy", "lupin"] as const);

/** What a cell needs from a dish. The costing app and the kitchen parser each build one; the rules below never look past it. */
export interface MatrixDish {
  id: string;
  name: string;
  section: string | null;
  /** the dish's own allergens section; null = the dish has none */
  allergens: DishAllergens | null;
  /** the hand-set marks (GF, V, VG) */
  marks: readonly DietMarkId[];
  /** each option the dish offers, as its full wording ("Leave out X. Add Y. note"); an empty string = the option exists with no words */
  options: Partial<Record<DietOptionId, string>>;
  /** staff view only: the ingredients now list an allergen the dish section does not carry (a review prompt, never a cell change) */
  needsReview?: boolean;
}

export interface MatrixCell {
  state: MatrixState;
  /** yellow only: how it is substituted. Never empty on a yellow cell */
  note?: string;
  /** one plain sentence for the detail card: why the cell reads this way */
  why: string;
}

const has = (o: Partial<Record<DietOptionId, string>>, id: DietOptionId): boolean => Object.prototype.hasOwnProperty.call(o, id) && typeof o[id] === "string";
const words = (o: Partial<Record<DietOptionId, string>>, id: DietOptionId): string => (o[id] ?? "").trim() || SEE_CHEF;

function yellow(note: string | undefined, why: string): MatrixCell {
  return { state: "yellow", note: note?.trim() || SEE_CHEF, why };
}

/** One cell. Pure: the same dish and column always give the same answer. */
export function cell(dish: MatrixDish, columnId: MatrixColumnId): MatrixCell {
  const col = matrixColumn(columnId);
  const da = dish.allergens;
  const confirmed = isConfirmed(da);
  const marks = dish.marks;

  if (col.kind === "vegetarian") {
    if (marks.includes("v") || marks.includes("vg")) return { state: "green", why: marks.includes("vg") ? "Marked Vegan, which includes Vegetarian." : "Marked Vegetarian." };
    if (has(dish.options, "vo")) return yellow(words(dish.options, "vo"), "Vegetarian Option.");
    return { state: "red", why: "Not marked Vegetarian and no Vegetarian Option." };
  }
  if (col.kind === "vegan") {
    if (marks.includes("vg")) return { state: "green", why: "Marked Vegan." };
    if (has(dish.options, "vgo")) return yellow(words(dish.options, "vgo"), "Vegan Option.");
    return { state: "red", why: "Not marked Vegan and no Vegan Option." };
  }
  if (col.kind === "gluten") {
    if (marks.includes("gf")) return { state: "green", why: "Marked Gluten Free." };
    if (confirmed && da && !da.contains.includes("gluten")) return { state: "green", why: "Gluten is not listed on this dish." };
    if (has(dish.options, "gfo")) return yellow(words(dish.options, "gfo"), "Gluten Free Option.");
    if (confirmed && da && da.without.gluten) return yellow(da.without.gluten, "Can be made without gluten.");
    if (confirmed) return { state: "red", why: "Contains gluten." };
    return { state: "grey", why: "Not signed off yet." };
  }

  // an allergen column
  if (!confirmed || !da) return { state: "grey", why: "Not signed off yet." };
  const present = col.allergens.filter((id) => da.contains.includes(id));
  if (!present.length) return { state: "green", why: `${col.allergens.map(allergenLabel).join(", ")} ${col.allergens.length === 1 ? "is" : "are"} not listed on this dish.` };
  const notes: string[] = [];
  let unsolved = 0;
  for (const id of present) {
    // the only fallback is the Dairy Free Option for milk; every other allergen needs its own "can be made without" note
    const n = da.without[id] || (id === "milk" && has(dish.options, "dfo") ? words(dish.options, "dfo") : "");
    if (n) {
      if (!notes.includes(n)) notes.push(n);
    } else unsolved += 1;
  }
  const names = present.map(allergenLabel).join(", ");
  if (unsolved === 0) return yellow(notes.join("; "), `Contains ${names}, but it can be made without.`);
  return { state: "red", why: `Contains ${names}.` };
}

export interface MatrixRow {
  dish: MatrixDish;
  /** the dish has been signed off */
  confirmed: boolean;
  cells: Record<MatrixColumnId, MatrixCell>;
  needsReview: boolean;
  /** staff view only: contradictions between the hand-set marks and the dish's allergens (never changes a cell) */
  warnings: string[];
}

const MEAT_FISH: readonly AllergenId[] = ["fish", "crustacea", "molluscs"];

function warningsFor(dish: MatrixDish): string[] {
  const da = dish.allergens;
  if (!da || !isConfirmed(da)) return [];
  const out: string[] = [];
  if (dish.marks.includes("gf") && da.contains.includes("gluten")) out.push("Marked Gluten Free, but gluten is ticked under Dish Allergens.");
  if (dish.marks.includes("vg")) {
    const bad = (["milk", "egg", ...MEAT_FISH] as AllergenId[]).filter((id) => da.contains.includes(id));
    if (bad.length) out.push(`Marked Vegan, but ${bad.map(allergenLabel).join(", ")} ${bad.length === 1 ? "is" : "are"} ticked under Dish Allergens.`);
  } else if (dish.marks.includes("v")) {
    const bad = MEAT_FISH.filter((id) => da.contains.includes(id));
    if (bad.length) out.push(`Marked Vegetarian, but ${bad.map(allergenLabel).join(", ")} ${bad.length === 1 ? "is" : "are"} ticked under Dish Allergens.`);
  }
  return out;
}

export function buildRow(dish: MatrixDish): MatrixRow {
  const cells = Object.fromEntries(MATRIX_COLUMNS.map((c) => [c.id, cell(dish, c.id)])) as Record<MatrixColumnId, MatrixCell>;
  return { dish, confirmed: isConfirmed(dish.allergens), cells, needsReview: !!dish.needsReview, warnings: warningsFor(dish) };
}

export function buildRows(dishes: readonly MatrixDish[]): MatrixRow[] {
  return dishes.map(buildRow);
}

/* ------------------------------------------------------------------ sections, order, progress */

export interface MatrixSection {
  label: string;
  rows: MatrixRow[];
}

/** One matrix per section: sections in the kitchen's menu order (then alphabetical, "Other" last), dishes by name inside each. */
export function matrixSections(rows: readonly MatrixRow[]): MatrixSection[] {
  const by = new Map<string, MatrixRow[]>();
  for (const r of rows) {
    const label = groupLabel(r.dish.section);
    const arr = by.get(label);
    if (arr) arr.push(r);
    else by.set(label, [r]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => compareGroups(a, b))
    .map(([label, rs]) => ({ label, rows: [...rs].sort((a, b) => a.dish.name.localeCompare(b.dish.name)) }));
}

/** "28 of 41 dishes confirmed". */
export interface MatrixProgress {
  total: number;
  confirmed: number;
  /** dishes not signed off, in menu order */
  needing: MatrixRow[];
  /** signed-off dishes whose ingredients now list something the dish does not carry */
  review: MatrixRow[];
}

export function matrixProgress(rows: readonly MatrixRow[]): MatrixProgress {
  const ordered = matrixSections(rows).flatMap((s) => s.rows);
  return { total: rows.length, confirmed: rows.filter((r) => r.confirmed).length, needing: ordered.filter((r) => !r.confirmed), review: ordered.filter((r) => r.confirmed && r.needsReview) };
}

export function progressLine(p: Pick<MatrixProgress, "total" | "confirmed">): string {
  return `${p.confirmed} of ${p.total} ${p.total === 1 ? "dish" : "dishes"} confirmed`;
}

/* ------------------------------------------------------------------ guest needs (the kitchen iPad's column tap) */

export interface GuestEntry {
  row: MatrixRow;
  cell: MatrixCell;
}

export interface GuestNeeds {
  column: MatrixColumn;
  green: GuestEntry[];
  yellow: GuestEntry[];
  red: GuestEntry[];
  grey: GuestEntry[];
}

/** "What can a dairy free guest have": every dish sorted into Can Eat, Can Eat With Changes, Cannot Eat and Not Checked. Matrix order is kept. */
export function guestNeeds(rows: readonly MatrixRow[], columnId: MatrixColumnId): GuestNeeds {
  const out: GuestNeeds = { column: matrixColumn(columnId), green: [], yellow: [], red: [], grey: [] };
  for (const row of rows) out[row.cells[columnId].state].push({ row, cell: row.cells[columnId] });
  return out;
}

export const GUEST_GROUPS: readonly { key: MatrixState; title: string }[] = [
  { key: "green", title: "Can Eat" },
  { key: "yellow", title: "Can Eat With Changes" },
  { key: "red", title: "Cannot Eat" },
  { key: "grey", title: "Not Checked" },
];

/* ------------------------------------------------------------------ plain instructions (detail card) */

/** What a cook says to the guest for one cell, spelled out. */
export function instruction(c: MatrixCell): string {
  switch (c.state) {
    case "green":
      return `Yes. ${c.why}`;
    case "yellow":
      return `Only with a change: ${c.note ?? SEE_CHEF}`;
    case "red":
      return `No. ${c.why}`;
    default:
      return "Not checked. Ask the head chef before you answer a guest.";
  }
}

/** Dish allergens with no column on the sheet (Soy, Lupin). Listed in plain words on a detail card so they are never invisible. */
export function uncolumnedContains(da: DishAllergens | null): AllergenId[] {
  if (!da || !isConfirmed(da)) return [];
  return UNCOLUMNED_ALLERGENS.filter((id) => da.contains.includes(id));
}

const SIGNED_FORMAT = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" });

/** "10 Oct 2026" in Brisbane time, for "checked by the head chef on ...". Empty when the stamp is not a date. */
export function signedOffDate(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return "";
  const p = Object.fromEntries(SIGNED_FORMAT.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day} ${String(p.month).slice(0, 3)} ${p.year}`;
}
