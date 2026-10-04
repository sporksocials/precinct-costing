/**
 * Home dashboard maths. Pure and framework free: components/dashboard.tsx draws it, components/today-feed.tsx keeps the
 * complete grouped feed on /alerts. Everything here takes the OPEN alert lists (ignored alerts already taken out with
 * openRows), so a count on Home always matches the list behind it.
 */
import { DEFAULT_TARGET_GP, type Ingredient, type Venue } from "./types";
import type { ItemCost } from "./costing";
import { parseVirtualItemId } from "./gelato";
import type { CatalogueGap, CheckCostGroup, DealFeedRow, HappyHourRow, MissingPriceGroup, PriceIncrease, UnderRow } from "./insights";
import { gpSummary, isOffMenu } from "./insights";
import type { Offer } from "./types";
import { offerKindLabel, type OfferCost } from "./offers";
import { dealSummary } from "./deals";
import { daysAgo, dateShort, gp, money, movePct } from "./format";
import {
  belowTargetEntry,
  catalogueGapEntry,
  checkCostEntry,
  dealEntry,
  happyHourEntry,
  missingPriceEntry,
  offerBelowTargetEntry,
  offerBelowTargetKey,
  offerCheckEntry,
  offerCheckKey,
  priceRiseEntry,
  stalePriceEntry,
  type AlertEntry,
  type AlertKind,
} from "./ignored-alerts";

type OfferRow = { offer: Offer; cost: OfferCost };

/** Every open (not ignored) alert list the Today feed builds, for one venue choice. */
export interface OpenAlerts {
  under: UnderRow[];
  missing: MissingPriceGroup[];
  rises: PriceIncrease[];
  check: CheckCostGroup[];
  stale: Ingredient[];
  gaps: CatalogueGap[];
  happy: HappyHourRow[];
  deals: DealFeedRow[];
  offersBelow: OfferRow[];
  offersCheck: OfferRow[];
}

export interface AlertTotals {
  /** every open alert of every kind (what the Needs Attention header shows and View All opens) */
  total: number;
  under: number;
  missing: number;
  rises: number;
  /** price rises that now leave at least one dish below target */
  risesUnder: number;
  check: number;
  stale: number;
  gaps: number;
  happy: number;
  deals: number;
  offersBelow: number;
  offersCheck: number;
}

export function alertTotals(a: OpenAlerts): AlertTotals {
  const t = {
    under: a.under.length,
    missing: a.missing.length,
    rises: a.rises.length,
    risesUnder: a.rises.filter((r) => r.underCount > 0).length,
    check: a.check.length,
    stale: a.stale.length,
    gaps: a.gaps.length,
    happy: a.happy.length,
    deals: a.deals.length,
    offersBelow: a.offersBelow.length,
    offersCheck: a.offersCheck.length,
  };
  return { ...t, total: t.under + t.missing + t.rises + t.check + t.stale + t.gaps + t.happy + t.deals + t.offersBelow + t.offersCheck };
}

/* ---------------------------------------------------------------- GP against target */

export type GpLevel = "good" | "warn" | "bad" | "none";

export interface GpStatus {
  level: GpLevel;
  /** the word that carries the status (colour only backs it up) */
  word: string;
  /** average minus target, in whole-GP fractions (-0.02 = 2 points under); null with no GP */
  gap: number | null;
  /** "+3 pts", "-2 pts" or null */
  gapText: string | null;
}

/** "-2 pts", "+3 pts", "-0.4 pts". Whole points from 1 up, one decimal below. */
export function formatPts(gap: number): string {
  const pts = gap * 100;
  const abs = Math.abs(pts);
  if (abs < 0.05) return "0 pts";
  const n = abs >= 1 ? String(Math.round(abs)) : abs.toFixed(1);
  return `${pts < 0 ? "-" : "+"}${n} pts`;
}

/** Average GP against its target: at or over is On Target, within 5 points under is Just Under, further is Below Target. */
export function gpStatus(avg: number | null, target: number | null): GpStatus {
  if (avg == null || target == null) return { level: "none", word: "No GP Yet", gap: null, gapText: null };
  const gap = avg - target;
  if (gap >= -1e-9) return { level: "good", word: "On Target", gap, gapText: gap >= 0.005 ? formatPts(gap) : null };
  if (gap > -0.05) return { level: "warn", word: "Just Under", gap, gapText: formatPts(gap) };
  return { level: "bad", word: "Below Target", gap, gapText: formatPts(gap) };
}

/** The target the average is judged against: the mean target of the items that make up the average (same rules as gpSummary). */
export function gpTarget(costs: Iterable<ItemCost>, venueId?: number | null): number {
  let sum = 0;
  let n = 0;
  for (const c of costs) {
    if (!c.item.active || c.gpPct == null || c.needsCheck || isOffMenu(c)) continue;
    if (venueId != null && c.item.venue_id !== venueId) continue;
    sum += c.targetGp;
    n += 1;
  }
  return n ? sum / n : DEFAULT_TARGET_GP;
}

export interface VenueGpRow {
  venue: Venue;
  avg: number | null;
  target: number;
  /** priced items in the average */
  count: number;
  /** open below-target alerts in this venue */
  under: number;
  status: GpStatus;
}

/** One row per venue (in the venues' order) for the By Venue bars. `under` counts open (not ignored) below-target rows only. */
export function venueGpRows(costs: Iterable<ItemCost>, venues: readonly Venue[], openUnder: readonly UnderRow[]): VenueGpRow[] {
  const all = Array.from(costs);
  return venues.map((venue) => {
    const s = gpSummary(all, venue.id);
    const target = gpTarget(all, venue.id);
    return {
      venue,
      avg: s.avg,
      target,
      count: s.count,
      under: openUnder.filter((r) => r.cost.item.venue_id === venue.id).length,
      status: gpStatus(s.avg, s.avg == null ? null : target),
    };
  });
}

/* ---------------------------------------------------------------- the plain-English sentence */

export type SummaryTone = "good" | "warn" | "danger" | "neutral";

/**
 * "3 dishes and drinks are below target. 1 item has no sell price. 2 prices rose in the last 30 days." The first three
 * things that need a look, most important first; All Clear words when there is nothing open.
 */
export function summarySentence(t: AlertTotals, opts: { gelato?: boolean; hasData: boolean }): { text: string; tone: SummaryTone } {
  if (!opts.hasData && t.total === 0) return { text: "Add a recipe to start tracking GP.", tone: "neutral" };
  const noun = opts.gelato ? { one: "serve", many: "serves", belowOne: "1 serve is", belowMany: "serves are" } : { one: "item", many: "items", belowOne: "1 dish or drink is", belowMany: "dishes and drinks are" };
  const parts: string[] = [];
  if (t.under) parts.push(t.under === 1 ? `${noun.belowOne} below target` : `${t.under} ${noun.belowMany} below target`);
  if (t.offersBelow) parts.push(t.offersBelow === 1 ? "1 special is below target" : `${t.offersBelow} specials are below target`);
  if (t.missing) parts.push(t.missing === 1 ? `1 ${noun.one} has no sell price` : `${t.missing} ${noun.many} have no sell price`);
  if (t.rises) parts.push(t.rises === 1 ? "1 price rose in the last 30 days" : `${t.rises} prices rose in the last 30 days`);
  if (t.check) parts.push(t.check === 1 ? "1 cost needs checking" : `${t.check} costs need checking`);
  if (parts.length) {
    const text = parts
      .slice(0, 3)
      .map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)}.`)
      .join(" ");
    return { text, tone: t.under || t.offersBelow ? "danger" : "warn" };
  }
  if (t.total > 0) return { text: `Nothing urgent. ${t.total} smaller ${t.total === 1 ? "thing is" : "things are"} worth a look.`, tone: "neutral" };
  return { text: "All clear. Every dish is on target and prices are up to date.", tone: "good" };
}

/* ---------------------------------------------------------------- the Price Alerts tile */

/** Where the Price Alerts tile opens on /alerts: price rises first (the cause), else missing prices, else the top. */
export function priceAlertsAnchor(t: Pick<AlertTotals, "rises" | "missing">): string {
  return t.rises > 0 ? "#price-rises" : t.missing > 0 ? "#missing-price" : "";
}

/* ---------------------------------------------------------------- Needs Attention: ranking */

export type AttentionIcon = "below" | "price" | "rise" | "check" | "clock" | "store" | "tag" | "deal-ending" | "deal-expired";
export type AttentionTone = "danger" | "warn" | "neutral" | "accent";

export interface AttentionItem {
  key: string;
  kind: AlertKind;
  /** lower is more important */
  tier: number;
  entry: AlertEntry;
  href: string;
  icon: AttentionIcon;
  tone: AttentionTone;
  title: string;
  sub: string;
  trailing: { text: string; tone: AttentionTone } | null;
}

/**
 * Importance tiers (lower first). Within a tier the rows are ordered as named in `rankAttention`.
 *   1 below target (dishes and live specials), largest gap first   2 missing sell price   3 happy hour below cost (a loss)
 *   4 price rise that leaves dishes below target   5 other price rises, biggest percent first   6 check cost
 *   7 price not checked, oldest first   8 catalogue difference   9 happy hour under target   10 deal expired   11 deal ending   12 offer to check
 */
export const TIER = { below: 1, missing: 2, loss: 3, riseUnder: 4, rise: 5, check: 6, stale: 7, gap: 8, happy: 9, dealExpired: 10, dealEnding: 11, offerCheck: 12 } as const;

/** How many rows the card shows: 3 on a phone, 5 from tablet width up (Tailwind md). */
export const ATTENTION_CAP_PHONE = 3;
export const ATTENTION_CAP_WIDE = 5;

/** A short title for a below-target row: gelato serves by serve name and worst flavour, everything else by name. */
export function underRowName(r: UnderRow): string {
  const v = parseVirtualItemId(r.cost.item.id);
  if (!v) return r.cost.item.name;
  return `${r.cost.item.section} (${r.cost.item.name.split(" - ")[0]}${r.flavours > 1 ? ` +${r.flavours - 1}` : ""})`;
}

export interface AttentionCtx {
  /** short venue name for an id ("Drift") */
  venueName: (venueId: number) => string;
  /** true when the venue filter is All: rows then say which venue they belong to */
  showVenue: boolean;
}

interface Ranked {
  item: AttentionItem;
  order: number[];
}

const byOrder = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** "-10 pts" for the gap between a GP and its target. */
const gapText = (g: number | null, target: number) => formatPts((g ?? 0) - target);

/** Every open alert as one list, most important first (see TIER). Ties keep the feed's own order. */
export function rankAttention(a: OpenAlerts, ctx: AttentionCtx): AttentionItem[] {
  const out: Ranked[] = [];
  const v = (id: number) => (ctx.showVenue ? `${ctx.venueName(id)} · ` : "");
  const push = (item: AttentionItem, ...order: number[]) => out.push({ item, order });

  for (const r of a.under) {
    const c = r.cost;
    const entry = belowTargetEntry(r, underRowName(r));
    push(
      {
        key: entry.key,
        kind: "below_target",
        tier: TIER.below,
        entry,
        href: `/items/${c.item.id}`,
        icon: "below",
        tone: "danger",
        title: underRowName(r),
        sub: `${v(c.item.venue_id)}${gp(c.gpPct, 1, c.targetGp)} vs ${gp(c.targetGp, 0)} target`,
        trailing: { text: gapText(c.gpPct, c.targetGp), tone: "danger" },
      },
      (c.gpPct ?? 0) - c.targetGp,
    );
  }
  for (const { offer, cost } of a.offersBelow) {
    const entry = offerBelowTargetEntry(offer);
    push(
      {
        key: entry.key,
        kind: "offer_below_target",
        tier: TIER.below,
        entry,
        href: `/specials/${offer.id}`,
        icon: "tag",
        tone: "danger",
        title: offer.name,
        sub: [ctx.showVenue ? ctx.venueName(offer.venue_id) : null, offerKindLabel(offer.kind), `${gp(cost.gpPct, 1, cost.targetGp)} vs ${gp(cost.targetGp, 0)} target`].filter(Boolean).join(" · "),
        trailing: { text: gapText(cost.gpPct, cost.targetGp), tone: "danger" },
      },
      (cost.gpPct ?? 0) - cost.targetGp,
    );
  }
  for (const m of a.missing) {
    const entry = missingPriceEntry(m);
    push({
      key: entry.key,
      kind: "missing_price",
      tier: TIER.missing,
      entry,
      href: m.href,
      icon: "price",
      tone: "warn",
      title: m.count > 1 ? `${m.name} (${m.count} serves)` : m.name,
      sub: [ctx.showVenue ? ctx.venueName(m.venueId) : null, "No sell price", m.suggestedInc != null ? `${money(m.suggestedInc)} would give ${gp(m.targetGp, 0)}` : null].filter(Boolean).join(" · "),
      trailing: { text: "Add Price", tone: "accent" },
    });
  }
  for (const h of a.happy) {
    const entry = happyHourEntry(h);
    push(
      {
        key: entry.key,
        kind: "happy_hour",
        tier: h.belowCost ? TIER.loss : TIER.happy,
        entry,
        href: `/items/${h.cost.item.id}`,
        icon: "tag",
        tone: h.belowCost ? "danger" : "warn",
        title: h.cost.item.name,
        sub: `${v(h.cost.item.venue_id)}Happy hour ${money(h.hhPrice)} · ${h.belowCost ? `below cost (${money(h.cost.costPerPortion)})` : `${gp(h.hhGpPct, 0, h.cost.targetGp)} vs ${gp(h.cost.targetGp, 0)} target`}`,
        trailing: { text: h.belowCost ? "Below Cost" : gapText(h.hhGpPct, h.cost.targetGp), tone: h.belowCost ? "danger" : "warn" },
      },
      h.hhGpPct - h.cost.targetGp,
    );
  }
  for (const r of a.rises) {
    const entry = priceRiseEntry(r);
    push(
      {
        key: entry.key,
        kind: "price_rise",
        tier: r.underCount > 0 ? TIER.riseUnder : TIER.rise,
        entry,
        href: `/ingredients/${r.ingredient.id}`,
        icon: "rise",
        tone: r.underCount > 0 ? "danger" : "warn",
        title: r.ingredient.name,
        sub: [`${money(r.log.old_price)} → ${money(r.log.new_price)}`, `${r.recipeCount} ${r.recipeCount === 1 ? "recipe" : "recipes"}`, r.underCount ? `${r.underCount} now below target` : null].filter(Boolean).join(" · "),
        trailing: { text: movePct(r.movePct), tone: r.underCount > 0 ? "danger" : "warn" },
      },
      r.underCount > 0 ? -r.underCount : 0, // most dishes pushed under first
      -r.movePct, // then the biggest percent
    );
  }
  for (const g of a.check) {
    const entry = checkCostEntry(g);
    push({
      key: entry.key,
      kind: "check_cost",
      tier: TIER.check,
      entry,
      href: g.href,
      icon: "check",
      tone: "warn",
      title: g.name,
      sub: `${v(g.venueId)}${g.warnings[0] ?? "Check the recipe"}${g.warnings.length > 1 ? ` (+${g.warnings.length - 1} more)` : ""}`,
      trailing: null,
    });
  }
  a.stale.forEach((i, idx) => {
    const entry = stalePriceEntry(i);
    push(
      {
        key: entry.key,
        kind: "stale_price",
        tier: TIER.stale,
        entry,
        href: `/ingredients/${i.id}`,
        icon: "clock",
        tone: "neutral",
        title: i.name,
        sub: i.last_price_update ? `Last checked ${dateShort(i.last_price_update)} · ${daysAgo(i.last_price_update) ?? "over 90"} days ago` : "Never checked",
        trailing: null,
      },
      idx, // the feed already lists the longest wait first
    );
  });
  for (const g of a.gaps) {
    const entry = catalogueGapEntry(g);
    push({
      key: entry.key,
      kind: "catalogue_gap",
      tier: TIER.gap,
      entry,
      href: `/ingredients/${g.ingredient.id}`,
      icon: "store",
      tone: "accent",
      title: g.ingredient.name,
      sub: `Catalogue ${g.diffPct > 0 ? "+" : ""}${Math.round(g.diffPct * 100)}% · ${money(g.theirs)} vs ${money(g.ours)} per ${g.ingredient.pack_unit}`,
      trailing: null,
    });
  }
  for (const d of a.deals) {
    const entry = dealEntry(d);
    const expired = d.kind === "deal_expired";
    push(
      {
        key: entry.key,
        kind: d.kind,
        tier: expired ? TIER.dealExpired : TIER.dealEnding,
        entry,
        href: `/ingredients/${d.ingredient.id}`,
        icon: expired ? "deal-expired" : "deal-ending",
        tone: expired ? "danger" : "warn",
        title: d.ingredient.name,
        sub: expired ? `${dealSummary(d.deal)} · back on ${money(d.ingredient.pack_price)} a pack` : `${dealSummary(d.deal)} · ${d.days === 0 ? "ends today" : d.days === 1 ? "ends tomorrow" : `ends in ${d.days} days`}`,
        trailing: null,
      },
      d.days,
    );
  }
  for (const { offer } of a.offersCheck) {
    const entry = offerCheckEntry(offer);
    push({
      key: entry.key,
      kind: "offer_check",
      tier: TIER.offerCheck,
      entry,
      href: `/specials/${offer.id}`,
      icon: "check",
      tone: "warn",
      title: offer.name,
      sub: [ctx.showVenue ? ctx.venueName(offer.venue_id) : null, offerKindLabel(offer.kind), "Check components"].filter(Boolean).join(" · "),
      trailing: null,
    });
  }

  // Array.prototype.sort is stable, so equal rows keep the order they were pushed in
  return out.sort((x, y) => x.item.tier - y.item.tier || byOrder(x.order, y.order)).map((r) => r.item);
}

/**
 * How a ranked row shows. "always" rows show at every width, "wide" rows only from tablet width up (CSS decides, so the
 * server and the first client render agree), "none" rows are not drawn (they are one tap away under View All).
 */
export function attentionVisibility(index: number): "always" | "wide" | "none" {
  return index < ATTENTION_CAP_PHONE ? "always" : index < ATTENTION_CAP_WIDE ? "wide" : "none";
}

/** Whether the View All button shows, and whether it hides from tablet width up (when the card already holds everything). */
export function viewAllState(total: number): { show: boolean; hideWide: boolean } {
  return { show: total > ATTENTION_CAP_PHONE, hideWide: total <= ATTENTION_CAP_WIDE };
}

/* ---------------------------------------------------------------- specials running */

export type SpecialStatus = "on" | "below" | "check" | "ignored" | "unpriced";

export interface SpecialRow {
  offer: Offer;
  cost: OfferCost;
  status: SpecialStatus;
}

export interface SpecialsSummary {
  /** live offers in this venue choice */
  live: number;
  /** live offers on target, with a GP to show for it */
  on: number;
  below: number;
  check: number;
  /** worst first: below target, to check, then the rest by name */
  rows: SpecialRow[];
}

const SPECIAL_ORDER: Record<SpecialStatus, number> = { below: 0, check: 1, unpriced: 2, ignored: 3, on: 4 };

/**
 * The live specials for the dashboard. A below-target or to-check special whose alert is ignored reads "ignored" and
 * counts as neither, the same way Home leaves ignored alerts out of every other count.
 */
export function specialsSummary(offers: readonly Offer[], costs: ReadonlyMap<string, OfferCost>, venueId: number | null, ignored: ReadonlySet<string>): SpecialsSummary {
  const rows: SpecialRow[] = [];
  for (const offer of offers) {
    if (offer.status !== "live" || (venueId != null && offer.venue_id !== venueId)) continue;
    const cost = costs.get(offer.id);
    if (!cost) continue;
    let status: SpecialStatus;
    if (cost.needsCheck) status = ignored.has(offerCheckKey(offer)) ? "ignored" : "check";
    else if (cost.underTarget || cost.belowCost) status = ignored.has(offerBelowTargetKey(offer)) ? "ignored" : "below";
    else if (cost.gpPct == null) status = "unpriced";
    else status = "on";
    rows.push({ offer, cost, status });
  }
  rows.sort((a, b) => SPECIAL_ORDER[a.status] - SPECIAL_ORDER[b.status] || ((a.cost.gpPct ?? 0) - a.cost.targetGp) - ((b.cost.gpPct ?? 0) - b.cost.targetGp) || a.offer.name.localeCompare(b.offer.name));
  return {
    live: rows.length,
    on: rows.filter((r) => r.status === "on").length,
    below: rows.filter((r) => r.status === "below").length,
    check: rows.filter((r) => r.status === "check").length,
    rows,
  };
}

/** The word for a special's status. */
export function specialStatusWord(s: SpecialStatus): string {
  return { on: "On Target", below: "Below Target", check: "Check Items", ignored: "Alert Ignored", unpriced: "No Price" }[s];
}
