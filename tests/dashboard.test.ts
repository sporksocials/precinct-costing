import { describe, expect, it } from "vitest";
import { buildIndex, costItem, type ItemCost } from "@/lib/costing";
import type { CatalogueGap, CheckCostGroup, DealFeedRow, HappyHourRow, MissingPriceGroup, PriceIncrease, UnderRow } from "@/lib/insights";
import { missingPriceGroups, underTargetRows } from "@/lib/insights";
import {
  ATTENTION_CAP_PHONE,
  ATTENTION_CAP_WIDE,
  alertTotals,
  attentionVisibility,
  formatPts,
  gpStatus,
  sliderPos,
  gpTarget,
  priceAlertsAnchor,
  rankAttention,
  specialsSummary,
  specialStatusWord,
  summarySentence,
  venueGpRows,
  viewAllState,
  type OpenAlerts,
} from "@/lib/dashboard";
import { belowTargetKey, offerBelowTargetKey, offerCheckKey, openRows, ignoredKeySet } from "@/lib/ignored-alerts";
import type { OfferCost } from "@/lib/offers";
import { DEFAULT_SETTINGS, type Ingredient, type MenuItem, type Offer, type RecipeLine, type Venue } from "@/lib/types";

/* ---------- builders ---------- */
const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name: id, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: "2026-09-20", previous_price: null, source: null, notes: null, updated_at: null, ...over }) as Ingredient;
const item = (id: string, over: Partial<MenuItem> = {}): MenuItem =>
  ({ id, name: id, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 22, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over }) as MenuItem;
let n = 0;
const line = (parent: string, comp: string, qty: number): RecipeLine => {
  n += 1;
  return { id: `l${n}`, parent_type: "item", parent_id: parent, component_type: "ingredient", component_id: comp, qty, unit: "kg", note: null, sort: n };
};
function costAll(items: MenuItem[], ings: Ingredient[], lines: RecipeLine[]): Map<string, ItemCost> {
  const index = buildIndex(ings, [], lines);
  const cache = new Map();
  return new Map(items.map((i) => [i.id, costItem(i, index, DEFAULT_SETTINGS, [], cache)]));
}
const venue = (id: number, slug: string, name: string): Venue => ({ id, slug, name, sort: id }) as Venue;
const VENUES = [venue(1, "drift", "Drift Bar"), venue(2, "chiobu", "Chiobu")];

/** Beef costs $10/kg. At 0.3 kg a portion costs $3 (ex GST). */
const ings = [ing("beef", { pack_price: 10 })];

const empty: OpenAlerts = { under: [], missing: [], rises: [], check: [], stale: [], gaps: [], happy: [], deals: [], offersBelow: [], offersCheck: [] };
const ctx = { venueName: (id: number) => (id === 1 ? "Drift" : "Chiobu"), showVenue: false };

/* ---------- synthetic alert rows (the shapes lib/insights.ts returns) ---------- */
const under = (id: string, gpPct: number, target = 0.72): UnderRow =>
  ({ flavours: 1, cost: { item: item(id), gpPct, targetGp: target, sellInc: 14, underTarget: true } as unknown as ItemCost }) as UnderRow;
const rise = (id: string, movePct: number, underCount: number, impact = 1): PriceIncrease =>
  ({ ingredient: ing(id, { name: id }), log: { id: `log-${id}`, old_price: 10, new_price: 10 * (1 + movePct) } as never, movePct, delta: 1, recipeCount: 2, impact, underCount }) as PriceIncrease;
const missing = (id: string): MissingPriceGroup => ({ id, name: id, href: `/items/${id}`, venueId: 1, count: 1, cost: 3, suggestedInc: 14.2, targetGp: 0.72 });
const check = (id: string): CheckCostGroup => ({ id, name: id, href: `/items/${id}`, warnings: ["A line costs $0"], count: 1, itemIds: [id], venueId: 1 });
const stale = (id: string, last: string | null) => ing(id, { name: id, last_price_update: last });
const gap = (id: string, diffPct: number): CatalogueGap =>
  ({ ingredient: ing(id, { name: id }), portal: { price: 12 } as never, ours: 10, theirs: 12, diffPct }) as CatalogueGap;
const happy = (id: string, belowCost: boolean): HappyHourRow =>
  ({ kind: "happy_hour", cost: { item: item(id), costPerPortion: 3, targetGp: 0.72 } as unknown as ItemCost, hhPrice: 5, hhGpPct: 0.4, belowCost });
const deal = (id: string, kind: "deal_ending" | "deal_expired", days: number): DealFeedRow =>
  ({ kind, deal: { id, kind: "percent_off", pct_off: 0.1, ends_on: "2026-10-10" } as never, ingredient: ing(id, { name: id }), days });
const offer = (id: string, over: Partial<Offer> = {}): Offer =>
  ({ id, name: id, venue_id: 1, kind: "combo", status: "live", price_inc: 25, target_override: null, starts_on: null, ends_on: null, days_of_week: null, time_from: null, time_to: null, ...over }) as Offer;
const offerCost = (gpPct: number | null, over: Partial<OfferCost> = {}): OfferCost =>
  ({ gpPct, targetGp: 0.72, underTarget: gpPct != null && gpPct < 0.72, belowCost: false, needsCheck: false, offerPriceInc: 25, ...over }) as OfferCost;

describe("alertTotals", () => {
  it("counts every open list and the total", () => {
    const t = alertTotals({ ...empty, under: [under("a", 0.6), under("b", 0.5)], missing: [missing("m")], rises: [rise("r1", 0.2, 2), rise("r2", 0.1, 0)], check: [check("c")], stale: [stale("s", null)], deals: [deal("d", "deal_ending", 3)] });
    expect(t).toMatchObject({ under: 2, missing: 1, rises: 2, risesUnder: 1, check: 1, stale: 1, deals: 1, total: 8 });
  });
  it("is zero for nothing", () => expect(alertTotals(empty).total).toBe(0));
});

describe("rankAttention", () => {
  const all: OpenAlerts = {
    under: [under("worst", 0.5), under("mild", 0.7)],
    missing: [missing("noprice")],
    rises: [rise("big-rise", 0.4, 0), rise("pushes-under", 0.1, 2), rise("small-rise", 0.06, 0)],
    check: [check("odd-cost")],
    stale: [stale("oil", null), stale("beef", "2026-01-02")],
    gaps: [gap("fish", 0.12)],
    happy: [happy("hh-low", false), happy("hh-loss", true)],
    deals: [deal("d-end", "deal_ending", 3), deal("d-exp", "deal_expired", 2)],
    offersBelow: [{ offer: offer("combo-low"), cost: offerCost(0.6) }],
    offersCheck: [{ offer: offer("combo-check"), cost: offerCost(null, { needsCheck: true }) }],
  };
  const ranked = rankAttention(all, ctx);
  const titles = ranked.map((r) => r.title);

  it("includes every open alert exactly once", () => {
    expect(ranked).toHaveLength(alertTotals(all).total);
    expect(new Set(ranked.map((r) => r.key)).size).toBe(ranked.length);
  });
  it("puts below target first, largest gap first, with live specials in the same tier", () => {
    expect(titles.slice(0, 3)).toEqual(["worst", "combo-low", "mild"]);
  });
  it("then missing sell price, then a happy hour loss, then rises that push dishes under", () => {
    expect(titles.slice(3, 6)).toEqual(["noprice", "hh-loss", "pushes-under"]);
  });
  it("orders the other price rises by biggest percent first", () => {
    expect(titles.indexOf("big-rise")).toBeLessThan(titles.indexOf("small-rise"));
    expect(titles.indexOf("pushes-under")).toBeLessThan(titles.indexOf("big-rise"));
  });
  it("then check cost, price not checked oldest first, catalogue, happy hour, deals expired before ending, offers to check last", () => {
    expect(titles.slice(6)).toEqual(["big-rise", "small-rise", "odd-cost", "oil", "beef", "fish", "hh-low", "d-exp", "d-end", "combo-check"]);
  });
  it("tiers never go backwards", () => {
    const tiers = ranked.map((r) => r.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });
  it("opens the right place and carries an ignore entry for every row", () => {
    const worst = ranked[0];
    expect(worst.href).toBe("/items/worst");
    expect(worst.entry.kind).toBe("below_target");
    expect(worst.entry.key).toBe(belowTargetKey({ item: item("worst"), sellInc: 14 }));
    expect(ranked.find((r) => r.title === "combo-low")?.href).toBe("/specials/combo-low");
    expect(ranked.find((r) => r.title === "d-exp")?.entry.kind).toBe("deal_expired");
    expect(ranked.find((r) => r.title === "noprice")?.trailing?.text).toBe("Add Price");
  });
  it("says how far under target a row is, in points", () => {
    expect(ranked[0].trailing?.text).toBe("-22 pts");
    expect(ranked[0].sub).toContain("vs 72% target");
  });
  it("names the venue only when All is chosen", () => {
    expect(rankAttention({ ...empty, under: [under("a", 0.6)] }, ctx)[0].sub.startsWith("Drift")).toBe(false);
    expect(rankAttention({ ...empty, under: [under("a", 0.6)] }, { ...ctx, showVenue: true })[0].sub.startsWith("Drift · ")).toBe(true);
  });
  it("keeps the feed's own order for ties", () => {
    const r = rankAttention({ ...empty, missing: [missing("z"), missing("a")] }, ctx);
    expect(r.map((x) => x.title)).toEqual(["z", "a"]);
  });
  it("returns nothing for no alerts", () => expect(rankAttention(empty, ctx)).toEqual([]));
});

describe("ignored alerts never count", () => {
  it("openRows takes an ignored below-target alert out of the ranking and the totals", () => {
    const costs = costAll(
      [item("Burger", { sell_price_inc: 9 }), item("Pie", { sell_price_inc: 9 })],
      ings,
      [line("Burger", "beef", 0.3), line("Pie", "beef", 0.3)],
    );
    const rows = underTargetRows(costs.values(), null);
    expect(rows).toHaveLength(2);
    const ignored = ignoredKeySet([{ alert_key: belowTargetKey(rows[0].cost) }]);
    const openUnder = openRows(rows, (r) => belowTargetKey(r.cost), ignored);
    expect(alertTotals({ ...empty, under: openUnder }).under).toBe(1);
    expect(rankAttention({ ...empty, under: openUnder }, ctx)).toHaveLength(1);
  });
});

describe("capping and View All", () => {
  it("shows 3 rows everywhere, 2 more from tablet width, none past 5", () => {
    expect([0, 1, 2].map(attentionVisibility)).toEqual(["always", "always", "always"]);
    expect([3, 4].map(attentionVisibility)).toEqual(["wide", "wide"]);
    expect([5, 6, 40].map(attentionVisibility)).toEqual(["none", "none", "none"]);
    expect([ATTENTION_CAP_PHONE, ATTENTION_CAP_WIDE]).toEqual([3, 5]);
  });
  it("View All shows past 3, and hides from tablet width while 5 or fewer all fit", () => {
    expect(viewAllState(0)).toEqual({ show: false, hideWide: true });
    expect(viewAllState(3)).toEqual({ show: false, hideWide: true });
    expect(viewAllState(4)).toEqual({ show: true, hideWide: true });
    expect(viewAllState(5)).toEqual({ show: true, hideWide: true });
    expect(viewAllState(6)).toEqual({ show: true, hideWide: false });
    expect(viewAllState(23)).toEqual({ show: true, hideWide: false });
  });
});

describe("summarySentence", () => {
  const t = (over: Partial<ReturnType<typeof alertTotals>>) => ({ ...alertTotals(empty), ...over });
  it("reads the three most important things in plain words", () => {
    const s = summarySentence(t({ under: 3, missing: 1, rises: 2, check: 4, total: 10 }), { hasData: true });
    expect(s.text).toBe("3 dishes and drinks are below target. 1 item has no sell price. 2 prices rose in the last 30 days.");
    expect(s.tone).toBe("danger");
  });
  it("uses singular wording", () => {
    expect(summarySentence(t({ under: 1, total: 1 }), { hasData: true }).text).toBe("1 dish or drink is below target.");
    expect(summarySentence(t({ rises: 1, total: 1 }), { hasData: true })).toEqual({ text: "1 price rose in the last 30 days.", tone: "warn" });
    expect(summarySentence(t({ check: 1, total: 1 }), { hasData: true }).text).toBe("1 cost needs checking.");
  });
  it("says serves for gelato", () => {
    expect(summarySentence(t({ under: 2, total: 2 }), { hasData: true, gelato: true }).text).toBe("2 serves are below target.");
  });
  it("says All Clear when nothing is open", () => {
    expect(summarySentence(t({}), { hasData: true })).toEqual({ text: "All clear. Every dish is on target and prices are up to date.", tone: "good" });
  });
  it("is calm when only smaller things are open", () => {
    expect(summarySentence(t({ stale: 4, total: 4 }), { hasData: true })).toEqual({ text: "Nothing urgent. 4 smaller things are worth a look.", tone: "neutral" });
  });
  it("asks for a recipe when there is no data", () => {
    expect(summarySentence(t({}), { hasData: false }).text).toBe("Add a recipe to start tracking GP.");
  });
  it("has no dashes in its words", () => {
    const all = summarySentence(t({ under: 3, missing: 1, rises: 2, offersBelow: 1, total: 7 }), { hasData: true }).text;
    expect(all).not.toMatch(/[—–]/);
  });
});

describe("sliderPos", () => {
  it("puts the target in the middle and runs 25 points either side", () => {
    expect(sliderPos(0.72, 0.72)).toBeCloseTo(0.5);
    expect(sliderPos(0.47, 0.72)).toBeCloseTo(0);
    expect(sliderPos(0.97, 0.72)).toBeCloseTo(1);
    expect(sliderPos(0.67, 0.72)).toBeCloseTo(0.4);
  });
  it("clamps outside the scale", () => {
    expect(sliderPos(0.1, 0.72)).toBe(0);
    expect(sliderPos(1, 0.72)).toBe(1);
  });
});

describe("gpStatus and formatPts", () => {
  it("On Target at or over, Nearly There within 3 points, Below Target beyond", () => {
    expect(gpStatus(0.74, 0.72)).toMatchObject({ level: "good", word: "On Target", gapText: "+2 pts" });
    expect(gpStatus(0.72, 0.72)).toMatchObject({ level: "good", word: "On Target", gapText: null });
    expect(gpStatus(0.69, 0.72)).toMatchObject({ level: "warn", word: "Nearly There", gapText: "-3 pts" });
    expect(gpStatus(0.68, 0.72)).toMatchObject({ level: "bad", word: "Below Target", gapText: "-4 pts" });
    expect(gpStatus(0.6, 0.72)).toMatchObject({ level: "bad", word: "Below Target", gapText: "-12 pts" });
  });
  it("has a word even with no GP", () => expect(gpStatus(null, null)).toMatchObject({ level: "none", word: "No GP Yet", gapText: null }));
  it("formats points", () => {
    expect(formatPts(-0.02)).toBe("-2 pts");
    expect(formatPts(0.031)).toBe("+3 pts");
    expect(formatPts(-0.004)).toBe("-0.4 pts");
    expect(formatPts(0)).toBe("0 pts");
  });
});

describe("average target and per-venue GP", () => {
  // Burger: $3 cost, price $22 inc (~$20 ex) -> GP 85%. Pie: price $14 -> 76.5%... use sell prices to land either side of 72%.
  const items = [item("Hi", { venue_id: 1, sell_price_inc: 22 }), item("Lo", { venue_id: 1, sell_price_inc: 9 }), item("Chi", { venue_id: 2, sell_price_inc: 22 }), item("Off", { venue_id: 2, sell_price_inc: 22, active: false })];
  const lines = items.map((i) => line(i.id, "beef", 0.3));
  const costs = costAll(items, ings, lines);

  it("targets the mean of the items in the average, the default when there are none", () => {
    expect(gpTarget(costs.values(), 1)).toBeCloseTo(0.72, 5);
    expect(gpTarget([], null)).toBeCloseTo(0.72, 5);
  });
  it("gives one row per venue with the average, count and open below-target count", () => {
    const openUnder = underTargetRows(costs.values(), null);
    const rows = venueGpRows(costs.values(), VENUES, openUnder);
    expect(rows.map((r) => r.venue.slug)).toEqual(["drift", "chiobu"]);
    expect(rows[0].count).toBe(2); // Hi + Lo
    expect(rows[0].under).toBe(1); // Lo only
    expect(rows[1].count).toBe(1); // Chi (Off is inactive)
    expect(rows[1].under).toBe(0);
    expect(rows[0].avg).toBeLessThan(rows[1].avg!);
    expect(rows[1].status.level).toBe("good");
  });
  it("a venue with no priced items has no GP and no bar value", () => {
    const rows = venueGpRows(costs.values(), [...VENUES, venue(4, "gelato", "Gelato Rumba")], []);
    expect(rows[2]).toMatchObject({ avg: null, count: 0, under: 0 });
    expect(rows[2].status.word).toBe("No GP Yet");
  });
  it("leaves out items that need their cost checked, like the headline average", () => {
    const bad = costAll([item("Zero", { venue_id: 2 })], [ing("beef", { pack_price: 0 })], [line("Zero", "beef", 0.3)]);
    expect(venueGpRows(bad.values(), VENUES, [])[1]).toMatchObject({ avg: null, count: 0 });
  });
});

describe("missing price anchors", () => {
  it("opens price rises first, then missing prices, else the top", () => {
    expect(priceAlertsAnchor({ rises: 2, missing: 1 })).toBe("#price-rises");
    expect(priceAlertsAnchor({ rises: 0, missing: 1 })).toBe("#missing-price");
    expect(priceAlertsAnchor({ rises: 0, missing: 0 })).toBe("");
  });
  it("counts a missing sell price from the same helper the feed uses", () => {
    const costs = costAll([item("NoPrice", { sell_price_inc: null })], ings, [line("NoPrice", "beef", 0.3)]);
    expect(missingPriceGroups(costs.values(), null)).toHaveLength(1);
  });
});

describe("specialsSummary", () => {
  const offers = [offer("on"), offer("low"), offer("chk"), offer("draft", { status: "draft" }), offer("other", { venue_id: 2 }), offer("quiet")];
  const costs = new Map<string, OfferCost>([
    ["on", offerCost(0.8)],
    ["low", offerCost(0.5)],
    ["chk", offerCost(null, { needsCheck: true })],
    ["draft", offerCost(0.3)],
    ["other", offerCost(0.9)],
    ["quiet", offerCost(0.6)],
  ]);

  it("counts live offers by status, worst first, ignoring drafts", () => {
    const s = specialsSummary(offers, costs, null, new Set());
    expect(s.live).toBe(5);
    expect(s).toMatchObject({ on: 2, below: 2, check: 1 });
    expect(s.rows.map((r) => r.offer.id)).toEqual(["low", "quiet", "chk", "on", "other"]);
  });
  it("follows the venue filter", () => {
    expect(specialsSummary(offers, costs, 2, new Set()).live).toBe(1);
  });
  it("treats an ignored alert as ignored, not on target and not counted", () => {
    const s = specialsSummary(offers, costs, 1, new Set([offerBelowTargetKey(offers[1]), offerCheckKey(offers[2])]));
    expect(s.below).toBe(1);
    expect(s.check).toBe(0);
    expect(s.rows.find((r) => r.offer.id === "low")?.status).toBe("ignored");
    expect(specialStatusWord("ignored")).toBe("Alert Ignored");
  });
  it("gives every status a word", () => {
    expect(["on", "below", "check", "ignored", "unpriced"].map((s) => specialStatusWord(s as never))).toEqual(["On Target", "Below Target", "Check Items", "Alert Ignored", "No Price"]);
  });
});
