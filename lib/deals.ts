import type { DealKind, Ingredient, IngredientDeal } from "./types";

/**
 * Supplier deals. Pure functions only; costing (lib/costing.ts buildIndex) and the UI both call these.
 *
 * DEAL-SELECTION RULE (also stated in the deal editor):
 *  1. Only deals that are switched on and inside their dates count (status "active" or "ending_soon").
 *  2. Deals do not stack, with ONE exception: a standing "percent off" (rebate) applies to the base price first.
 *     If there are several standing percentages the biggest one is used.
 *  3. Every other deal (buy X get Y, volume, special price) is then worked out from that price, and the
 *     LOWEST effective pack price wins. A special price is a fixed pack price, so it is not reduced further.
 *  4. A deal that works out at zero or below, or does not exist in numbers, is ignored and reported as a
 *     warning. The effective price is never zero or negative and never above the base price.
 *  5. Volume deals assume the pack price at the minimum quantity, i.e. the kitchen orders at least that many.
 *  6. The old per-ingredient `rebate` column is a separate standing rebate: it still comes off AFTER the
 *     effective pack price in ingredientCostPerBase, so it is not double counted by deals.
 * Prices are on the same GST basis as the ingredient's pack price (deal prices are typed the way the pack price is).
 * A deal never changes the stored pack price, so it never touches the price log.
 */

export type DealStatus = "active" | "upcoming" | "ending_soon" | "expired" | "off";

export const DEAL_KINDS: { value: DealKind; label: string; hint: string }[] = [
  { value: "buy_x_get_y", label: "Buy X Get Y", hint: "Buy 8 get 1 free" },
  { value: "volume", label: "Volume", hint: "Cheaper when you order a minimum quantity" },
  { value: "special_price", label: "Special Price", hint: "A fixed pack price between two dates" },
  { value: "percent_off", label: "Percent Off", hint: "A standing rebate or percentage off" },
];

export const ENDING_SOON_DAYS = 14;

/** Today's date (yyyy-mm-dd) in Brisbane, whatever the device clock's timezone. */
export function brisbaneToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dayNumber(s: string): number {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

/** Whole days from `a` to `b` (both yyyy-mm-dd). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function dealStatus(deal: Pick<IngredientDeal, "active" | "starts_on" | "ends_on">, today: string = brisbaneToday()): DealStatus {
  if (!deal.active) return "off";
  if (deal.ends_on && daysBetween(today, deal.ends_on) < 0) return "expired";
  if (deal.starts_on && daysBetween(today, deal.starts_on) > 0) return "upcoming";
  if (deal.ends_on && daysBetween(today, deal.ends_on) <= ENDING_SOON_DAYS) return "ending_soon";
  return "active";
}

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  ending_soon: "Ending Soon",
  expired: "Expired",
  off: "Off",
};

/** True for deals that are costing right now. */
export function dealIsLive(deal: Pick<IngredientDeal, "active" | "starts_on" | "ends_on">, today: string = brisbaneToday()): boolean {
  const s = dealStatus(deal, today);
  return s === "active" || s === "ending_soon";
}

function n(v: number | null | undefined): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Percentage of the base price that "buy X get Y free" saves: free / (buy + free). */
export function buyGetPct(buy: number, free: number): number {
  return buy > 0 && free > 0 ? free / (buy + free) : 0;
}

/** Pack price a single deal gives from `base` (a pack price), or null when its numbers are unusable. Ignores dates. */
export function dealPackPrice(base: number, deal: IngredientDeal): number | null {
  let p: number | null = null;
  switch (deal.kind) {
    case "buy_x_get_y": {
      const b = n(deal.buy_qty);
      const f = n(deal.free_qty);
      p = b > 0 && f > 0 ? base * (b / (b + f)) : null;
      break;
    }
    case "volume": {
      if (n(deal.unit_price) > 0) p = n(deal.unit_price);
      else if (n(deal.pct_off) > 0) p = base * (1 - n(deal.pct_off));
      break;
    }
    case "special_price":
      p = n(deal.special_pack_price) > 0 ? n(deal.special_pack_price) : null;
      break;
    case "percent_off":
      p = n(deal.pct_off) > 0 ? base * (1 - n(deal.pct_off)) : null;
      break;
  }
  return p != null && Number.isFinite(p) && p > 0 ? p : null;
}

export interface DealResolution {
  base: number;
  /** effective pack price: never above base, never zero or negative (unless the base itself is) */
  price: number;
  /** the deal chosen (null when none beats the base price) */
  deal: IngredientDeal | null;
  /** the standing percent-off applied to the base first, when any */
  standing: IngredientDeal | null;
  /** 0-1 saving against the base price */
  savingPct: number;
  warnings: string[];
}

/** Full working for effectivePackPrice: which deal won, what it saves, and anything odd. */
export function resolveDeals(basePackPrice: number, deals: IngredientDeal[] | undefined | null, today: string = brisbaneToday()): DealResolution {
  const base = n(basePackPrice);
  const out: DealResolution = { base, price: base, deal: null, standing: null, savingPct: 0, warnings: [] };
  if (!(base > 0) || !deals?.length) return out;
  const live = deals.filter((d) => dealIsLive(d, today));
  if (!live.length) return out;

  // 2. standing percent off first (biggest wins)
  let standing: IngredientDeal | null = null;
  for (const d of live) {
    if (d.kind !== "percent_off") continue;
    if (dealPackPrice(base, d) == null) {
      out.warnings.push(`${dealSummary(d)} was ignored because it does not give a price above $0.`);
      continue;
    }
    if (!standing || n(d.pct_off) > n(standing.pct_off)) standing = d;
  }
  const afterStanding = standing ? (dealPackPrice(base, standing) as number) : base;

  // 3. the lowest of the rest, worked out from the standing price
  let best: { deal: IngredientDeal; price: number } | null = standing ? { deal: standing, price: afterStanding } : null;
  for (const d of live) {
    if (d.kind === "percent_off") continue;
    const p = dealPackPrice(afterStanding, d);
    if (p == null) {
      out.warnings.push(`${dealSummary(d)} was ignored because it does not give a price above $0.`);
      continue;
    }
    if (p < (best ? best.price : afterStanding) - 1e-9) best = { deal: d, price: p };
  }
  if (best && best.price < base - 1e-9) {
    out.price = best.price;
    out.deal = best.deal;
    // a standing percentage that is not the winner can still have shaped the winning price (e.g. 8+1 on top of 5% off)
    out.standing = standing && best.deal.id !== standing.id ? standing : null;
    out.savingPct = 1 - best.price / base;
  }
  return out;
}

/** The pack price to cost with today: the base price after the single best live deal (see the rule at the top). */
export function effectivePackPrice(basePackPrice: number, deals: IngredientDeal[] | undefined | null, today: string = brisbaneToday()): number {
  return resolveDeals(basePackPrice, deals, today).price;
}

/** Copy of the ingredient priced at its effective pack price, for costing. The stored ingredient is untouched. */
export function withEffectivePrice<T extends Pick<Ingredient, "id" | "pack_price">>(ing: T, deals: IngredientDeal[] | undefined | null, today?: string): T {
  if (!deals?.length) return ing;
  const own = deals.filter((d) => d.ingredient_id === ing.id);
  if (!own.length) return ing;
  const price = effectivePackPrice(Number(ing.pack_price), own, today);
  return price === Number(ing.pack_price) ? ing : { ...ing, pack_price: price };
}

/** Group deals by ingredient id. */
export function groupDeals(deals: IngredientDeal[]): Map<string, IngredientDeal[]> {
  const m = new Map<string, IngredientDeal[]>();
  for (const d of deals) {
    const a = m.get(d.ingredient_id);
    if (a) a.push(d);
    else m.set(d.ingredient_id, [d]);
  }
  return m;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(s: string): string {
  const [, m, d] = s.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]}`;
}
function usd(v: number): string {
  return `$${v.toFixed(2)}`;
}
function pctText(p: number): string {
  const v = Math.round(p * 1000) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}
function qty(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** "Buy 8 get 1 free: 11.1% off". */
export function dealSummary(deal: IngredientDeal): string {
  const dates = deal.starts_on && deal.ends_on ? `, ${day(deal.starts_on)} to ${day(deal.ends_on)}` : deal.ends_on ? `, until ${day(deal.ends_on)}` : deal.starts_on ? `, from ${day(deal.starts_on)}` : "";
  switch (deal.kind) {
    case "buy_x_get_y":
      return `Buy ${qty(n(deal.buy_qty))} get ${qty(n(deal.free_qty))} free: ${pctText(buyGetPct(n(deal.buy_qty), n(deal.free_qty)))} off${dates}`;
    case "volume":
      return n(deal.unit_price) > 0
        ? `${qty(n(deal.min_qty) || 1)}+ packs at ${usd(n(deal.unit_price))} each${dates}`
        : `${qty(n(deal.min_qty) || 1)}+ packs: ${pctText(n(deal.pct_off))} off${dates}`;
    case "special_price":
      return `Special price ${usd(n(deal.special_pack_price))} a pack${dates}`;
    case "percent_off":
      return `${pctText(n(deal.pct_off))} off${deal.starts_on || deal.ends_on ? dates : " (standing)"}`;
  }
}

/** A deal read out of supplier text, ready to prefill the form. */
export interface SuggestedDeal {
  kind: DealKind;
  buy_qty: number | null;
  free_qty: number | null;
  pct_off: number | null;
  /** the bit of text that matched, for "Found 8+1 in the description" */
  matched: string;
}

/**
 * Spots deals written into supplier descriptions: "KEG 8+1 LUC $355", "CTN 10+1", "5% OFF", "BUY 5 GET 1 FREE".
 * Returns null when nothing convincing is there. "a+b" needs a > b so pack sizes like "2+3" are ignored.
 */
export function parseDealFromText(description: string | null | undefined): SuggestedDeal | null {
  const t = (description ?? "").toUpperCase();
  if (!t.trim()) return null;
  const buyGet = t.match(/\bBUY\s*(\d{1,3})\s*,?\s*GET\s*(\d{1,3})(?:\s*(?:FREE|EXTRA))?\b/);
  if (buyGet) {
    const buy = Number(buyGet[1]);
    const free = Number(buyGet[2]);
    if (buy > 0 && free > 0) return { kind: "buy_x_get_y", buy_qty: buy, free_qty: free, pct_off: null, matched: buyGet[0].trim() };
  }
  const plus = t.match(/(?<![\d.])(\d{1,3})\s*\+\s*(\d{1,3})(?![\d.]|\s*(?:X|ML|L|KG|G)\b)/);
  if (plus) {
    const buy = Number(plus[1]);
    const free = Number(plus[2]);
    if (buy > free && free > 0) return { kind: "buy_x_get_y", buy_qty: buy, free_qty: free, pct_off: null, matched: `${buy}+${free}` };
  }
  const pct = t.match(/(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*%\s*(?:OFF|DISC(?:OUNT)?|REBATE)\b/);
  if (pct) {
    const v = Number(pct[1]);
    if (v > 0 && v < 100) return { kind: "percent_off", buy_qty: null, free_qty: null, pct_off: v / 100, matched: pct[0].trim() };
  }
  return null;
}
