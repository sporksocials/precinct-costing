/**
 * ONE CARD PER PRODUCT (Troy, 23 Nov 2026). An order item (ordering_products) is a thin per-venue shell: which venue's list
 * it is on, its shelf group, what it is Counted By, its Build To. Everything about the PRODUCT is read from its ingredient
 * and never typed twice: the name, the supplier, the supplier's item code, the price and any free-unit deal.
 *
 * This file is the one place those facts are worked out. Every order screen, the Setup > Products list, the ingredient
 * page's Ordering group and the snapshot written onto an order's lines when it is marked sent all call `orderFacts`.
 * Pure: no React, no database.
 *
 *   pack ex    the ingredient's pack price, ex GST (prices are stored ex GST; a row still flagged inc GST is divided, a GST
 *              free one never is). A pack price of 0 means no price.
 *   units      how many of the ingredient's packs one counted unit holds: the ingredient's `carton_qty` when the item is
 *              Counted By the carton, else 1. A carton with no carton_qty has NO PRICE (never 1: a six times error must not
 *              reach a supplier).
 *   unit ex    pack ex x units.   unit inc = unit ex x (1 + GST rate), or the same as ex when the ingredient is GST free.
 *   free units the ingredient's live Buy X Get Y deal (lib/deals.ts), applied to the list price: every X + Y ordered, Y are
 *              free (`freeUnits` / `paidUnits` in lib/ordering.ts).
 *
 * FALLBACK: an order item with no ingredient (or whose ingredient is not in the loaded list) shows its own stored name,
 * code, price and deal exactly as it did before, and is flagged `needsIngredient` so a screen can say so. Nothing here
 * throws on a missing ingredient.
 */
import { ingredientExGstPackPrice } from "./costing";
import { buyGetPct, dealIsLive } from "./deals";
import { GST_RATE, type FreeDeal } from "./ordering";
import type { OrderingProduct } from "./ordering-types";
import type { Ingredient, IngredientDeal } from "./types";

/** The ingredient columns the facts read. */
export type FactsIngredient = Pick<Ingredient, "id" | "pack_price" | "price_inc_gst" | "gst_free"> & { carton_qty?: number | null };
/** The order item columns the facts read (a whole OrderingProduct fits). */
export type FactsProduct = Pick<OrderingProduct, "name" | "unit_name" | "supplier_item_code" | "price_inc_gst" | "ingredient_id"> & { deal_buy_qty?: number | null; deal_free_qty?: number | null };

/** Why an item has no price, in the words a screen prints. */
export const NO_CARTON_QTY = "No price: say how many a carton holds";
export const NO_INGREDIENT_PRICE = "No price: the ingredient has no price yet";
export const NO_STORED_PRICE = "No price";

export interface OrderFacts {
  /** the facts came from the ingredient (false = the fallback: the order item's own stored values) */
  linked: boolean;
  /** an order item with no ingredient behind it: show "Needs An Ingredient" */
  needsIngredient: boolean;
  /** the ingredient's id when linked */
  ingredientId: string | null;
  /**
   * The item's name and supplier item code, read from the order item row. For an item with an ingredient the DATABASE keeps
   * both equal to the ingredient's full name (size in brackets included) and Supplier Code, so the count screen, the order
   * screen and the history pages always agree; an item with no ingredient keeps the name and code it had.
   */
  name: string;
  code: string | null;
  /** what it is counted and ordered by, as stored (carton, bottle, keg, bag, tub, each) */
  unit: string;
  /** the ingredient's packs in one counted unit; null for a carton nobody has sized, and for the fallback */
  packsPerUnit: number | null;
  /** one ingredient pack, ex GST (null without a price, and for the fallback) */
  packEx: number | null;
  /** one counted unit, ex and inc GST, to the cent; both null when there is no price */
  unitEx: number | null;
  unitInc: number | null;
  /** GST free: inc is the same as ex */
  gstFree: boolean;
  /** buy X get Y free on the list price; null when there is none */
  deal: { buy: number; free: number } | null;
  /** plain words for a missing price; null when there is a price */
  noPrice: string | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const pos = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
};

/** "carton", "Cartons", "ctn": the item is counted and ordered by the carton. */
export function isCartonUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? "").trim().toLowerCase();
  return u === "carton" || u === "cartons" || u === "ctn" || u === "ctns";
}

/**
 * The free-unit deal an ingredient has today: its live Buy X Get Y deal (the one that gives the most away when there are
 * several). Other kinds of deal (percent off, a special price, volume) change costing, not what is paid for on an order line.
 */
export function liveFreeDeal(deals: readonly IngredientDeal[] | null | undefined, today?: string): { buy: number; free: number } | null {
  let best: { buy: number; free: number } | null = null;
  for (const d of deals ?? []) {
    if (d.kind !== "buy_x_get_y" || !dealIsLive(d, today)) continue;
    const buy = Math.floor(Number(d.buy_qty));
    const free = Math.floor(Number(d.free_qty));
    if (!(buy > 0) || !(free > 0)) continue;
    if (!best || buyGetPct(buy, free) > buyGetPct(best.buy, best.free)) best = { buy, free };
  }
  return best;
}

export interface FactsOptions {
  /** the costing setting gst_rate (0.1) */
  gstRate?: number;
  /** the ingredient's own deals (cost_ingredient_deals rows for it) */
  deals?: readonly IngredientDeal[] | null;
  /** yyyy-mm-dd in Brisbane; defaults to today */
  today?: string;
}

/** The stored values of an order item with no ingredient behind it, exactly as the screens showed them before. */
function storedFacts(product: FactsProduct, rate: number): OrderFacts {
  const inc = pos(product.price_inc_gst);
  const buy = Math.floor(Number(product.deal_buy_qty));
  const free = Math.floor(Number(product.deal_free_qty));
  return {
    linked: false,
    needsIngredient: true,
    ingredientId: null,
    name: product.name,
    code: (product.supplier_item_code ?? "").trim() || null,
    unit: product.unit_name,
    packsPerUnit: null,
    packEx: null,
    unitEx: inc == null ? null : round2(inc / (1 + rate)),
    unitInc: inc == null ? null : round2(inc),
    gstFree: false,
    deal: buy > 0 && free > 0 ? { buy, free } : null,
    noPrice: inc == null ? NO_STORED_PRICE : null,
  };
}

/**
 * Everything an order screen shows about one order item. `ingredient` is the item's ingredient from the loaded list, or
 * null / undefined when it has none or it could not be found (both read as the fallback).
 */
export function orderFacts(product: FactsProduct, ingredient: FactsIngredient | null | undefined, opts: FactsOptions = {}): OrderFacts {
  const rate = Number.isFinite(Number(opts.gstRate)) && Number(opts.gstRate) >= 0 ? Number(opts.gstRate) : GST_RATE;
  if (!ingredient || !product.ingredient_id) return storedFacts(product, rate);

  const gstFree = !!ingredient.gst_free;
  const packRaw = pos(ingredientExGstPackPrice(ingredient, rate));
  const carton = isCartonUnit(product.unit_name);
  const packsPerUnit = carton ? pos(ingredient.carton_qty) : 1;
  const unitRaw = packRaw != null && packsPerUnit != null ? packRaw * packsPerUnit : null;
  return {
    linked: true,
    needsIngredient: false,
    ingredientId: ingredient.id,
    name: product.name,
    code: (product.supplier_item_code ?? "").trim() || null,
    unit: product.unit_name,
    packsPerUnit,
    packEx: packRaw == null ? null : round2(packRaw),
    unitEx: unitRaw == null ? null : round2(unitRaw),
    unitInc: unitRaw == null ? null : round2(gstFree ? unitRaw : unitRaw * (1 + rate)),
    gstFree,
    deal: liveFreeDeal(opts.deals, opts.today),
    noPrice: unitRaw != null ? null : packRaw == null ? NO_INGREDIENT_PRICE : NO_CARTON_QTY,
  };
}

/** The deal in the shape lib/ordering.ts takes (`freeUnits`, `paidUnits`, `lineTotals`). */
export function factsDeal(f: Pick<OrderFacts, "deal">): FreeDeal | null {
  return f.deal ? { buy: f.deal.buy, free: f.deal.free } : null;
}

/** What the facts function needs from the loaded costing data: an ingredient by id, its deals, the GST rate and today's date. */
export interface FactsSource {
  ingredientById: (id: string) => FactsIngredient | null | undefined;
  dealsFor?: (ingredientId: string) => readonly IngredientDeal[] | null | undefined;
  gstRate?: number;
  today?: string;
}
export type FactsOf = (product: FactsProduct) => OrderFacts;

/** One function a screen can call per order item, built once from the loaded costing data. */
export function factsFrom(source: FactsSource): FactsOf {
  return (product) => {
    const ing = product.ingredient_id ? source.ingredientById(product.ingredient_id) : null;
    return orderFacts(product, ing, { gstRate: source.gstRate, deals: ing ? source.dealsFor?.(ing.id) : null, today: source.today });
  };
}

/** The facts of an order item read with no costing data at all (its stored values): what a test or an offline screen falls back to. */
export const storedFactsOf: FactsOf = (product) => orderFacts(product, null);

/** Whether a line of a SAVED order is GST free: read from the item's ingredient as it is now (a saved line keeps only its inc GST price). */
export function lineGstFree(productId: string | null | undefined, products: readonly Pick<OrderingProduct, "id" | "ingredient_id">[], ingredientById: (id: string) => Pick<Ingredient, "gst_free"> | null | undefined): boolean {
  if (!productId) return false;
  const p = products.find((x) => x.id === productId);
  return !!(p?.ingredient_id && ingredientById(p.ingredient_id)?.gst_free);
}

/* ------------------------------------------------------------------ wording */

const money2 = (n: number): string => `$${n.toFixed(2)}`;
const unitWordOf = (unit: string): string => (unit ?? "").trim().toLowerCase() || "unit";

/**
 * The order price in plain words, for the ingredient page and the Products list:
 *   "Ordered by the carton: $115.50 inc GST ($17.50 a bottle ex GST)"
 *   "Ordered by the carton: $105.00, GST free ($17.50 a bottle)"
 *   "Ordered by the bottle: $19.25 inc GST ($17.50 ex GST)"
 *   "No price: say how many a carton holds"
 * `packWord` names one of the ingredient's packs ("bottle", "pack").
 */
export function orderPriceSentence(f: OrderFacts, packWord = "pack"): string {
  if (f.unitInc == null || f.unitEx == null) return f.noPrice ?? NO_STORED_PRICE;
  const unit = unitWordOf(f.unit);
  const head = `Ordered by the ${unit}: ${money2(f.unitInc)}${f.gstFree ? ", GST free" : " inc GST"}`;
  const bits: string[] = [];
  if (f.linked && f.packsPerUnit != null && f.packsPerUnit !== 1 && f.packEx != null) bits.push(`${money2(f.packEx)} a ${packWord}${f.gstFree ? "" : " ex GST"}`);
  else if (!f.gstFree) bits.push(`${money2(f.unitEx)} ex GST`);
  const deal = f.deal ? `. Buy ${f.deal.buy}, get ${f.deal.free} free` : "";
  return `${head}${bits.length ? ` (${bits.join(", ")})` : ""}${deal}`;
}

/** "$115.50" for a list column, "" when there is no price. */
export function orderPriceShort(f: Pick<OrderFacts, "unitInc">): string {
  return f.unitInc == null ? "" : money2(f.unitInc);
}
