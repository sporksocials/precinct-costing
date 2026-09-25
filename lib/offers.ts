import { DEFAULT_TARGET_GP, type CostingSettings, type Offer, type OfferLine } from "./types";
import { gpFromPrice, priceLadder, sellExGst, suggestedPrice, type ItemCost, type PriceStep } from "./costing";
import { beerItemId } from "./beer";

/**
 * Specials & combos. An offer is a saved bundle of existing menu items / tap beer serves at one total price.
 * Nothing here touches the master menu: components are costed from the store's itemCosts (which already include
 * the virtual beer serves, `beer~<beerId>~<serveId>`), so an ingredient price change flows straight through.
 * Costs are ex GST, prices inc GST.
 */

export const OFFER_KINDS: { value: Offer["kind"]; label: string }[] = [
  { value: "combo", label: "Combo" },
  { value: "special", label: "Special" },
  { value: "happy_hour", label: "Happy Hour" },
];
export const OFFER_STATUSES: { value: Offer["status"]; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "live", label: "Live" },
  { value: "retired", label: "Retired" },
];

export function offerKindLabel(kind: Offer["kind"]): string {
  return OFFER_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export interface OfferCostCtx {
  /** the store's itemCosts: menu items and virtual beer/gelato items by id */
  itemCosts: Map<string, ItemCost>;
  settings: CostingSettings;
}

/** The itemCosts key a line resolves to, or null when the component reference is gone (deleted). */
export function offerLineCostId(line: Pick<OfferLine, "component_kind" | "item_id" | "beer_id" | "serve_id">): string | null {
  if (line.component_kind === "item") return line.item_id ?? null;
  return line.beer_id && line.serve_id ? beerItemId(line.beer_id, line.serve_id) : null;
}

export type MissingReason = "deleted" | "no_price" | "no_cost";

export interface MissingComponent {
  lineId: string;
  name: string;
  reason: MissingReason;
}

export interface OfferLineCost {
  line: OfferLine;
  /** itemCosts key; null when the component was deleted */
  costId: string | null;
  name: string;
  qty: number;
  /** ex-GST cost of one portion of the component (0 when missing) */
  unitCost: number;
  /** unitCost x qty */
  cost: number;
  /** inc-GST regular price of one (the line override, else the component's sell price); null when unknown */
  unitRegularInc: number | null;
  /** unitRegularInc x qty */
  regularInc: number | null;
  /** the component's own GP target (null when deleted) */
  targetGp: number | null;
  /** share of the offer's total cost, 0-1 */
  costShare: number;
  missing: MissingReason | null;
}

export type TargetSource = "override" | "dominant" | "default";

export interface OfferCost {
  lines: OfferLineCost[];
  /** ex GST, sum of component cost per portion x qty */
  cost: number;
  /** inc GST, sum of component sell prices (or line overrides) x qty. Sums the known ones; see regularComplete */
  regularPriceInc: number;
  /** true when every line has a regular price, so regularPriceInc and the discount are trustworthy */
  regularComplete: boolean;
  offerPriceInc: number | null;
  /** regular - offer, inc GST; null unless regularComplete and an offer price is set */
  discountInc: number | null;
  discountPct: number | null;
  offerPriceEx: number | null;
  gpDollars: number | null;
  gpPct: number | null;
  targetGp: number;
  targetSource: TargetSource;
  /** name of the component whose target was used (targetSource "dominant") */
  targetFrom: string | null;
  underTarget: boolean;
  /** the offer sells for less than it costs */
  belowCost: boolean;
  /** inc-GST price that hits the target, rounded UP to settings.round_to; null when there is no cost to price from */
  suggestedPriceInc: number | null;
  /** candidate prices around the suggestion with GP% at each */
  ladder: PriceStep[];
  /** components that are deleted, unpriced or cost $0 */
  missing: MissingComponent[];
  /** true when any component's own cost is flagged untrustworthy (see ItemCost.needsCheck) */
  needsCheck: boolean;
  /** has at least one line and nothing missing */
  complete: boolean;
}

/**
 * Cost an offer.
 *
 * TARGET RULE. The offer's target is offer.target_override when set. Otherwise it is the target of the component
 * with the largest share of the cost (the venue's category target for that item, or a per-beer override, exactly
 * as the component would be judged on its own). Reason: the biggest cost drives the margin, so a pot + burger
 * combo is held to the burger's Food target, not the beer's. Ties go to the LOWER target (the safer call for the
 * owners). With no costs at all the first component decides; with no components the app default applies.
 */
export function costOffer(offer: Pick<Offer, "price_inc" | "target_override">, lines: OfferLine[], ctx: OfferCostCtx): OfferCost {
  const gst = ctx.settings.gst_rate;
  const sorted = [...lines].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const out: OfferLineCost[] = [];
  const missing: MissingComponent[] = [];
  let needsCheck = false;
  let cost = 0;
  let regular = 0;
  let regularComplete = sorted.length > 0;

  for (const line of sorted) {
    const qty = Number(line.qty) > 0 ? Number(line.qty) : 0;
    const costId = offerLineCostId(line);
    const c = costId ? ctx.itemCosts.get(costId) : undefined;
    const override = line.price_inc_override != null && Number(line.price_inc_override) > 0 ? Number(line.price_inc_override) : null;
    if (!c) {
      missing.push({ lineId: line.id, name: "Removed item", reason: "deleted" });
      // a deleted component with a typed regular price still counts toward the regular price
      if (override == null) regularComplete = false;
      else regular += override * qty;
      out.push({ line, costId, name: "Removed item", qty, unitCost: 0, cost: 0, unitRegularInc: override, regularInc: override != null ? override * qty : null, targetGp: null, costShare: 0, missing: "deleted" });
      continue;
    }
    const unitCost = c.costPerPortion;
    const sellInc = c.sellInc != null && c.sellInc > 0 ? c.sellInc : null;
    const unitRegularInc = override ?? sellInc;
    let reason: MissingReason | null = null;
    if (!(unitCost > 0)) reason = "no_cost";
    else if (unitRegularInc == null) reason = "no_price";
    if (unitRegularInc == null) regularComplete = false;
    if (reason) missing.push({ lineId: line.id, name: c.item.name, reason });
    if (c.needsCheck) needsCheck = true;
    cost += unitCost * qty;
    if (unitRegularInc != null) regular += unitRegularInc * qty;
    out.push({
      line,
      costId,
      name: c.item.name,
      qty,
      unitCost,
      cost: unitCost * qty,
      unitRegularInc,
      regularInc: unitRegularInc != null ? unitRegularInc * qty : null,
      targetGp: c.targetGp,
      costShare: 0,
      missing: reason,
    });
  }
  for (const l of out) l.costShare = cost > 0 ? l.cost / cost : 0;

  // target
  let targetGp = DEFAULT_TARGET_GP;
  let targetSource: TargetSource = "default";
  let targetFrom: string | null = null;
  if (offer.target_override != null && !Number.isNaN(Number(offer.target_override))) {
    targetGp = Number(offer.target_override);
    targetSource = "override";
  } else {
    const resolved = out.filter((l) => l.targetGp != null);
    if (resolved.length) {
      const dominant = resolved.reduce((best, l) => {
        if (l.cost > best.cost + 1e-9) return l;
        if (Math.abs(l.cost - best.cost) <= 1e-9 && (l.targetGp as number) < (best.targetGp as number)) return l;
        return best;
      });
      targetGp = dominant.targetGp as number;
      targetSource = "dominant";
      targetFrom = dominant.name;
    }
  }

  const offerPriceInc = offer.price_inc != null && Number(offer.price_inc) > 0 ? Number(offer.price_inc) : null;
  const hasCost = out.some((l) => l.missing !== "deleted");
  let offerPriceEx: number | null = null;
  let gpDollars: number | null = null;
  let gpPct: number | null = null;
  // A missing, unpriced or $0 component means the cost above is partial, so a GP worked out from it would flatter the offer:
  // no GP, no suggestion, and the offer is flagged for checking instead of ever being called on or below target.
  const costMissing = missing.some((m) => m.reason !== "no_price"); // no_price only blocks the discount, not the cost
  const untrusted = costMissing || needsCheck;
  needsCheck = untrusted;
  if (offerPriceInc != null && hasCost && !costMissing) {
    offerPriceEx = sellExGst(offerPriceInc, gst);
    const g = gpFromPrice(cost, offerPriceInc, gst);
    gpDollars = g.gpDollars;
    gpPct = g.gpPct;
  }
  const discountInc = regularComplete && offerPriceInc != null ? regular - offerPriceInc : null;
  const discountPct = discountInc != null && regular > 0 ? discountInc / regular : null;
  const suggested = cost > 0 && !costMissing ? suggestedPrice(cost, targetGp, gst, ctx.settings.round_to) : 0;
  const step = ctx.settings.round_to > 0 ? ctx.settings.round_to : 0.5;

  return {
    lines: out,
    cost,
    regularPriceInc: regular,
    regularComplete,
    offerPriceInc,
    discountInc,
    discountPct,
    offerPriceEx,
    gpDollars,
    gpPct,
    targetGp,
    targetSource,
    targetFrom,
    underTarget: !untrusted && gpPct != null && gpPct < targetGp - 1e-9,
    belowCost: !untrusted && gpDollars != null && gpDollars < 0,
    suggestedPriceInc: suggested > 0 ? suggested : null,
    ladder: cost > 0 && !costMissing ? priceLadder(cost, targetGp, gst, step) : [],
    missing,
    needsCheck,
    complete: out.length > 0 && missing.length === 0,
  };
}

export function groupOfferLines(lines: OfferLine[]): Map<string, OfferLine[]> {
  const m = new Map<string, OfferLine[]>();
  for (const l of lines) {
    const arr = m.get(l.offer_id);
    if (arr) arr.push(l);
    else m.set(l.offer_id, [l]);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  return m;
}

/** Live offers now under their target (or below cost), worst gap first. Feeds Offers Below Target on Home. */
export function liveOffersUnderTarget(offers: Offer[], costs: Map<string, OfferCost>, venueId?: number | null): { offer: Offer; cost: OfferCost }[] {
  const out: { offer: Offer; cost: OfferCost }[] = [];
  for (const o of offers) {
    if (o.status !== "live") continue;
    if (venueId != null && o.venue_id !== venueId) continue;
    const c = costs.get(o.id);
    if (c && (c.underTarget || c.belowCost)) out.push({ offer: o, cost: c });
  }
  return out.sort((a, b) => (a.cost.gpPct ?? 0) - a.cost.targetGp - ((b.cost.gpPct ?? 0) - b.cost.targetGp));
}

/** Live offers whose components need checking (a deleted, unpriced or $0 item, or a flagged cost): no GP claim is made for them. */
export function liveOffersToCheck(offers: Offer[], costs: Map<string, OfferCost>, venueId?: number | null): { offer: Offer; cost: OfferCost }[] {
  const out: { offer: Offer; cost: OfferCost }[] = [];
  for (const o of offers) {
    if (o.status !== "live") continue;
    if (venueId != null && o.venue_id !== venueId) continue;
    const c = costs.get(o.id);
    if (c && c.needsCheck) out.push({ offer: o, cost: c });
  }
  return out.sort((a, b) => a.offer.name.localeCompare(b.offer.name));
}

/* ---------------------------------------------------------------- time windows (Brisbane) */

const BRISBANE_OFFSET_MS = 10 * 3_600_000; // AEST all year, Queensland has no daylight saving

export interface BrisbaneNow {
  /** YYYY-MM-DD */
  date: string;
  /** 0 = Sunday ... 6 = Saturday */
  dow: number;
  /** minutes since midnight */
  minutes: number;
}

/** Brisbane wall-clock date, weekday and minute of day for an instant. */
export function brisbaneNow(now: Date = new Date()): BrisbaneNow {
  const d = new Date(now.getTime() + BRISBANE_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    dow: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** "16:30" or "16:30:00" to minutes since midnight; null when blank or invalid. */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Is a Live offer trading right now (Brisbane time)? Draft and Retired are never live.
 * Checks the date window (inclusive), the days of the week and the time window. A time window that
 * runs past midnight (10pm to 2am) counts its after-midnight part against the day it started on.
 * Blank time = all day, blank days = every day, blank dates = no limit.
 */
export function isLiveNow(offer: Pick<Offer, "status" | "starts_on" | "ends_on" | "days_of_week" | "time_from" | "time_to">, now: Date = new Date()): boolean {
  if (offer.status !== "live") return false;
  const b = brisbaneNow(now);
  const from = timeToMinutes(offer.time_from);
  const to = timeToMinutes(offer.time_to);
  // which trading day does this moment belong to?
  let sessionDate = b.date;
  let sessionDow = b.dow;
  let inTime: boolean;
  if (from != null && to != null && from > to) {
    if (b.minutes >= from) inTime = true;
    else if (b.minutes < to) {
      inTime = true;
      sessionDate = shiftDate(b.date, -1);
      sessionDow = (b.dow + 6) % 7;
    } else inTime = false;
  } else {
    inTime = (from == null || b.minutes >= from) && (to == null || b.minutes < to);
  }
  if (!inTime) return false;
  if (offer.days_of_week && offer.days_of_week.length && !offer.days_of_week.includes(sessionDow)) return false;
  if (offer.starts_on && sessionDate < offer.starts_on) return false;
  if (offer.ends_on && sessionDate > offer.ends_on) return false;
  return true;
}

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayName(dow: number): string {
  return DAY_ABBR[dow] ?? "";
}

/** "Fri", "Mon to Fri", "Fri, Sat", "Every Day". Weeks run Monday to Sunday. */
export function daysLabel(days: number[] | null | undefined): string {
  if (!days || !days.length || new Set(days).size >= 7) return "Every Day";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const set = new Set(days);
  const picked = order.filter((d) => set.has(d));
  const runs: number[][] = [];
  for (const d of picked) {
    const last = runs[runs.length - 1];
    if (last && order.indexOf(d) === order.indexOf(last[last.length - 1]) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${DAY_ABBR[r[0]]} to ${DAY_ABBR[r[r.length - 1]]}` : r.map((d) => DAY_ABBR[d]).join(", "))).join(", ");
}

/** "4pm", "4:30pm", "12am". */
export function timeLabel(t: string | null | undefined): string {
  const m = timeToMinutes(t);
  if (m == null) return "";
  const h = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

function dateLabel(d: string): string {
  const [, mo, da] = d.split("-").map(Number);
  return mo && da ? `${da} ${MONTH_ABBR[mo - 1]}` : d;
}

/** One line for lists: "Fri, 4pm to 6pm, until 31 Oct". Empty when the offer has no window at all. */
export function offerWindowLabel(offer: Pick<Offer, "starts_on" | "ends_on" | "days_of_week" | "time_from" | "time_to">): string {
  const parts: string[] = [];
  if (offer.days_of_week && offer.days_of_week.length && new Set(offer.days_of_week).size < 7) parts.push(daysLabel(offer.days_of_week));
  const a = timeLabel(offer.time_from);
  const z = timeLabel(offer.time_to);
  if (a && z) parts.push(`${a} to ${z}`);
  else if (a) parts.push(`from ${a}`);
  else if (z) parts.push(`until ${z}`);
  if (offer.starts_on && offer.ends_on) parts.push(`${dateLabel(offer.starts_on)} to ${dateLabel(offer.ends_on)}`);
  else if (offer.starts_on) parts.push(`from ${dateLabel(offer.starts_on)}`);
  else if (offer.ends_on) parts.push(`until ${dateLabel(offer.ends_on)}`);
  return parts.join(", ");
}
