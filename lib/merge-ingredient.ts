import { buildIndex, ingredientCostPerBase, unitBase } from "./costing";
import { withEffectivePrice } from "./deals";
import { ingredientTick, liveCheck, readDishAllergens, signOffState } from "./dish-allergens";
import { money } from "./format";
import { nameList } from "./record-usage";
import type { Beer, GelatoServeLine, Ingredient, IngredientDeal, LineUnit, MenuItem, Prep, RecipeLine } from "./types";

/**
 * Merge Into Another Ingredient (Troy, 23 Nov 2026). The same real product had been entered as several ingredients, and merging them
 * by hand in SQL made four signed-off dishes read "Not checked" on the Allergy Matrix, because a dish's allergen sign-off stores the
 * ids of its ingredients. This file is the PLAN: pure rules that say, before anything is written, what a merge would move, whether
 * it is allowed, what it does to recipe cost and which sign-offs survive. The write itself is one Postgres function,
 * `cost_merge_ingredient` (migration 20261123100000_merge_ingredient.sql), which follows exactly these rules in one transaction.
 *
 * SOURCE = the ingredient being merged away (it is kept, renamed "<name> (merged)" and made inactive, never deleted).
 * TARGET = the ingredient that is kept. Its price, allergens, diet flags and reviewed state are never changed.
 *
 * UNIT RULE (accuracy first): the two must be priced in the same kind of unit (weight, volume or count), and every recipe line
 * that would move must be in a unit the target can be costed in, by the same test lib/costing.ts uses for a line
 * (`unitBase(line.unit) === ingredient.pack_unit`). Nothing is ever converted between kinds (never kg to L).
 *
 * SIGN-OFFS: `dish_allergens.components` holds "ingredient:<id>" keys and `dish_allergens.ticks` a snapshot per ingredient
 * `{ a, r }` (lib/dish-allergens.ts). When source and target have the SAME snapshot entry, every stored sign-off is rewritten
 * (`carrySignOff`) so it stays valid and nobody re-confirms. When they differ, stored sign-offs are left alone and those dishes
 * correctly read "Re-check Needed".
 */

/** The message when the database function is not there yet. Nothing is written. */
export const MERGE_NOT_READY = "Merging is not switched on yet.";
export const MERGE_NO_UNDO = "This cannot be undone here. Every change is recorded in the Change Log.";
export const MERGE_ROW_TITLE = "Merge Into Another Ingredient";
export const MERGE_ROW_SUB = "Use when this is the same product as another ingredient";

const NAMES_MAX = 8;
const sourceKey = (id: string) => `ingredient:${id}`;

/** An ordering product linked to either ingredient (loaded by the sheet; the store does not hold ordering products). */
export interface MergeOrderProduct {
  id: string;
  venue_id: number;
  name: string;
  active: boolean;
  ingredient_id: string | null;
}

export interface MergeData {
  /** STORED recipe lines (store.lines), not the virtual gelato or tap beer lines */
  lines: readonly RecipeLine[];
  /** stored menu items (store.storedItems) */
  items: readonly MenuItem[];
  preps: readonly Prep[];
  ingredients: readonly Ingredient[];
  deals?: readonly IngredientDeal[] | null;
  beers?: readonly Pick<Beer, "id" | "name" | "ingredient_id">[] | null;
  gelatoServeLines?: readonly Pick<GelatoServeLine, "id" | "ingredient_id" | "unit">[] | null;
  /** null or absent = the order lists could not be read (the plan says so instead of guessing) */
  orderProducts?: readonly MergeOrderProduct[] | null;
  venues?: readonly { id: number; name: string }[] | null;
  gst: number;
  /** Brisbane date for deal costing (store.today) */
  today?: string;
}

export interface Named {
  id: string;
  name: string;
}

export interface MergePlan {
  /** plain reasons the merge is refused; empty = allowed */
  blockers: string[];
  canMerge: boolean;
  /** both are priced in the same kind of unit, and every line that moves can be costed */
  unitsCompatible: boolean;
  /** recipe lines that move */
  lineCount: number;
  /** the dishes, drinks and preps those lines are in, A to Z */
  recipes: Named[];
  /** "4 recipes will use Lime Juice (2L) instead: A, B, C and D." */
  recipesText: string;
  /** cost per base unit, ex GST, as recipes see it (deals, rebate and yield counted) */
  price: { source: number; target: number; change: number | null; text: string };
  /** source and target have the same allergen snapshot entry, so sign-offs are carried over */
  sameAllergens: boolean;
  /** confirmed dishes that stay confirmed */
  kept: Named[];
  /** confirmed dishes that will need a re-check */
  recheck: Named[];
  /** dishes that read Re-check Needed now and will count as confirmed again */
  restored: Named[];
  /** every other plain sentence of the impact step, in reading order */
  signOffText: string[];
  orderText: string[];
  otherText: string[];
  /** what happens to the ingredient being merged away */
  sourceText: string;
  counts: { orderItems: number; orderItemsStopped: number; dealsMoved: number; dealsLeft: number; beers: number; serveLines: number; optionAdds: number };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const sortNames = <T extends Named>(xs: T[]): T[] => xs.sort((a, b) => a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" }));

/** "$8.75 per L", "$0.50 each". A cost under ten cents shows four decimal places ("$0.0042 each"), so two different costs never read the same. */
export function perBaseText(cost: number, packUnit: string): string {
  const m = money(cost, cost > 0 && cost < 0.1 ? 4 : 2);
  return packUnit === "each" ? `${m} each` : `${m} per ${packUnit}`;
}

/** "Recipes will cost 4% more for this ingredient." Under one percent reads "less than 1%". */
function changeSentence(change: number): string {
  const pct = Math.abs(change) * 100;
  const amount = pct < 1 ? "less than 1%" : `${Math.round(pct)}%`;
  return `Recipes will cost ${amount} ${change > 0 ? "more" : "less"} for this ingredient.`;
}

/**
 * The costing packs in one order or invoice unit, restated for the target's pack: 12 one litre packs in a carton are 6 two litre
 * packs. Unchanged when the packs are the same size. Null (nobody has said) when there was none, or when the answer is not exact to
 * four decimal places, so a rounded pack count can never reach a price. The SQL function uses the same rule.
 */
export function scaledPacks(packs: number | null | undefined, sourcePackSize: number, targetPackSize: number): number | null {
  if (packs == null || !(Number(packs) > 0)) return null;
  const s = Number(sourcePackSize);
  const t = Number(targetPackSize);
  if (s === t) return Number(packs);
  if (!(s > 0) || !(t > 0)) return null;
  const exact = (Number(packs) * s) / t;
  const rounded = Math.round(exact * 10000) / 10000;
  return Math.abs(exact - rounded) < 1e-9 && rounded > 0 ? rounded : null;
}

/** Source and target mean the same thing to every stored sign-off: the same ticks (snapshot ids, fixed order) and the same reviewed flag. */
export function sameAllergenSnapshot(source: Pick<Ingredient, "allergens" | "allergens_reviewed">, target: Pick<Ingredient, "allergens" | "allergens_reviewed">): boolean {
  return JSON.stringify(ingredientTick(source)) === JSON.stringify(ingredientTick(target));
}

/**
 * One stored `dish_allergens` section with the source swapped for the target: "ingredient:<source>" becomes "ingredient:<target>" in
 * `components` (kept sorted and unique), and the source's `ticks` entry moves to the target's key (when the target already has an
 * entry, the source's is just dropped). Every other key is kept exactly as stored. Returns the SAME object when there is nothing to
 * change. Only ever applied when `sameAllergenSnapshot` is true. The SQL function does the same rewrite.
 */
export function carrySignOff(raw: unknown, sourceId: string, targetId: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const sk = sourceKey(sourceId);
  const tk = sourceKey(targetId);
  let next: Record<string, unknown> | null = null;
  if (Array.isArray(o.components) && o.components.includes(sk)) {
    const comps = [...new Set(o.components.map((c) => (c === sk ? tk : c)))];
    next = { ...(next ?? o), components: comps.every((c) => typeof c === "string") ? (comps as string[]).sort() : comps };
  }
  const ticks = o.ticks;
  if (ticks && typeof ticks === "object" && !Array.isArray(ticks) && sk in (ticks as Record<string, unknown>)) {
    const { [sk]: moved, ...rest } = ticks as Record<string, unknown>;
    next = { ...(next ?? o), ticks: tk in rest ? rest : { ...rest, [tk]: moved } };
  }
  return next ?? raw;
}

function costPerBase(ing: Ingredient, deals: readonly IngredientDeal[], gst: number, today?: string): number {
  return ingredientCostPerBase(withEffectivePrice(ing, deals as IngredientDeal[], today), gst);
}

/** Supplier deals move only when the kept ingredient has none of its own and both are the same pack, so a deal worked out per pack still means the same thing. */
export function dealsMove(source: Pick<Ingredient, "id" | "pack_size" | "pack_unit">, target: Pick<Ingredient, "id" | "pack_size" | "pack_unit">, deals: readonly Pick<IngredientDeal, "ingredient_id">[]): boolean {
  const mine = deals.some((d) => d.ingredient_id === source.id);
  const theirs = deals.some((d) => d.ingredient_id === target.id);
  return mine && !theirs && source.pack_unit === target.pack_unit && Number(source.pack_size) === Number(target.pack_size);
}

/** How many "added" entries of menu options point at this ingredient (they move too). */
function optionAddsOf(items: readonly MenuItem[], ingredientId: string): number {
  let n = 0;
  for (const it of items) {
    const opts = it.diet_options;
    if (!opts || typeof opts !== "object") continue;
    for (const entry of Object.values(opts as Record<string, unknown>)) {
      const added = entry && typeof entry === "object" ? (entry as { added?: unknown }).added : null;
      if (!Array.isArray(added)) continue;
      for (const a of added) if (a && typeof a === "object" && (a as { component_type?: unknown }).component_type === "ingredient" && (a as { component_id?: unknown }).component_id === ingredientId) n++;
    }
  }
  return n;
}

/** What merging `source` into `target` would do. Nothing is read from or written to the database. */
export function planMerge(source: Ingredient, target: Ingredient, data: MergeData): MergePlan {
  const deals = (data.deals ?? []) as IngredientDeal[];
  const blockers: string[] = [];
  const same = source.id === target.id;
  if (same) blockers.push("Pick a different ingredient to keep.");
  if (!same && target.active === false) blockers.push(`${target.name} is inactive. Make it active first, or keep a different ingredient.`);

  // ---- units
  const sameKind = unitBase(source.pack_unit as LineUnit) === unitBase(target.pack_unit as LineUnit) && source.pack_unit === target.pack_unit;
  if (!same && !sameKind) {
    blockers.push(`${source.name} is priced per ${source.pack_unit} and ${target.name} per ${target.pack_unit}. They are different kinds of unit, so they cannot be merged.`);
  }
  const moving = data.lines.filter((l) => l.component_type === "ingredient" && l.component_id === source.id);
  const serveLines = (data.gelatoServeLines ?? []).filter((l) => l.ingredient_id === source.id);
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const prepById = new Map(data.preps.map((p) => [p.id, p]));
  const parentOf = (l: RecipeLine): Named | null => {
    const p = l.parent_type === "item" ? itemById.get(l.parent_id) : prepById.get(l.parent_id);
    return p ? { id: `${l.parent_type}:${p.id}`, name: p.name } : null;
  };
  const uniqueParents = (ls: readonly RecipeLine[]): Named[] => {
    const seen = new Map<string, Named>();
    for (const l of ls) {
      const p = parentOf(l) ?? { id: `${l.parent_type}:${l.parent_id}`, name: "A recipe that could not be found" };
      if (!seen.has(p.id)) seen.set(p.id, p);
    }
    return sortNames([...seen.values()]);
  };
  let unitsCompatible = sameKind;
  if (!same && sameKind) {
    const bad = moving.filter((l) => unitBase(l.unit) !== target.pack_unit);
    const badServes = serveLines.filter((l) => unitBase(l.unit) !== target.pack_unit);
    if (bad.length || badServes.length) {
      unitsCompatible = false;
      const n = bad.length + badServes.length;
      const where = bad.length ? ` (${nameList(uniqueParents(bad), NAMES_MAX).text})` : "";
      blockers.push(`${plural(n, "recipe line")} ${n === 1 ? "uses" : "use"} a unit ${target.name} cannot be costed in${where}. Fix ${n === 1 ? "that line" : "those lines"} first.`);
    }
  }

  // ---- recipes
  const recipes = uniqueParents(moving);
  const recipesText = moving.length
    ? `${plural(recipes.length, "recipe")} will use ${target.name} instead: ${nameList(recipes, NAMES_MAX).text}.`
    : `${source.name} is not used in any recipe.`;

  // ---- price, as recipes see it
  const moveDeals = !same && dealsMove(source, target, deals);
  const sourceDeals = deals.filter((d) => d.ingredient_id === source.id);
  const dealsAfter = moveDeals ? sourceDeals.map((d) => ({ ...d, ingredient_id: target.id })) : deals.filter((d) => d.ingredient_id === target.id);
  const sCost = costPerBase(source, deals, data.gst, data.today);
  const tCost = costPerBase(target, dealsAfter, data.gst, data.today);
  const each = `${source.name} costs ${perBaseText(sCost, source.pack_unit)}. ${target.name} costs ${perBaseText(tCost, target.pack_unit)}.`;
  let change: number | null = null;
  let priceText: string;
  if (!sameKind) priceText = each;
  else if (!(sCost > 0) && !(tCost > 0)) priceText = `Neither ${source.name} nor ${target.name} has a price yet.`;
  else if (!(tCost > 0)) priceText = `${source.name} costs ${perBaseText(sCost, source.pack_unit)}. ${target.name} has no price yet, so recipes will cost nothing for this ingredient until it is priced.`;
  else if (!(sCost > 0)) priceText = `${source.name} has no price. ${target.name} costs ${perBaseText(tCost, target.pack_unit)}, so recipes will start costing that for this ingredient.`;
  else {
    change = (tCost - sCost) / sCost;
    // within a twentieth of a percent is no change
    const none = Math.abs(change) < 0.0005;
    if (none) change = 0;
    priceText = `${each} ${none ? "No cost change." : changeSentence(change)}`;
  }

  // ---- allergen sign-offs: simulate the merge and ask the app's own rule which stay valid
  const sameAllergens = sameAllergenSnapshot(source, target);
  const kept: Named[] = [];
  const recheck: Named[] = [];
  const restored: Named[] = [];
  if (!same) {
    const sk = sourceKey(source.id);
    const signed = data.items.filter((it) => {
      const da = readDishAllergens(it.dish_allergens);
      return !!da?.confirmedAt && !!da.components?.includes(sk);
    });
    if (signed.length) {
      const ings = data.ingredients as Ingredient[];
      const preps = data.preps as Prep[];
      const before = buildIndex(ings, preps, data.lines as RecipeLine[]);
      const afterLines = data.lines.map((l) => (l.component_type === "ingredient" && l.component_id === source.id ? { ...l, component_id: target.id } : l));
      const after = buildIndex(ings, preps, afterLines);
      for (const it of signed) {
        const was = signOffState(readDishAllergens(it.dish_allergens), liveCheck(it, before)) === "valid";
        const stored = sameAllergens ? carrySignOff(it.dish_allergens, source.id, target.id) : it.dish_allergens;
        const will = signOffState(readDishAllergens(stored), liveCheck(it, after)) === "valid";
        const row = { id: it.id, name: it.name };
        if (was && will) kept.push(row);
        else if (was) recheck.push(row);
        else if (will) restored.push(row);
      }
      sortNames(kept);
      sortNames(recheck);
      sortNames(restored);
    }
  }
  const signOffText: string[] = [];
  if (kept.length) signOffText.push(`${plural(kept.length, "confirmed dish", "confirmed dishes")} ${kept.length === 1 ? "keeps its" : "keep their"} allergen sign-off: ${nameList(kept, NAMES_MAX).text}.`);
  if (restored.length) signOffText.push(`${plural(restored.length, "dish", "dishes")} that ${restored.length === 1 ? "reads" : "read"} Re-check Needed will count as confirmed again: ${nameList(restored, NAMES_MAX).text}.`);
  if (recheck.length) {
    const why = sameAllergens ? "" : `${source.name} and ${target.name} do not have the same allergen ticks, so `;
    const sentence = `${plural(recheck.length, "confirmed dish", "confirmed dishes")} will need ${recheck.length === 1 ? "its" : "their"} allergens re-checked: ${nameList(recheck, NAMES_MAX).text}.`;
    signOffText.push(why ? `${why}${sentence}` : sentence);
  }

  // ---- order lists
  const orderText: string[] = [];
  let orderItems = 0;
  let orderItemsStopped = 0;
  const venueName = (id: number) => data.venues?.find((v) => v.id === id)?.name ?? "one venue";
  if (!same && data.orderProducts == null) orderText.push("The order lists could not be read. Any order list item linked to it moves too.");
  else if (!same && data.orderProducts) {
    const mine = data.orderProducts.filter((p) => p.ingredient_id === source.id);
    const theirs = data.orderProducts.filter((p) => p.ingredient_id === target.id && p.active);
    orderItems = mine.length;
    const stopped = mine.filter((p) => p.active && theirs.some((t) => t.venue_id === p.venue_id));
    orderItemsStopped = stopped.length;
    const carried = mine.filter((p) => !stopped.includes(p));
    if (carried.length) {
      const where = [...new Set(carried.map((p) => venueName(p.venue_id)))];
      orderText.push(`${plural(carried.length, "order list item")} ${carried.length === 1 ? "moves" : "move"} to ${target.name} (${where.join(", ")}).`);
      if (source.supplier_id !== target.supplier_id) orderText.push(`${carried.length === 1 ? "It" : "They"} will be ordered from the supplier of ${target.name}.`);
    }
    for (const p of stopped) orderText.push(`${venueName(p.venue_id)} already orders ${target.name}, so ${p.name} comes off its order list.`);
  }

  // ---- everything else that points at it
  const otherText: string[] = [];
  const dealsMoved = moveDeals ? sourceDeals.length : 0;
  const dealsLeft = moveDeals ? 0 : same ? 0 : sourceDeals.length;
  if (dealsMoved) otherText.push(`${plural(dealsMoved, "supplier deal")} ${dealsMoved === 1 ? "moves" : "move"} to ${target.name}.`);
  if (dealsLeft) otherText.push(`${plural(dealsLeft, "supplier deal")} on ${source.name} ${dealsLeft === 1 ? "is" : "are"} not moved and will stop applying. Add ${dealsLeft === 1 ? "it" : "them"} to ${target.name} if ${dealsLeft === 1 ? "it" : "they"} still ${dealsLeft === 1 ? "applies" : "apply"}.`);
  const beers = same ? [] : (data.beers ?? []).filter((b) => b.ingredient_id === source.id);
  if (beers.length) otherText.push(`${plural(beers.length, "tap beer")} will pour from ${target.name}: ${nameList(beers, NAMES_MAX).text}.`);
  if (!same && serveLines.length) otherText.push(`${plural(serveLines.length, "gelato serve line")} ${serveLines.length === 1 ? "moves" : "move"} too.`);
  const optionAdds = same ? 0 : optionAddsOf(data.items, source.id);
  if (optionAdds) otherText.push(`${plural(optionAdds, "menu option")} that ${optionAdds === 1 ? "adds" : "add"} it will add ${target.name} instead.`);
  if (!same) otherText.push(`Any invoice matches for ${source.name} will point at ${target.name} from now on.`);

  return {
    blockers,
    canMerge: blockers.length === 0,
    unitsCompatible,
    lineCount: moving.length,
    recipes,
    recipesText,
    price: { source: sCost, target: tCost, change, text: priceText },
    sameAllergens,
    kept,
    recheck,
    restored,
    signOffText,
    orderText,
    otherText,
    sourceText: `${source.name} is kept, renamed “${mergedName(source.name)}” and made inactive. Its price, allergens and price history stay as they are. The price and allergens of ${target.name} do not change.`,
    counts: { orderItems, orderItemsStopped, dealsMoved, dealsLeft, beers: beers.length, serveLines: serveLines.length, optionAdds },
  };
}

/* ------------------------------------------------------------------ the write's result */

export const MERGED_SUFFIX = " (merged)";
/** "<name> (merged)", the name the database gives the ingredient that was merged away (it adds a number when that name is taken). */
export const mergedName = (name: string): string => `${name.trim().slice(0, 120)}${MERGED_SUFFIX}`;

/** What `cost_merge_ingredient` returns. Every count is 0 when the reply does not carry it. */
export interface MergeResult {
  lines: number;
  recipes: number;
  orderItems: number;
  deals: number;
  invoiceMaps: number;
  signoffsCarried: number;
  signoffsLeft: number;
  /** the two had the same allergen snapshot, so stored sign-offs were rewritten */
  sameAllergens: boolean;
  /** the name the merged-away ingredient now has, when the reply carries it */
  mergedName: string | null;
}

export function parseMergeResult(raw: unknown): MergeResult {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const n = (k: string): number => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  };
  return {
    lines: n("lines"),
    recipes: n("recipes"),
    orderItems: n("order_items"),
    deals: n("deals"),
    invoiceMaps: n("invoice_maps"),
    signoffsCarried: n("signoffs_carried"),
    signoffsLeft: n("signoffs_left"),
    sameAllergens: o.same_allergens === true,
    mergedName: typeof o.merged_name === "string" && o.merged_name.trim() ? o.merged_name : null,
  };
}

/** "Merged into Lime Juice (2L). 4 recipes moved." */
export function mergedToast(targetName: string, r: Pick<MergeResult, "recipes">): string {
  return `Merged into ${targetName}. ${r.recipes === 0 ? "No recipes used it." : `${plural(r.recipes, "recipe")} moved.`}`;
}

/** The database function is not there (migration not applied yet, or a database that never had it). */
export function isMergeMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "PGRST202" || code === "42883") return true;
  const m = String(error.message ?? "").toLowerCase();
  return m.includes("cost_merge_ingredient") && (m.includes("could not find the function") || m.includes("does not exist") || m.includes("schema cache"));
}

/** The plain message for a failed merge. The function's own refusals are already plain words and pass through. */
export function mergeErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  if (isMergeMissing(error)) return MERGE_NOT_READY;
  const m = String(error?.message ?? "").trim();
  return m ? `${m.replace(/[.\s]+$/, "")}. Nothing was changed.` : "The merge did not go through. Nothing was changed.";
}
