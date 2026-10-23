/**
 * Landed cost: the delivery, fuel levy and invoice-level discounts on a supplier invoice are spread over its product lines, so each
 * product carries its fair share of getting the goods to the door. The price the app stores stays the supplier's invoice price;
 * landed cost is shown beside it and feeds the quantity-weighted average.
 *
 * The spread works in whole cents with the largest-remainder method, so the shares add up to the pool EXACTLY (no cent is ever
 * lost or invented). Credits attach to the product line they were issued against, and the spread weights use the value net of them.
 * Pure, no store, no clock.
 */
import { descKey, normCode, round4 } from "./invoice-names";

/** Dollars to whole cents. */
export const toCents = (dollars: number): number => Math.round(dollars * 100);
/** Whole cents to dollars (two decimals, exactly representable as cents/100). */
export const fromCents = (cents: number): number => cents / 100;

/**
 * Split `totalCents` over `weights` (non-negative, fractional allowed) by the largest-remainder method. The returned shares are whole
 * cents that add up to `totalCents` exactly. A negative total (a discount) is split the same way and every share is negative.
 * When every weight is zero nothing can be shared: `allocated` is false and all shares are 0 (unless the total is 0 too).
 */
export function allocateCents(totalCents: number, weights: number[]): { shares: number[]; allocated: boolean } {
  const n = weights.length;
  const zero = () => new Array<number>(n).fill(0);
  const total = Math.round(totalCents);
  if (total === 0) return { shares: zero(), allocated: true };
  const sign = total < 0 ? -1 : 1;
  const T = BigInt(Math.abs(total));
  const W = weights.map((w) => (Number.isFinite(w) && w > 0 ? BigInt(Math.round(w * 10000)) : BigInt(0)));
  const sumW = W.reduce((a, b) => a + b, BigInt(0));
  if (sumW === BigInt(0)) return { shares: zero(), allocated: false };

  const base = W.map((w) => (T * w) / sumW);
  const rem = W.map((w) => (T * w) % sumW);
  let leftover = Number(T - base.reduce((a, b) => a + b, BigInt(0)));
  const order = W.map((_, i) => i)
    .filter((i) => W[i] > BigInt(0))
    .sort((a, b) => (rem[a] === rem[b] ? (W[a] === W[b] ? a - b : W[a] > W[b] ? -1 : 1) : rem[a] > rem[b] ? -1 : 1));
  const cents = base.map((b) => Number(b));
  for (const i of order) {
    if (leftover <= 0) break;
    cents[i] += 1;
    leftover -= 1;
  }
  return { shares: cents.map((c) => sign * c || 0), allocated: true };
}

// ---------------------------------------------------------------- credits
export interface LandedProduct {
  /** index into the caller's line list */
  index: number;
  itemCode: string | null;
  description: string;
  unit: string | null;
  qty: number | null;
  baseQty: number | null;
  /** line total ex GST; null means the line cannot take part */
  totalEx: number | null;
  /**
   * A standing supplier discount netted off this line (positive dollars ex GST), from a same-code negative line (see attachDiscounts).
   * Unlike a credit it covers the FULL quantity: the net line value is totalEx minus this, and the cost per unit divides by all of it.
   */
  discountEx?: number;
}

export interface LandedCredit {
  index: number;
  itemCode: string | null;
  description: string;
  unit: string | null;
  qty: number | null;
  totalEx: number | null;
}

const CREDIT_WORDS = /^(?:credit(?:\s+note)?(?:\s+for)?|cr|return(?:ed)?|refund|allowance)\s+/;

/** A credit's description without its leading "Credit" words, as a key comparable with the product's. */
function creditKey(description: string): string {
  return descKey(description).replace(CREDIT_WORDS, "").trim();
}

/**
 * Attach each credit to the product line it was issued against: the same item code, else the same description key. When more than
 * one product could take it, the credit is left unattached (a person decides). Returns credit index to product index, or null.
 */
export function attachCredits(products: LandedProduct[], credits: LandedCredit[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const c of credits) {
    const code = normCode(c.itemCode);
    let hits = code ? products.filter((p) => normCode(p.itemCode) === code) : [];
    if (hits.length === 0) {
      const key = creditKey(c.description);
      hits = key === "" ? [] : products.filter((p) => descKey(p.description) === key);
    } else if (hits.length > 1) {
      const key = creditKey(c.description);
      const narrowed = hits.filter((p) => descKey(p.description) === key);
      if (narrowed.length === 1) hits = narrowed;
    }
    out.set(c.index, hits.length === 1 ? hits[0].index : null);
  }
  return out;
}

// ---------------------------------------------------------------- supplier line discounts
/** Words that mark a negative line as a discount or credit on a product; dropped before descriptions are compared. */
const DISCOUNT_WORDS = new Set(["discount", "discounts", "discounted", "credit", "credits", "less", "rebate", "rebates", "allowance", "cr"]);

/** A description key without its discount words, comparable with the product's own key. */
export function discountKey(description: string | null | undefined): string {
  return descKey(description)
    .split(" ")
    .filter((w) => w !== "" && !DISCOUNT_WORDS.has(w))
    .join(" ");
}

export interface DiscountProduct {
  index: number;
  itemCode: string | null;
  description: string;
  /** printed unit price ex GST, null when none was read */
  unitPriceEx: number | null;
}

export interface DiscountCandidate {
  index: number;
  itemCode: string | null;
  description: string;
  qty: number | null;
  unitPriceEx: number | null;
  /** negative dollars ex GST */
  totalEx: number | null;
}

/**
 * Is this negative line plainly returned goods rather than a discount? It states a quantity and a unit price within 1% of the
 * product's own unit price, and quantity times price is its total to 2c. (A discount line prints a dollar amount, or a rate that is
 * nothing like the product's price.)
 */
export function isGoodsReturn(neg: DiscountCandidate, product: DiscountProduct): boolean {
  if (neg.qty == null || neg.qty === 0 || neg.unitPriceEx == null || neg.totalEx == null || product.unitPriceEx == null || !(product.unitPriceEx > 0)) return false;
  const nearPrice = Math.abs(Math.abs(neg.unitPriceEx) - product.unitPriceEx) / product.unitPriceEx <= 0.01 + 1e-9;
  const maths = Math.abs(Math.abs(neg.qty * neg.unitPriceEx) - Math.abs(neg.totalEx)) <= 0.02 + 1e-9;
  return nearPrice && maths;
}

/**
 * Attach each negative line to the product it is a standing DISCOUNT on: the same item code (compared with normCode) as exactly one
 * product line, else the same description once discount/credit/less/rebate words are dropped. A code shared by several products is
 * narrowed by description; still more than one means unattached (null) and the existing credit logic handles it. Returned goods
 * (see isGoodsReturn) are never a discount: they stay credits. Returns negative line index to product index, or null.
 */
export function attachDiscounts(products: DiscountProduct[], negatives: DiscountCandidate[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const n of negatives) {
    if (n.totalEx == null || !(n.totalEx < 0)) {
      out.set(n.index, null);
      continue;
    }
    const code = normCode(n.itemCode);
    const key = discountKey(n.description);
    let hits = code ? products.filter((p) => normCode(p.itemCode) === code) : [];
    if (hits.length === 0) hits = key === "" ? [] : products.filter((p) => discountKey(p.description) === key);
    else if (hits.length > 1) {
      const narrowed = key === "" ? [] : hits.filter((p) => discountKey(p.description) === key);
      if (narrowed.length === 1) hits = narrowed;
    }
    const hit = hits.length === 1 ? hits[0] : null;
    out.set(n.index, hit && !isGoodsReturn(n, hit) ? hit.index : null);
  }
  return out;
}

// ---------------------------------------------------------------- the spread
export interface LandedInput {
  products: LandedProduct[];
  credits: LandedCredit[];
  /** the fee pool in dollars ex GST: delivery, fees and discounts whose charge rule spreads (discounts negative) */
  poolEx: number;
  /** what the shares follow: the line's value net of credits, or its quantity */
  basis: "value" | "quantity";
}

export interface LandedLineResult {
  /** this line's share of the pool in dollars (whole cents) */
  feeShareEx: number;
  /** total of the credits attached to the line (negative dollars), 0 when none */
  creditEx: number;
  /** the standing supplier discount netted off the line (positive dollars), 0 when none */
  discountEx: number;
  creditCount: number;
  /** true when at least one credit is attached and the credited quantity could not be read, so a unit cost is not known */
  creditQtyUnknown: boolean;
  /** the quantity actually kept after known credited quantities; equals qty when no credit is attached */
  netQty: number | null;
  /** the base quantity actually kept; equals baseQty when no credit is attached */
  netBaseQty: number | null;
  landedTotalEx: number | null;
  landedUnitEx: number | null;
  landedBaseEx: number | null;
}

export interface LandedResult {
  /** the pool in whole cents, exactly what the shares add up to when `allocated` */
  poolCents: number;
  poolEx: number;
  allocated: boolean;
  lines: Map<number, LandedLineResult>;
  /** credit index to the product it attached to (null = unattached) */
  attach: Map<number, number | null>;
}

/** Spread the pool over the product lines and work out each line's landed totals. */
export function allocateLanded(input: LandedInput): LandedResult {
  const { products, credits, basis } = input;
  const poolCents = toCents(input.poolEx);
  const attach = attachCredits(products, credits);

  const creditsFor = (pi: number) => credits.filter((c) => attach.get(c.index) === pi);
  const netValue = (p: LandedProduct): number | null => {
    if (p.totalEx == null) return null;
    return p.totalEx - (p.discountEx ?? 0) + creditsFor(p.index).reduce((s, c) => s + (c.totalEx ?? 0), 0);
  };

  const eligible = products.filter((p) => p.totalEx != null);
  const weights = eligible.map((p) => {
    const w = basis === "quantity" ? p.baseQty ?? p.qty ?? 0 : netValue(p) ?? 0;
    return Math.max(0, w);
  });
  const { shares, allocated } = allocateCents(poolCents, weights);
  const shareByIndex = new Map<number, number>();
  eligible.forEach((p, i) => shareByIndex.set(p.index, shares[i]));

  const lines = new Map<number, LandedLineResult>();
  for (const p of products) {
    const mine = creditsFor(p.index);
    const creditEx = round4(mine.reduce((s, c) => s + (c.totalEx ?? 0), 0));
    const discountEx = round4(Math.max(0, p.discountEx ?? 0));
    const shareCents = shareByIndex.get(p.index) ?? 0;
    const feeShareEx = fromCents(shareCents);

    // Credited quantity: known only when every attached credit states a quantity in the same unit as the line.
    const sameUnit = (c: LandedCredit) => !c.unit || !p.unit || c.unit.trim().toUpperCase() === p.unit.trim().toUpperCase();
    const qtyKnown = mine.length > 0 && p.qty != null && mine.every((c) => c.qty != null && c.qty !== 0 && sameUnit(c));
    const creditedQty = qtyKnown ? mine.reduce((s, c) => s + Math.abs(c.qty as number), 0) : 0;
    const netQty = p.qty == null ? null : qtyKnown ? p.qty - creditedQty : p.qty;
    const netBaseQty =
      p.baseQty == null ? null : qtyKnown && p.qty ? p.baseQty * ((p.qty - creditedQty) / p.qty) : p.baseQty;
    const creditQtyUnknown = mine.length > 0 && !(qtyKnown && (netQty ?? 0) > 0);

    let landedTotalEx: number | null = null;
    let landedUnitEx: number | null = null;
    let landedBaseEx: number | null = null;
    if (p.totalEx != null) {
      landedTotalEx = round4(p.totalEx - discountEx + creditEx + feeShareEx);
      if (!creditQtyUnknown && netQty != null && netQty > 0) landedUnitEx = round4(landedTotalEx / netQty);
      if (!creditQtyUnknown && netBaseQty != null && netBaseQty > 0) landedBaseEx = round4(landedTotalEx / netBaseQty);
    }
    lines.set(p.index, {
      feeShareEx,
      creditEx,
      discountEx,
      creditCount: mine.length,
      creditQtyUnknown,
      netQty,
      netBaseQty: netBaseQty == null ? null : round4(netBaseQty),
      landedTotalEx,
      landedUnitEx,
      landedBaseEx,
    });
  }
  return { poolCents, poolEx: fromCents(poolCents), allocated, lines, attach };
}
