import { buildIndex, costItem, ingredientExGstPackPrice, parsePackFromUom, priceMovePct, type ItemCost, type PrepCost } from "./costing";
import type { CostingSettings, Ingredient, MenuItem, PortalPrice, Prep, PriceLog, RecipeLine, Target } from "./types";
import { parseVirtualItemId } from "./gelato";
import { parseBeerItemId } from "./beer";

export const FOOD_CATEGORIES = new Set(["Food"]);
export const DRINK_CATEGORIES = new Set(["Cocktail", "Mocktail", "Tap Beer", "Packaged Beer & Cider", "Wine", "Spirits", "RTD"]);

/** Kinds of Today-feed entries. 'check_cost' and 'happy_hour' are new; the rest are unchanged. */
export type FeedKind = "price_rise" | "below_target" | "stale_price" | "catalogue_gap" | "check_cost" | "happy_hour";

export interface GpSummary {
  /** simple average of item GP% across active priced items (every item counts equally) */
  avg: number | null;
  count: number;
  food: number | null;
  drinks: number | null;
  /** active priced items left out of the averages because their cost needs checking (ItemCost.needsCheck) */
  excluded: number;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

export function gpSummary(costs: Iterable<ItemCost>, venueId?: number | null): GpSummary {
  const all: number[] = [];
  const food: number[] = [];
  const drinks: number[] = [];
  let excluded = 0;
  for (const c of costs) {
    if (!c.item.active || c.gpPct == null) continue;
    if (venueId != null && c.item.venue_id !== venueId) continue;
    // DECISION: items with cost warnings (zero-cost line, no lines, GP > 92%...) are excluded from
    // headline averages rather than counted at a fake ~100% GP; they are counted in `excluded`.
    if (c.needsCheck) {
      excluded += 1;
      continue;
    }
    all.push(c.gpPct);
    if (FOOD_CATEGORIES.has(c.item.category)) food.push(c.gpPct);
    else if (DRINK_CATEGORIES.has(c.item.category)) drinks.push(c.gpPct);
  }
  return { avg: mean(all), count: all.length, food: mean(food), drinks: mean(drinks), excluded };
}

/** Active items under target, worst gap first. */
export function underTarget(costs: Iterable<ItemCost>, venueId?: number | null): ItemCost[] {
  const out: ItemCost[] = [];
  for (const c of costs) {
    if (!c.item.active || !c.underTarget) continue;
    if (venueId != null && c.item.venue_id !== venueId) continue;
    out.push(c);
  }
  return out.sort((a, b) => (a.gpPct ?? 0) - a.targetGp - ((b.gpPct ?? 0) - b.targetGp));
}

export interface CheckCostRow {
  kind: "check_cost";
  cost: ItemCost;
  warnings: string[];
}

/** Active items whose cost looks untrustworthy (feed kind 'check_cost'), most warnings first. Virtual items included. */
export function checkCostRows(costs: Iterable<ItemCost>, venueId?: number | null): CheckCostRow[] {
  const out: CheckCostRow[] = [];
  for (const c of costs) {
    if (!c.item.active || !c.needsCheck) continue;
    if (venueId != null && c.item.venue_id !== venueId) continue;
    out.push({ kind: "check_cost", cost: c, warnings: c.costWarnings });
  }
  return out.sort((a, b) => b.warnings.length - a.warnings.length || a.cost.item.name.localeCompare(b.cost.item.name));
}

export interface CheckCostGroup {
  id: string;
  /** what the row is called */
  name: string;
  /** where tapping it goes */
  href: string;
  warnings: string[];
  /** computed items folded into this row (1 for a normal item) */
  count: number;
  venueId: number;
}

/**
 * Display rows for the Check Cost feed: a normal item is its own row; a tap beer's serves fold
 * into one row per beer (tap goes to the beer); gelato serves that share the same warnings fold
 * into one row (tap goes to Gelato), so a bad mix or packaging line is one row, not one per flavour.
 */
export function checkCostGroups(rows: CheckCostRow[]): CheckCostGroup[] {
  const out: CheckCostGroup[] = [];
  const byKey = new Map<string, CheckCostGroup>();
  for (const r of rows) {
    const it = r.cost.item;
    const b = parseBeerItemId(it.id);
    const g = parseVirtualItemId(it.id);
    if (!b && !g) {
      out.push({ id: it.id, name: it.name, href: `/items/${it.id}`, warnings: r.warnings, count: 1, venueId: it.venue_id });
      continue;
    }
    const key = b ? `beer:${b.beerId}` : `gelato:${r.warnings.join("|")}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.count += 1;
      continue;
    }
    const grp: CheckCostGroup = b
      ? { id: key, name: it.name.split(" - ")[0], href: `/beers/${b.beerId}`, warnings: r.warnings, count: 1, venueId: it.venue_id }
      : { id: key, name: it.name, href: `/items/${it.id}`, warnings: r.warnings, count: 1, venueId: it.venue_id };
    byKey.set(key, grp);
    out.push(grp);
  }
  for (const grp of out) {
    if (grp.count > 1 && grp.id.startsWith("gelato:")) {
      grp.name = `${grp.count} gelato serves`;
      grp.href = "/gelato";
    }
  }
  return out;
}

export interface HappyHourRow {
  kind: "happy_hour";
  cost: ItemCost;
  hhPrice: number;
  hhGpPct: number;
  /** true when the happy-hour price is below cost (a loss), not just below target */
  belowCost: boolean;
}

/** Active items with a happy-hour price under the same target (feed kind 'happy_hour'), below-cost first, then worst GP. */
export function happyHourRows(costs: Iterable<ItemCost>, venueId?: number | null): HappyHourRow[] {
  const out: HappyHourRow[] = [];
  for (const c of costs) {
    if (!c.item.active || c.hhSellInc == null || c.hhGpPct == null) continue;
    if (!c.hhUnderTarget && !c.hhBelowCost) continue;
    if (venueId != null && c.item.venue_id !== venueId) continue;
    out.push({ kind: "happy_hour", cost: c, hhPrice: c.hhSellInc, hhGpPct: c.hhGpPct, belowCost: c.hhBelowCost });
  }
  return out.sort((a, b) => Number(b.belowCost) - Number(a.belowCost) || a.hhGpPct - b.hhGpPct);
}

export interface UnderRow {
  cost: ItemCost;
  /** for gelato: how many flavours are under target in this serve (the row shows the worst one) */
  flavours: number;
}

/**
 * Under-target list for display: gelato flavour × serve rows are folded into one row per serve
 * (its worst flavour), so a serve priced too low shows once, not once per flavour.
 */
export function underTargetRows(costs: Iterable<ItemCost>, venueId?: number | null): UnderRow[] {
  const out: UnderRow[] = [];
  const byServe = new Map<string, UnderRow>();
  for (const c of underTarget(costs, venueId)) {
    const v = parseVirtualItemId(c.item.id);
    if (!v) {
      out.push({ cost: c, flavours: 1 });
      continue;
    }
    const cur = byServe.get(v.serveId);
    if (cur) cur.flavours += 1;
    else {
      const row = { cost: c, flavours: 1 };
      byServe.set(v.serveId, row);
      out.push(row);
    }
  }
  return out;
}

/** Recipe key for counting: every serve of one gelato flavour counts as that one flavour. */
function recipeKey(itemId: string): string {
  const v = parseVirtualItemId(itemId);
  if (v) return `gelato:${v.prepId}`;
  const b = parseBeerItemId(itemId);
  return b ? `beer:${b.beerId}` : itemId;
}

/** Menu items that use a component directly or through any depth of preps. */
export function itemsUsing(componentType: "ingredient" | "prep", componentId: string, lines: RecipeLine[]): Set<string> {
  const byComponent = new Map<string, RecipeLine[]>();
  for (const l of lines) {
    const k = `${l.component_type}:${l.component_id}`;
    const arr = byComponent.get(k);
    if (arr) arr.push(l);
    else byComponent.set(k, [l]);
  }
  const items = new Set<string>();
  const seenPreps = new Set<string>();
  const stack: string[] = [`${componentType}:${componentId}`];
  while (stack.length) {
    const k = stack.pop()!;
    for (const l of byComponent.get(k) ?? []) {
      if (l.parent_type === "item") items.add(l.parent_id);
      else if (!seenPreps.has(l.parent_id)) {
        seenPreps.add(l.parent_id);
        stack.push(`prep:${l.parent_id}`);
      }
    }
  }
  return items;
}

export interface PriceIncrease {
  ingredient: Ingredient;
  log: PriceLog;
  movePct: number;
  delta: number;
  recipeCount: number;
  impact: number;
  /** affected recipes that are now below target (needs itemCosts) */
  underCount: number;
}

/** Ingredients whose latest logged move in `days` is an increase above `alertPct`, ranked by $ delta × recipes using it. */
export function priceIncreases(
  logs: PriceLog[],
  ingredients: Map<string, Ingredient>,
  lines: RecipeLine[],
  items: Map<string, MenuItem>,
  alertPct: number,
  venueId?: number | null,
  days = 30,
  itemCosts?: Map<string, ItemCost>,
): PriceIncrease[] {
  const since = Date.now() - days * 86_400_000;
  const latest = new Map<string, PriceLog>();
  for (const l of logs) {
    const t = new Date(l.changed_at).getTime();
    if (Number.isNaN(t) || t < since || l.old_price == null) continue;
    const cur = latest.get(l.ingredient_id);
    if (!cur || new Date(cur.changed_at).getTime() < t) latest.set(l.ingredient_id, l);
  }
  const out: PriceIncrease[] = [];
  for (const [id, log] of latest) {
    const ing = ingredients.get(id);
    if (!ing) continue;
    const m = priceMovePct(log.old_price, log.new_price);
    if (m == null || m <= alertPct) continue;
    let used = [...itemsUsing("ingredient", id, lines)].map((i) => items.get(i)).filter((x): x is MenuItem => !!x && x.active);
    if (venueId != null) {
      used = used.filter((i) => i.venue_id === venueId);
      if (!used.length) continue;
    }
    const delta = Number(log.new_price) - Number(log.old_price);
    const recipes = new Set(used.map((i) => recipeKey(i.id))).size;
    const underCount = itemCosts ? new Set(used.filter((i) => itemCosts.get(i.id)?.underTarget).map((i) => recipeKey(i.id))).size : 0;
    out.push({ ingredient: ing, log, movePct: m, delta, recipeCount: recipes, impact: delta * Math.max(recipes, 0.01), underCount });
  }
  return out.sort((a, b) => b.impact - a.impact);
}

export interface ImpactRow {
  item: MenuItem;
  before: ItemCost;
  after: ItemCost;
}

/** Before/after costing of every menu item affected by patching one ingredient. */
export function ingredientChangeImpact(
  ingredientId: string,
  patch: Partial<Ingredient>,
  data: { ingredients: Ingredient[]; preps: Prep[]; lines: RecipeLine[]; items: MenuItem[]; settings: CostingSettings; targets: Target[] },
): ImpactRow[] {
  const affected = itemsUsing("ingredient", ingredientId, data.lines);
  if (!affected.size) return [];
  const beforeIdx = buildIndex(data.ingredients, data.preps, data.lines);
  const afterIdx = buildIndex(
    data.ingredients.map((i) => (i.id === ingredientId ? { ...i, ...patch } : i)),
    data.preps,
    data.lines,
  );
  const cb = new Map<string, PrepCost>();
  const ca = new Map<string, PrepCost>();
  const rows: ImpactRow[] = [];
  for (const it of data.items) {
    if (!affected.has(it.id)) continue;
    rows.push({ item: it, before: costItem(it, beforeIdx, data.settings, data.targets, cb), after: costItem(it, afterIdx, data.settings, data.targets, ca) });
  }
  return rows.sort((a, b) => (a.after.gpPct ?? 1) - (a.before.gpPct ?? 1) - ((b.after.gpPct ?? 1) - (b.before.gpPct ?? 1)));
}

/** Ids of ingredients used by any recipe line (directly; preps count as users). */
export function ingredientsInUse(lines: RecipeLine[]): Set<string> {
  const s = new Set<string>();
  for (const l of lines) if (l.component_type === "ingredient") s.add(l.component_id);
  return s;
}

/** In-use ingredients whose price hasn't been confirmed in `days` (or ever). */
export function staleIngredients(ingredients: Ingredient[], inUse: Set<string>, days = 90): Ingredient[] {
  const cutoff = Date.now() - days * 86_400_000;
  return ingredients.filter((i) => {
    if (!i.active || !inUse.has(i.id)) return false;
    const t = i.last_price_update ? new Date(i.last_price_update).getTime() : NaN;
    return Number.isNaN(t) || t < cutoff;
  });
}

export interface CatalogueGap {
  ingredient: Ingredient;
  portal: PortalPrice;
  /** ex-GST price per base unit (kg / L / each) */
  ours: number;
  theirs: number;
  /** theirs vs ours, e.g. 0.12 = the catalogue is 12% dearer */
  diffPct: number;
}

/** Ingredients linked to a supplier catalogue product (same code) whose price per unit differs by more than `tolerance`. */
export function catalogueGaps(ingredients: Ingredient[], portal: PortalPrice[] | null, gst: number, tolerance = 0.02): CatalogueGap[] {
  if (!portal?.length) return [];
  const byCode = new Map<string, PortalPrice>();
  for (const p of portal) if (p.product_code && p.price != null) byCode.set(p.product_code.trim().toLowerCase(), p);
  const out: CatalogueGap[] = [];
  for (const i of ingredients) {
    if (!i.active || !i.supplier_code) continue;
    const p = byCode.get(i.supplier_code.trim().toLowerCase());
    if (!p) continue;
    const pack = parsePackFromUom(p.uom);
    const size = pack && pack.pack_unit === i.pack_unit ? pack.pack_size : Number(i.pack_size);
    if (!size || !Number(i.pack_size)) continue;
    const theirsEx = p.price_inc_gst ? Number(p.price) / (1 + gst) : Number(p.price);
    const theirs = theirsEx / size;
    const ours = ingredientExGstPackPrice(i, gst) / Number(i.pack_size);
    if (!ours || !theirs) continue;
    const diffPct = theirs / ours - 1;
    if (Math.abs(diffPct) > tolerance) out.push({ ingredient: i, portal: p, ours, theirs, diffPct });
  }
  return out.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
}
