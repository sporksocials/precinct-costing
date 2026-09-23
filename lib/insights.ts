import { buildIndex, costItem, priceMovePct, type ItemCost, type PrepCost } from "./costing";
import type { CostingSettings, Ingredient, MenuItem, Prep, PriceLog, RecipeLine, Target } from "./types";

export const FOOD_CATEGORIES = new Set(["Food"]);
export const DRINK_CATEGORIES = new Set(["Cocktail", "Mocktail", "Tap Beer", "Packaged Beer & Cider", "Wine", "Spirits", "RTD"]);

export interface GpSummary {
  /** simple average of item GP% across active priced items (every item counts equally) */
  avg: number | null;
  count: number;
  food: number | null;
  drinks: number | null;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

export function gpSummary(costs: Iterable<ItemCost>, venueId?: number | null): GpSummary {
  const all: number[] = [];
  const food: number[] = [];
  const drinks: number[] = [];
  for (const c of costs) {
    if (!c.item.active || c.gpPct == null) continue;
    if (venueId != null && c.item.venue_id !== venueId) continue;
    all.push(c.gpPct);
    if (FOOD_CATEGORIES.has(c.item.category)) food.push(c.gpPct);
    else if (DRINK_CATEGORIES.has(c.item.category)) drinks.push(c.gpPct);
  }
  return { avg: mean(all), count: all.length, food: mean(food), drinks: mean(drinks) };
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
    out.push({ ingredient: ing, log, movePct: m, delta, recipeCount: used.length, impact: delta * Math.max(used.length, 0.01) });
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
