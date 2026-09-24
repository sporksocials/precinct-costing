import {
  DEFAULT_TARGET_GP,
  type CostingSettings,
  type Ingredient,
  type LineUnit,
  type MenuItem,
  type PackUnit,
  type Prep,
  type RecipeLine,
  type Target,
} from "./types";

export const MAX_PREP_DEPTH = 5;

/** Multiplier to convert a line unit into its base unit (kg, L or each). */
export const UNIT_FACTORS: Record<LineUnit, number> = {
  g: 0.001,
  kg: 1,
  ml: 0.001,
  L: 1,
  each: 1,
};

/** Base unit family a line unit belongs to. */
export function unitBase(unit: LineUnit): PackUnit {
  switch (unit) {
    case "g":
    case "kg":
      return "kg";
    case "ml":
    case "L":
      return "L";
    default:
      return "each";
  }
}

/** Ex-GST pack price of an ingredient. */
export function ingredientExGstPackPrice(ing: Pick<Ingredient, "pack_price" | "gst_free" | "price_inc_gst">, gst: number): number {
  const price = Number(ing.pack_price) || 0;
  if (ing.gst_free) return price;
  if (ing.price_inc_gst) return price / (1 + gst);
  return price;
}

/**
 * Ex-GST rebate per pack. ASSUMPTION: the rebate is typed on the same basis as the pack price
 * (a supplier rebate off an inc-GST price is itself inc-GST), so it is divided by (1 + gst) when
 * the price is inc-GST and not GST-free. Otherwise it is used as entered.
 */
export function ingredientExGstRebate(ing: Pick<Ingredient, "rebate" | "gst_free" | "price_inc_gst">, gst: number): number {
  const rebate = Number(ing.rebate) || 0;
  if (!ing.gst_free && ing.price_inc_gst) return rebate / (1 + gst);
  return rebate;
}

/** Why an ingredient prices at $0 per unit (null when it prices normally). */
export function ingredientCostIssue(ing: Pick<Ingredient, "pack_price" | "pack_size" | "yield_pct">): string | null {
  if (!(Number(ing.pack_price) > 0)) return "pack price is 0";
  if (!(Number(ing.pack_size) > 0)) return "pack size is 0";
  if (!(Number(ing.yield_pct) > 0)) return "yield is 0";
  return null;
}

/** Cost per base unit (per kg / per L / per each) after rebate and yield. */
export function ingredientCostPerBase(
  ing: Pick<Ingredient, "pack_price" | "gst_free" | "price_inc_gst" | "rebate" | "pack_size" | "yield_pct">,
  gst: number,
): number {
  const ex = ingredientExGstPackPrice(ing, gst);
  const rebate = ingredientExGstRebate(ing, gst);
  const size = Number(ing.pack_size) || 0;
  const yieldPct = Number(ing.yield_pct) || 0;
  if (size <= 0 || yieldPct <= 0) return 0;
  return (ex - rebate) / size / yieldPct;
}

export interface LineWarning {
  lineId: string;
  kind: "unit_mismatch" | "missing_component" | "cycle" | "depth";
  message: string;
}

export interface LineCost {
  line: RecipeLine;
  componentName: string;
  componentBase: PackUnit | null;
  /** cost per base unit of the component */
  unitCost: number;
  /** cost of this line (qty × factor × unitCost) */
  cost: number;
  warning: LineWarning | null;
  /** set when the line has a quantity but its component costs $0 (bad price, pack size, yield or empty prep) */
  costIssue?: string | null;
}

export interface RecipeCost {
  lines: LineCost[];
  total: number;
  warnings: LineWarning[];
  /** true when at least one prep line refers to a prep that itself uses preps */
  nested: boolean;
}

export interface CostingIndex {
  ingredients: Map<string, Ingredient>;
  preps: Map<string, Prep>;
  /** lines grouped by `${parent_type}:${parent_id}`, sorted */
  linesByParent: Map<string, RecipeLine[]>;
}

export function parentKey(parentType: "prep" | "item", parentId: string): string {
  return `${parentType}:${parentId}`;
}

export function buildIndex(ingredients: Ingredient[], preps: Prep[], lines: RecipeLine[]): CostingIndex {
  const linesByParent = new Map<string, RecipeLine[]>();
  for (const l of lines) {
    const k = parentKey(l.parent_type, l.parent_id);
    const arr = linesByParent.get(k);
    if (arr) arr.push(l);
    else linesByParent.set(k, [l]);
  }
  for (const arr of linesByParent.values()) arr.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  return {
    ingredients: new Map(ingredients.map((i) => [i.id, i])),
    preps: new Map(preps.map((p) => [p.id, p])),
    linesByParent,
  };
}

/** Cost a list of lines against the index. `stack` holds prep ids currently being resolved (cycle guard). */
export function costLines(
  lines: RecipeLine[],
  index: CostingIndex,
  gst: number,
  stack: string[] = [],
  cache: Map<string, PrepCost> = new Map(),
): RecipeCost {
  const out: LineCost[] = [];
  const warnings: LineWarning[] = [];
  let total = 0;
  let nested = false;

  for (const line of lines) {
    const qty = Number(line.qty) || 0;
    const factor = UNIT_FACTORS[line.unit] ?? 1;
    const lineBase = unitBase(line.unit);
    let unitCost = 0;
    let componentName = "(missing)";
    let componentBase: PackUnit | null = null;
    let warning: LineWarning | null = null;
    let costIssue: string | null = null;

    if (line.component_type === "ingredient") {
      const ing = index.ingredients.get(line.component_id);
      if (!ing) {
        warning = { lineId: line.id, kind: "missing_component", message: "Ingredient not found" };
      } else {
        componentName = ing.name;
        componentBase = ing.pack_unit;
        unitCost = ingredientCostPerBase(ing, gst);
        if (unitCost <= 0 && qty > 0) costIssue = `${ing.name}: ${ingredientCostIssue(ing) ?? "costs $0"}`;
      }
    } else {
      const prep = index.preps.get(line.component_id);
      if (!prep) {
        warning = { lineId: line.id, kind: "missing_component", message: "Prep not found" };
      } else {
        componentName = prep.name;
        componentBase = prep.yield_unit;
        if (stack.includes(prep.id)) {
          warning = { lineId: line.id, kind: "cycle", message: `Cycle: ${prep.name} refers back to itself` };
        } else if (stack.length >= MAX_PREP_DEPTH) {
          warning = { lineId: line.id, kind: "depth", message: `Nesting deeper than ${MAX_PREP_DEPTH} levels` };
        } else {
          const pc = costPrep(prep, index, gst, stack, cache);
          unitCost = pc.costPerUnit;
          if (unitCost <= 0 && qty > 0) costIssue = `${prep.name}: ${(Number(prep.yield_qty) || 0) > 0 ? "prep costs $0" : "prep yield is 0"}`;
          if (pc.recipe.nested || pc.recipe.lines.some((l) => l.line.component_type === "prep")) nested = true;
          for (const w of pc.recipe.warnings) {
            if (w.kind === "cycle" || w.kind === "depth") warnings.push({ ...w, lineId: line.id });
          }
        }
      }
    }

    if (!warning && componentBase && componentBase !== lineBase) {
      warning = {
        lineId: line.id,
        kind: "unit_mismatch",
        message: `Line unit ${line.unit} does not match component base ${componentBase}`,
      };
    }

    const cost = qty * factor * unitCost;
    total += cost;
    if (warning) warnings.push(warning);
    out.push({ line, componentName, componentBase, unitCost, cost, warning, costIssue });
  }

  return { lines: out, total, warnings, nested };
}

export interface PrepCost {
  prep: Prep;
  recipe: RecipeCost;
  batchCost: number;
  costPerUnit: number;
}

export function costPrep(
  prep: Prep,
  index: CostingIndex,
  gst: number,
  stack: string[] = [],
  cache: Map<string, PrepCost> = new Map(),
): PrepCost {
  const cached = cache.get(prep.id);
  if (cached) return cached;
  const lines = index.linesByParent.get(parentKey("prep", prep.id)) ?? [];
  const recipe = costLines(lines, index, gst, [...stack, prep.id], cache);
  const yieldQty = Number(prep.yield_qty) || 0;
  const result: PrepCost = {
    prep,
    recipe,
    batchCost: recipe.total,
    costPerUnit: yieldQty > 0 ? recipe.total / yieldQty : 0,
  };
  // only cache clean, fully resolved results so cycle detection stays path-sensitive
  if (!recipe.warnings.some((w) => w.kind === "cycle" || w.kind === "depth")) cache.set(prep.id, result);
  return result;
}

export interface ItemCost {
  item: MenuItem;
  recipe: RecipeCost;
  recipeCost: number;
  costPerPortion: number;
  sellInc: number | null;
  sellEx: number | null;
  gpDollars: number | null;
  gpPct: number | null;
  targetGp: number;
  suggestedInc: number;
  underTarget: boolean;
  /**
   * Cost sanity flags (human-readable). Empty = cost looks trustworthy. Raised for: a line whose
   * ingredient/prep costs $0, a beer serve with no keg, an item with no lines, portions <= 0
   * (costed as 1), and a suspicious GP above SUSPICIOUS_GP (92%).
   * Items with any warning are excluded from headline GP averages (see insights.gpSummary)
   * and listed in the 'check_cost' feed.
   */
  costWarnings: string[];
  /** convenience: costWarnings.length > 0 */
  needsCheck: boolean;
  /** happy hour: price (inc GST) when set, its GP%, whether it misses the SAME target, and whether it is below cost */
  hhSellInc: number | null;
  hhGpPct: number | null;
  hhUnderTarget: boolean;
  hhBelowCost: boolean;
}

/** GP above this is treated as a likely costing error rather than a healthy margin. */
export const SUSPICIOUS_GP = 0.92;

export function sellExGst(sellInc: number, gst: number): number {
  return sellInc / (1 + gst);
}

export function gpFromPrice(cost: number, sellInc: number, gst: number): { gpDollars: number; gpPct: number } {
  const ex = sellExGst(sellInc, gst);
  const gpDollars = ex - cost;
  return { gpDollars, gpPct: ex > 0 ? gpDollars / ex : 0 };
}

export interface SuggestOptions {
  /** 'up' (default) never lands below target GP; 'nearest' rounds to the closest step */
  mode?: "up" | "nearest";
  /** price step in dollars (overrides the roundTo argument) */
  step?: number;
}

/**
 * Suggested inc-GST price at a target GP, rounded to `roundTo` (or `opts.step`).
 * Default mode 'up' rounds UP so GP lands at or above target; 'nearest' may land slightly under.
 * Returns 0 when target >= 1 (unachievable) and for a cost of 0 or less.
 */
export function suggestedPrice(cost: number, targetGp: number, gst: number, roundTo: number, opts: SuggestOptions = {}): number {
  if (targetGp >= 1 || !(cost > 0)) return 0;
  const raw = (cost / (1 - targetGp)) * (1 + gst);
  const step = opts.step ?? roundTo;
  if (!(step > 0)) return raw;
  const q = raw / step;
  const n = opts.mode === "nearest" ? Math.round(q) : Math.ceil(q - 1e-9);
  return Math.round(n * step * 100) / 100;
}

export interface PriceStep {
  price: number;
  gpPct: number;
  gpDollars: number;
  /** true for the suggested (rounded-up) price */
  isSuggested: boolean;
  meetsTarget: boolean;
}

/**
 * Candidate prices around the suggestion, on `step` increments: 2 below, the suggestion, then
 * `above` (default 3) higher. Prices <= 0 are dropped. Empty when cost <= 0 or target >= 1.
 */
export function priceLadder(cost: number, targetGp: number, gst: number, step: number, above = 3): PriceStep[] {
  const base = suggestedPrice(cost, targetGp, gst, step, { mode: "up" });
  if (!(base > 0) || !(step > 0)) return [];
  const out: PriceStep[] = [];
  for (let k = -2; k <= above; k++) {
    const price = Math.round((base + k * step) * 100) / 100;
    if (price <= 0) continue;
    const { gpDollars, gpPct } = gpFromPrice(cost, price, gst);
    out.push({ price, gpPct, gpDollars, isSuggested: k === 0, meetsTarget: gpPct >= targetGp - 1e-9 });
  }
  return out;
}

/** Smallest price >= `price` whose cents are `ending` (0, 0.5 or 0.9). */
export function roundToEnding(price: number, ending: 0 | 0.5 | 0.9): number {
  if (!(price > 0)) return 0;
  const cents = Math.round(ending * 100);
  const whole = Math.floor(price + 1e-9);
  let cand = whole + cents / 100;
  if (cand < price - 1e-9) cand = whole + 1 + cents / 100;
  return Math.round(cand * 100) / 100;
}

/** Charm-price options at or above `price`: { whole: x.00, half: x.50, ninety: x.90 }. */
export function chargePoints(price: number): { whole: number; half: number; ninety: number } {
  return { whole: roundToEnding(price, 0), half: roundToEnding(price, 0.5), ninety: roundToEnding(price, 0.9) };
}

export function resolveTargetGp(item: Pick<MenuItem, "venue_id" | "category" | "target_override">, targets: Target[]): number {
  if (item.target_override != null && !Number.isNaN(Number(item.target_override))) return Number(item.target_override);
  const t = targets.find((t) => t.venue_id === item.venue_id && t.category === item.category);
  if (t) return Number(t.target_gp);
  return DEFAULT_TARGET_GP;
}

export function costItem(
  item: MenuItem,
  index: CostingIndex,
  settings: CostingSettings,
  targets: Target[],
  cache: Map<string, PrepCost> = new Map(),
  linesOverride?: RecipeLine[],
): ItemCost {
  const lines = linesOverride ?? index.linesByParent.get(parentKey("item", item.id)) ?? [];
  const recipe = costLines(lines, index, settings.gst_rate, [], cache);
  const portionsOk = Number(item.portions) > 0;
  const portions = portionsOk ? Number(item.portions) : 1;
  const costPerPortion = recipe.total / portions;
  const targetGp = resolveTargetGp(item, targets);
  const sellInc = item.sell_price_inc != null ? Number(item.sell_price_inc) : null;
  let sellEx: number | null = null;
  let gpDollars: number | null = null;
  let gpPct: number | null = null;
  if (sellInc != null && sellInc > 0) {
    sellEx = sellExGst(sellInc, settings.gst_rate);
    const gp = gpFromPrice(costPerPortion, sellInc, settings.gst_rate);
    gpDollars = gp.gpDollars;
    gpPct = gp.gpPct;
  }
  const suggestedInc = suggestedPrice(costPerPortion, targetGp, settings.gst_rate, settings.round_to);
  const underTarget = gpPct != null ? gpPct < targetGp - 1e-9 : false;
  const hhRaw = item.hh_price_inc != null ? Number(item.hh_price_inc) : null;
  const hhSellInc = hhRaw != null && hhRaw > 0 ? hhRaw : null;
  let hhGpPct: number | null = null;
  let hhBelowCost = false;
  if (hhSellInc != null) {
    hhGpPct = gpFromPrice(costPerPortion, hhSellInc, settings.gst_rate).gpPct;
    hhBelowCost = costPerPortion > 0 && sellExGst(hhSellInc, settings.gst_rate) < costPerPortion;
  }
  const hhUnderTarget = hhGpPct != null && hhGpPct < targetGp - 1e-9;

  const costWarnings: string[] = [];
  if (item.source === "beer" && lines.length === 0) costWarnings.push("No keg linked to this beer");
  else if (lines.length === 0) costWarnings.push("No recipe lines, so cost is $0");
  if (!portionsOk) costWarnings.push("Portions is 0 or blank, costed as 1 portion");
  for (const l of recipe.lines) if (l.costIssue) costWarnings.push(`Zero cost line, ${l.costIssue}`);
  if (gpPct != null && gpPct > SUSPICIOUS_GP) costWarnings.push(`GP is ${Math.round(gpPct * 100)}%, check the recipe cost`);

  return {
    item, recipe, recipeCost: recipe.total, costPerPortion, sellInc, sellEx, gpDollars, gpPct, targetGp, suggestedInc, underTarget,
    costWarnings, needsCheck: costWarnings.length > 0, hhSellInc, hhGpPct, hhUnderTarget, hhBelowCost,
  };
}

export interface CostDriver {
  name: string;
  /** $ per portion (ex GST) */
  cost: number;
  /** share of the item's total cost, 0..1 */
  pct: number;
}

/**
 * Top cost drivers of an item, per portion, biggest first (same ingredient/prep on several lines is merged).
 * For "why is this under target" UI. Prep lines are shown as the prep (not expanded).
 */
export function costBreakdown(ic: Pick<ItemCost, "recipe" | "recipeCost" | "item">, top = 3): CostDriver[] {
  const portions = Number(ic.item.portions) > 0 ? Number(ic.item.portions) : 1;
  const total = ic.recipeCost;
  const byName = new Map<string, number>();
  for (const l of ic.recipe.lines) byName.set(l.componentName, (byName.get(l.componentName) ?? 0) + l.cost);
  return [...byName.entries()]
    .filter(([, c]) => c > 0)
    .map(([name, c]) => ({ name, cost: c / portions, pct: total > 0 ? c / total : 0 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, Math.max(0, top));
}

/** Percent move between two prices; null when the old price is missing/zero. */
export function priceMovePct(oldPrice: number | null | undefined, newPrice: number | null | undefined): number | null {
  const o = Number(oldPrice);
  const n = Number(newPrice);
  if (!o || Number.isNaN(o) || Number.isNaN(n)) return null;
  return (n - o) / o;
}

export interface ParsedPack {
  pack_size: number;
  pack_unit: PackUnit;
}

/**
 * Parse a supplier UOM string into a pack size and base unit.
 *   "EA (2KG)" → 2 kg, "CTN (2 X 6KG)" → 12 kg, "/ Kg" → 1 kg, "1L" → 1 L, "12 X 330ML" → 3.96 L
 * Returns null when nothing parseable is found.
 */
export function parsePackFromUom(uom: string | null | undefined): ParsedPack | null {
  if (!uom) return null;
  const s = uom.toUpperCase().replace(/,/g, ".");
  // "/ KG", "PER KG", "KG"
  if (/^\s*(\/|PER)?\s*KG\s*$/.test(s)) return { pack_size: 1, pack_unit: "kg" };
  if (/^\s*(\/|PER)?\s*(L|LT|LTR|LITRE)\s*$/.test(s)) return { pack_size: 1, pack_unit: "L" };
  if (/^\s*(\/|PER)?\s*(EA|EACH)\s*$/.test(s)) return { pack_size: 1, pack_unit: "each" };

  const unitRe = "(KG|KGS|G|GM|GMS|GR|L|LT|LTR|LITRE|ML|MLS)";
  // "2 X 6KG" / "2X6 KG"
  const multi = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*X\\s*(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`));
  if (multi) {
    const count = parseFloat(multi[1]);
    const size = parseFloat(multi[2]);
    const u = normaliseUnit(multi[3]);
    return { pack_size: round4(count * size * u.factor), pack_unit: u.base };
  }
  const single = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b`));
  if (single) {
    const size = parseFloat(single[1]);
    const u = normaliseUnit(single[2]);
    return { pack_size: round4(size * u.factor), pack_unit: u.base };
  }
  // "CTN 12" / "12 X EA" / "12EA"
  const eachMulti = s.match(/(\d+(?:\.\d+)?)\s*(?:X\s*)?(?:EA|EACH|PK|PACK|PCS|PC)\b/);
  if (eachMulti) return { pack_size: parseFloat(eachMulti[1]), pack_unit: "each" };
  if (/\b(EA|EACH)\b/.test(s)) return { pack_size: 1, pack_unit: "each" };
  return null;
}

function normaliseUnit(u: string): { base: PackUnit; factor: number } {
  switch (u) {
    case "KG":
    case "KGS":
      return { base: "kg", factor: 1 };
    case "G":
    case "GM":
    case "GMS":
    case "GR":
      return { base: "kg", factor: 0.001 };
    case "L":
    case "LT":
    case "LTR":
    case "LITRE":
      return { base: "L", factor: 1 };
    default:
      return { base: "L", factor: 0.001 };
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
