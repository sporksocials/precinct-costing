import { buildIndex, costItem, ingredientExGstPackPrice, parsePackFromUom, priceMovePct, type ItemCost, type PrepCost } from "./costing";
import type { CostingSettings, Ingredient, IngredientDeal, MenuItem, PortalPrice, Prep, PriceLog, RecipeLine, Target } from "./types";
import { dealStatus, daysBetween } from "./deals";
import { parseVirtualItemId } from "./gelato";
import { parseBeerItemId } from "./beer";

export const FOOD_CATEGORIES = new Set(["Food"]);
export const DRINK_CATEGORIES = new Set(["Cocktail", "Mocktail", "Tap Beer", "Packaged Beer & Cider", "Wine", "Spirits", "RTD"]);

/** Kinds of Today-feed entries. 'check_cost' and 'happy_hour' are new; the rest are unchanged. */
export type FeedKind = "price_rise" | "below_target" | "stale_price" | "catalogue_gap" | "check_cost" | "missing_price" | "happy_hour" | "deal_ending" | "deal_expired";

/**
 * A computed item whose serve is not on the menu (gelato 3-scoop, take-home, wholesale). It stays costed and visible on
 * the price grid, but headline averages, Below Target, Check Cost and the Today feed leave it out.
 */
export function isOffMenu(c: Pick<ItemCost, "item">): boolean {
  return c.item.off_menu === true;
}

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
    if (!c.item.active || c.gpPct == null || isOffMenu(c)) continue;
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
    if (!c.item.active || !c.underTarget || isOffMenu(c)) continue;
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
    if (!c.item.active || !c.needsCheck || isOffMenu(c)) continue;
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

export interface MissingPriceGroup {
  id: string;
  name: string;
  /** where tapping it goes (the place to type a price) */
  href: string;
  venueId: number;
  /** computed serves folded into this row (1 for a normal item) */
  count: number;
  /** cost per portion (ex GST); for a folded gelato serve, the dearest flavour */
  cost: number;
  /** price (inc GST) that would reach the target, or null when the cost is missing or untrustworthy. Only a suggestion: nothing applies it. */
  suggestedInc: number | null;
  targetGp: number;
}

/**
 * Active items that have no sell price at all, so they have no GP and appear in no other feed (feed kind 'missing_price').
 * A normal item is its own row; a tap beer's unpriced serves fold into one row per beer; a gelato serve is one row.
 * The suggested price is shown only when the cost looks trustworthy, and is never applied from here.
 */
export function missingPriceGroups(costs: Iterable<ItemCost>, venueId?: number | null): MissingPriceGroup[] {
  const out: MissingPriceGroup[] = [];
  const byKey = new Map<string, MissingPriceGroup>();
  const suggest = (c: ItemCost) => (!c.needsCheck && c.suggestedInc > 0 ? c.suggestedInc : null);
  for (const c of costs) {
    const it = c.item;
    if (!it.active || isOffMenu(c) || (it.sell_price_inc != null && Number(it.sell_price_inc) > 0)) continue;
    if (venueId != null && it.venue_id !== venueId) continue;
    const b = parseBeerItemId(it.id);
    const g = parseVirtualItemId(it.id);
    if (!b && !g) {
      out.push({ id: it.id, name: it.name, href: `/items/${it.id}`, venueId: it.venue_id, count: 1, cost: c.costPerPortion, suggestedInc: suggest(c), targetGp: c.targetGp });
      continue;
    }
    const key = b ? `beer:${b.beerId}` : `gelato:${g!.serveId}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.count += 1;
      if (g && c.costPerPortion > cur.cost) {
        cur.cost = c.costPerPortion;
        cur.suggestedInc = suggest(c);
      }
      continue;
    }
    const grp: MissingPriceGroup = b
      ? { id: key, name: it.name.split(" - ")[0], href: `/beers/${b.beerId}`, venueId: it.venue_id, count: 1, cost: c.costPerPortion, suggestedInc: null, targetGp: c.targetGp }
      : { id: key, name: it.section ?? it.name, href: "/gelato/serves", venueId: it.venue_id, count: 1, cost: c.costPerPortion, suggestedInc: suggest(c), targetGp: c.targetGp };
    byKey.set(key, grp);
    out.push(grp);
  }
  return out.sort((a, b) => a.venueId - b.venueId || a.name.localeCompare(b.name));
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
    if (!c.item.active || isOffMenu(c) || c.hhSellInc == null || c.hhGpPct == null) continue;
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
    if (Number.isNaN(t) || t < since || l.old_price == null || Number(l.old_price) === Number(l.new_price)) continue; // same-price rows are confirmations, not moves
    const cur = latest.get(l.ingredient_id);
    if (!cur || new Date(cur.changed_at).getTime() < t) latest.set(l.ingredient_id, l);
  }
  const out: PriceIncrease[] = [];
  for (const [id, log] of latest) {
    const ing = ingredients.get(id);
    if (!ing) continue;
    const m = priceMovePct(log.old_price, log.new_price);
    if (m == null || m <= alertPct) continue;
    let used = [...itemsUsing("ingredient", id, lines)].map((i) => items.get(i)).filter((x): x is MenuItem => !!x && x.active && !x.off_menu);
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
  data: {
    ingredients: Ingredient[];
    preps: Prep[];
    lines: RecipeLine[];
    items: MenuItem[];
    settings: CostingSettings;
    targets: Target[];
    /** supplier deals in force today (optional) */
    deals?: IngredientDeal[];
    /** deals to use for the "after" side instead of `deals`, to preview adding, changing or removing a deal */
    dealsAfter?: IngredientDeal[];
  },
): ImpactRow[] {
  const affected = itemsUsing("ingredient", ingredientId, data.lines);
  if (!affected.size) return [];
  const beforeIdx = buildIndex(data.ingredients, data.preps, data.lines, data.deals);
  const afterIdx = buildIndex(
    data.ingredients.map((i) => (i.id === ingredientId ? { ...i, ...patch } : i)),
    data.preps,
    data.lines,
    data.dealsAfter ?? data.deals,
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

/** True when a price was last checked more than `days` ago, or never. */
export function isStalePrice(lastUpdate: string | null | undefined, days = 90, now: number = Date.now()): boolean {
  const t = lastUpdate ? new Date(lastUpdate).getTime() : NaN;
  return Number.isNaN(t) || t < now - days * 86_400_000;
}

/** In-use ingredients whose price hasn't been confirmed in `days` (or ever). */
export function staleIngredients(ingredients: Ingredient[], inUse: Set<string>, days = 90): Ingredient[] {
  const now = Date.now();
  return ingredients.filter((i) => i.active && inUse.has(i.id) && isStalePrice(i.last_price_update, days, now));
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

/** Lower-case, punctuation-free supplier name for comparing a portal supplier with a cost_suppliers name. */
function supplierKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/\b(pty|ltd|limited|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function sameSupplier(a: string, b: string): boolean {
  const x = supplierKey(a);
  const y = supplierKey(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/**
 * The catalogue rows to keep from every batch fetched: for each supplier, EVERY row of the batch(es) captured at that
 * supplier's newest timestamp. Two batches captured at the same instant (e.g. a produce list and a specials list) both stay.
 */
export function latestPortalRows(all: PortalPrice[]): PortalPrice[] {
  const newest = new Map<string, number>();
  const at = (r: PortalPrice) => (r.captured_at ? new Date(r.captured_at).getTime() : 0) || 0;
  for (const r of all) newest.set(r.supplier, Math.max(newest.get(r.supplier) ?? 0, at(r)));
  return all.filter((r) => at(r) === newest.get(r.supplier));
}

/**
 * Ingredients linked to a supplier catalogue product (same code AND same supplier) whose price per unit differs by more than `tolerance`.
 * A code only counts for the supplier that issued it: an ingredient with a supplier must match a catalogue row from that supplier
 * (looked up in `suppliers`; without the list it cannot be verified, so it is skipped). An ingredient with no supplier at all
 * ("supplier-less code") matches only when exactly one catalogue supplier uses that code. Codes repeated inside one supplier's
 * catalogue with different prices are ambiguous and skipped.
 */
export function catalogueGaps(
  ingredients: Ingredient[],
  portal: PortalPrice[] | null,
  gst: number,
  suppliers?: Map<number, { name: string }> | { id: number; name: string }[] | null,
  tolerance = 0.02,
): CatalogueGap[] {
  if (!portal?.length) return [];
  const supplierName = (id: number | null): string | null => {
    if (id == null || !suppliers) return null;
    return (suppliers instanceof Map ? suppliers.get(id)?.name : suppliers.find((s) => s.id === id)?.name) ?? null;
  };
  const byCode = new Map<string, PortalPrice[]>();
  for (const p of portal) {
    if (!p.product_code || p.price == null) continue;
    const k = p.product_code.trim().toLowerCase();
    const arr = byCode.get(k);
    if (arr) arr.push(p);
    else byCode.set(k, [p]);
  }
  const out: CatalogueGap[] = [];
  for (const i of ingredients) {
    if (!i.active || !i.supplier_code) continue;
    const cands = byCode.get(i.supplier_code.trim().toLowerCase());
    if (!cands?.length) continue;
    let matches: PortalPrice[];
    if (i.supplier_id != null) {
      const name = supplierName(i.supplier_id);
      if (!name) continue;
      matches = cands.filter((c) => sameSupplier(c.supplier, name));
    } else {
      matches = new Set(cands.map((c) => supplierKey(c.supplier))).size === 1 ? cands : [];
    }
    if (!matches.length) continue;
    if (matches.some((m) => Number(m.price) !== Number(matches[0].price) || m.price_inc_gst !== matches[0].price_inc_gst || m.uom !== matches[0].uom)) continue;
    const p = matches[0];
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

export interface DealFeedRow {
  kind: "deal_ending" | "deal_expired";
  deal: IngredientDeal;
  ingredient: Ingredient;
  /** days until it ends (ending) or since it ended (expired); 0 = today / yesterday boundary */
  days: number;
}

/**
 * Today-feed rows for supplier deals: "Deals Ending" (live, ending within 14 days) and "Deal Expired"
 * (switched on, ended in the last 30 days, still on file). Costing has already reverted to the base price
 * for expired deals. Only ingredients used in a recipe are listed.
 */
export function dealFeedRows(deals: IngredientDeal[], ingredients: Ingredient[], inUse: Set<string>, today: string, expiredWindowDays = 30): DealFeedRow[] {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const out: DealFeedRow[] = [];
  for (const d of deals) {
    const ing = byId.get(d.ingredient_id);
    if (!ing || !ing.active || !inUse.has(ing.id) || !d.ends_on) continue;
    const s = dealStatus(d, today);
    if (s === "ending_soon") out.push({ kind: "deal_ending", deal: d, ingredient: ing, days: daysBetween(today, d.ends_on) });
    else if (s === "expired") {
      const ago = daysBetween(d.ends_on, today);
      if (ago <= expiredWindowDays) out.push({ kind: "deal_expired", deal: d, ingredient: ing, days: ago });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.days - b.days : a.kind === "deal_expired" ? -1 : 1));
}
