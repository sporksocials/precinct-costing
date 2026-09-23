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

/** Cost per base unit (per kg / per L / per each) after rebate and yield. */
export function ingredientCostPerBase(
  ing: Pick<Ingredient, "pack_price" | "gst_free" | "price_inc_gst" | "rebate" | "pack_size" | "yield_pct">,
  gst: number,
): number {
  const ex = ingredientExGstPackPrice(ing, gst);
  const rebate = Number(ing.rebate) || 0;
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

    if (line.component_type === "ingredient") {
      const ing = index.ingredients.get(line.component_id);
      if (!ing) {
        warning = { lineId: line.id, kind: "missing_component", message: "Ingredient not found" };
      } else {
        componentName = ing.name;
        componentBase = ing.pack_unit;
        unitCost = ingredientCostPerBase(ing, gst);
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
    out.push({ line, componentName, componentBase, unitCost, cost, warning });
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
}

export function sellExGst(sellInc: number, gst: number): number {
  return sellInc / (1 + gst);
}

export function gpFromPrice(cost: number, sellInc: number, gst: number): { gpDollars: number; gpPct: number } {
  const ex = sellExGst(sellInc, gst);
  const gpDollars = ex - cost;
  return { gpDollars, gpPct: ex > 0 ? gpDollars / ex : 0 };
}

/** Suggested inc-GST price at a target GP, rounded UP to nearest `roundTo`. */
export function suggestedPrice(cost: number, targetGp: number, gst: number, roundTo: number): number {
  if (targetGp >= 1) return 0;
  const raw = (cost / (1 - targetGp)) * (1 + gst);
  if (roundTo <= 0) return raw;
  return Math.ceil(raw / roundTo - 1e-9) * roundTo;
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
  const portions = Number(item.portions) > 0 ? Number(item.portions) : 1;
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
  return { item, recipe, recipeCost: recipe.total, costPerPortion, sellInc, sellEx, gpDollars, gpPct, targetGp, suggestedInc, underTarget };
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
