/**
 * Ignored alerts on the Today feed. Pure and framework free; lib/store.tsx saves them and components/alert-parts.tsx shows them.
 *
 * An alert is identified by an `alert_key`: its kind, the thing it is about, and (where it helps) the state it was
 * raised in. Ignoring hides that exact key. If the situation changes, the key changes and the alert shows again:
 *   price_rise      price_rise:<ingredient id>:<price log id>            a later, different rise is a new price log row
 *   below_target    below_target:<item id>:<sell price in cents>         a new price that is still low shows again
 *                   below_target:gelato-serve:<serve id>:<cents>         a gelato serve is one alert for all its flavours
 *   check_cost      check_cost:<item id>:<warning signature>             digits in the warnings are ignored ("GP is 95%" = "GP is 94%")
 *                   check_cost:beer:<beer id>:<signature>                one alert per tap beer
 *                   check_cost:gelato:<signature>                        gelato serves with the same warnings are one alert
 *   missing_price   missing_price:<item id | beer:<id> | gelato:<serve id>>
 *   happy_hour      happy_hour:<item id>:<happy hour price in cents>[:loss]   ":loss" once it is below cost, so a worse state shows again
 *   stale_price     stale_price:<ingredient id>:<date last checked | never>   checking the price and letting it go stale again is a new alert
 *   catalogue_gap   catalogue_gap:<ingredient id>:<catalogue price>           a new catalogue price shows again
 *   deal_ending     deal_ending:<deal id>:<end date>
 *   deal_expired    deal_expired:<deal id>:<end date>
 *   offer_below_target  offer_below_target:<offer id>:<offer price in cents>
 *   offer_check     offer_check:<offer id>
 *
 * A key is only ever matched exactly, so nothing here can hide an alert that was not ignored.
 */
import type { ItemCost } from "./costing";
import { parseVirtualItemId } from "./gelato";
import type { CatalogueGap, CheckCostGroup, DealFeedRow, FeedKind, HappyHourRow, MissingPriceGroup, PriceIncrease, UnderRow } from "./insights";
import type { Ingredient, IgnoredAlert, Offer } from "./types";
import { movePct } from "./format";

/** Every alert the Today feed can show: the feed kinds plus the two kinds of offer alert. */
export type AlertKind = FeedKind | "offer_below_target" | "offer_check";

export const ALERT_KINDS: AlertKind[] = [
  "price_rise",
  "below_target",
  "check_cost",
  "missing_price",
  "happy_hour",
  "stale_price",
  "catalogue_gap",
  "deal_ending",
  "deal_expired",
  "offer_below_target",
  "offer_check",
];

/** Title Case names for the Ignored list. */
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  price_rise: "Price Rise",
  below_target: "Below Target",
  check_cost: "Check Cost",
  missing_price: "Missing Price",
  happy_hour: "Happy Hour",
  stale_price: "Price Not Checked",
  catalogue_gap: "Catalogue Difference",
  deal_ending: "Deal Ending",
  deal_expired: "Deal Expired",
  offer_below_target: "Offer Below Target",
  offer_check: "Offer To Check",
};

export function alertKindLabel(kind: string): string {
  return ALERT_KIND_LABEL[kind as AlertKind] ?? "Alert";
}

/** What gets saved when an alert is ignored (and what the Ignored list is built from). */
export interface AlertEntry {
  key: string;
  kind: AlertKind;
  /** the app path the alert opens */
  ref: string;
  /** what the alert is called, saved so the Ignored list can say what it was */
  title: string;
}

const cents = (n: number | null | undefined): number => Math.round(Number(n ?? 0) * 100);

/** Warnings with their numbers blanked, so a changing figure ("GP is 95%") does not make a new alert. */
function warningSignature(warnings: readonly string[]): string {
  return warnings.map((w) => w.replace(/\d+/g, "#")).join("|");
}

/** Key for a below-target item or gelato serve. A gelato flavour x serve is one alert per serve (the price is the serve's). */
export function belowTargetKey(c: Pick<ItemCost, "item" | "sellInc">): string {
  const v = parseVirtualItemId(c.item.id);
  return v ? `below_target:gelato-serve:${v.serveId}:${cents(c.sellInc)}` : `below_target:${c.item.id}:${cents(c.sellInc)}`;
}

export function priceRiseKey(r: Pick<PriceIncrease, "ingredient" | "log">): string {
  return `price_rise:${r.ingredient.id}:${r.log.id}`;
}

export function checkCostKey(g: Pick<CheckCostGroup, "id" | "warnings">): string {
  const sig = warningSignature(g.warnings);
  return g.id.startsWith("gelato:") ? `check_cost:gelato:${sig}` : `check_cost:${g.id}:${sig}`;
}

export function missingPriceKey(g: Pick<MissingPriceGroup, "id">): string {
  return `missing_price:${g.id}`;
}

export function happyHourKey(h: Pick<HappyHourRow, "cost" | "hhPrice" | "belowCost">): string {
  return `happy_hour:${h.cost.item.id}:${cents(h.hhPrice)}${h.belowCost ? ":loss" : ""}`;
}

export function stalePriceKey(i: Pick<Ingredient, "id" | "last_price_update">): string {
  return `stale_price:${i.id}:${i.last_price_update ? i.last_price_update.slice(0, 10) : "never"}`;
}

export function catalogueGapKey(g: Pick<CatalogueGap, "ingredient" | "portal">): string {
  return `catalogue_gap:${g.ingredient.id}:${Number(g.portal.price)}`;
}

export function dealKey(r: Pick<DealFeedRow, "kind" | "deal">): string {
  return `${r.kind}:${r.deal.id}:${r.deal.ends_on ?? ""}`;
}

export function offerBelowTargetKey(o: Pick<Offer, "id" | "price_inc">): string {
  return `offer_below_target:${o.id}:${cents(o.price_inc)}`;
}

export function offerCheckKey(o: Pick<Offer, "id">): string {
  return `offer_check:${o.id}`;
}

// ---------------------------------------------------------------- entries (key + kind + where it opens + what it is called)

export const priceRiseEntry = (r: PriceIncrease): AlertEntry => ({
  key: priceRiseKey(r),
  kind: "price_rise",
  ref: `/ingredients/${r.ingredient.id}`,
  title: `${r.ingredient.name} ${movePct(r.movePct)}`,
});

export const belowTargetEntry = (r: UnderRow, name: string): AlertEntry => ({
  key: belowTargetKey(r.cost),
  kind: "below_target",
  ref: `/items/${r.cost.item.id}`,
  title: name,
});

export const checkCostEntry = (g: CheckCostGroup): AlertEntry => ({ key: checkCostKey(g), kind: "check_cost", ref: g.href, title: g.name });

export const missingPriceEntry = (g: MissingPriceGroup): AlertEntry => ({
  key: missingPriceKey(g),
  kind: "missing_price",
  ref: g.href,
  title: g.count > 1 ? `${g.name} (${g.count} serves)` : g.name,
});

export const happyHourEntry = (h: HappyHourRow): AlertEntry => ({ key: happyHourKey(h), kind: "happy_hour", ref: `/items/${h.cost.item.id}`, title: h.cost.item.name });

export const stalePriceEntry = (i: Ingredient): AlertEntry => ({ key: stalePriceKey(i), kind: "stale_price", ref: `/ingredients/${i.id}`, title: i.name });

export const catalogueGapEntry = (g: CatalogueGap): AlertEntry => ({
  key: catalogueGapKey(g),
  kind: "catalogue_gap",
  ref: `/ingredients/${g.ingredient.id}`,
  title: g.ingredient.name,
});

export const dealEntry = (r: DealFeedRow): AlertEntry => ({ key: dealKey(r), kind: r.kind, ref: `/ingredients/${r.ingredient.id}`, title: r.ingredient.name });

export const offerBelowTargetEntry = (o: Offer): AlertEntry => ({ key: offerBelowTargetKey(o), kind: "offer_below_target", ref: `/specials/${o.id}`, title: o.name });

export const offerCheckEntry = (o: Offer): AlertEntry => ({ key: offerCheckKey(o), kind: "offer_check", ref: `/specials/${o.id}`, title: o.name });

// ---------------------------------------------------------------- filtering, counting, listing

export function ignoredKeySet(ignored: readonly Pick<IgnoredAlert, "alert_key">[]): Set<string> {
  return new Set(ignored.map((a) => a.alert_key));
}

/** The rows that are still open (not ignored), in their original order. */
export function openRows<T>(rows: readonly T[], keyOf: (row: T) => string, ignored: ReadonlySet<string>): T[] {
  return rows.filter((r) => !ignored.has(keyOf(r)));
}

/** Splits rows into open and ignored (original order kept in both). */
export function splitRows<T>(rows: readonly T[], keyOf: (row: T) => string, ignored: ReadonlySet<string>): { open: T[]; ignored: T[] } {
  const open: T[] = [];
  const hidden: T[] = [];
  for (const r of rows) (ignored.has(keyOf(r)) ? hidden : open).push(r);
  return { open, ignored: hidden };
}

/** Ids of every item inside check-cost groups that are ignored (these stop counting as "need checking"). */
export function ignoredCheckItemIds(groups: readonly CheckCostGroup[], ignored: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const g of groups) if (ignored.has(checkCostKey(g))) for (const id of g.itemIds) out.add(id);
  return out;
}

/** Newest ignore first (the Ignored list). */
export function sortIgnored(ignored: readonly IgnoredAlert[]): IgnoredAlert[] {
  return [...ignored].sort((a, b) => b.ignored_at.localeCompare(a.ignored_at) || a.alert_key.localeCompare(b.alert_key));
}

/** The row saved when `entry` is ignored by `by` (an email, or null when unknown) at `at`. */
export function buildIgnoredRow(entry: AlertEntry, by: string | null, id: string, at: string): IgnoredAlert {
  return { id, alert_key: entry.key, kind: entry.kind, ref: entry.ref, title: entry.title, ignored_by: by, ignored_at: at };
}

/** The new ignored list after ignoring `entry`: nothing changes if its key is already there. */
export function withIgnored(list: readonly IgnoredAlert[], row: IgnoredAlert): IgnoredAlert[] {
  return list.some((a) => a.alert_key === row.alert_key) ? [...list] : [...list, row];
}

/** The new ignored list after restoring `key`. */
export function withoutIgnored(list: readonly IgnoredAlert[], key: string): IgnoredAlert[] {
  return list.filter((a) => a.alert_key !== key);
}

/** "troy" from troy@sporksocials.com.au, the way other lists in the app name who did something. */
export function ignoredByName(email: string | null | undefined): string {
  return email ? email.split("@")[0] : "Someone";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Oct, 3:14pm" in Brisbane time (year added when it is not this year). Month names are fixed so they read the same on every device. */
export function ignoredWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = (x: Date) => {
    const f = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
    return Object.fromEntries(f.formatToParts(x).map((p) => [p.type, p.value])) as Record<string, string>;
  };
  const p = parts(d);
  const hour = Number(p.hour) % 24;
  const time = `${hour % 12 === 0 ? 12 : hour % 12}:${p.minute}${hour < 12 ? "am" : "pm"}`;
  const year = p.year === parts(now).year ? "" : ` ${p.year}`;
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}${year}, ${time}`;
}

export const IGNORE_UNAVAILABLE = "Ignoring alerts isn’t available yet, so that didn’t save.";
