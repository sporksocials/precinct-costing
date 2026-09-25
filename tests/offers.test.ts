import { describe, expect, it } from "vitest";
import type { ItemCost } from "@/lib/costing";
import { beerItemId } from "@/lib/beer";
import {
  brisbaneNow,
  costOffer,
  daysLabel,
  groupOfferLines,
  isLiveNow,
  liveOffersUnderTarget,
  offerLineCostId,
  offerWindowLabel,
  timeLabel,
  timeToMinutes,
} from "@/lib/offers";
import { DEFAULT_SETTINGS, DEFAULT_TARGET_GP, type Offer, type OfferLine } from "@/lib/types";

const settings = { ...DEFAULT_SETTINGS, gst_rate: 0.1, round_to: 0.5 };

function ic(id: string, name: string, cost: number, sell: number | null, target: number, extra: Partial<ItemCost> = {}): ItemCost {
  return { item: { id, name }, costPerPortion: cost, sellInc: sell, targetGp: target, needsCheck: false, ...extra } as unknown as ItemCost;
}

const potId = beerItemId("beer1", "pot");
const itemCosts = new Map<string, ItemCost>([
  ["burger", ic("burger", "Cheeseburger", 5, 22, 0.7)],
  [potId, ic(potId, "XXXX Gold - Pot", 1.73, 5.2, 0.72)],
  ["nopriced", ic("nopriced", "Special Fries", 2, null, 0.7)],
  ["nocost", ic("nocost", "Mystery", 0, 8, 0.7)],
]);

let n = 0;
function line(p: Partial<OfferLine>): OfferLine {
  n += 1;
  return { id: `l${n}`, offer_id: "o1", component_kind: "item", item_id: null, beer_id: null, serve_id: null, qty: 1, price_inc_override: null, sort: n, ...p };
}
const burger = () => line({ item_id: "burger" });
const pot = () => line({ component_kind: "beer_serve", beer_id: "beer1", serve_id: "pot" });

const base: Offer = {
  id: "o1",
  name: "Pot + Burger",
  venue_id: 1,
  kind: "combo",
  status: "draft",
  price_inc: 24,
  target_override: null,
  starts_on: null,
  ends_on: null,
  days_of_week: null,
  time_from: null,
  time_to: null,
  notes: null,
};

describe("offerLineCostId", () => {
  it("maps items and beer serves to itemCosts keys, null when the reference is gone", () => {
    expect(offerLineCostId(burger())).toBe("burger");
    expect(offerLineCostId(pot())).toBe(potId);
    expect(offerLineCostId(line({ item_id: null }))).toBeNull();
    expect(offerLineCostId(line({ component_kind: "beer_serve", beer_id: null, serve_id: "pot" }))).toBeNull();
  });
});

describe("costOffer", () => {
  const c = costOffer(base, [burger(), pot()], { itemCosts, settings });

  it("sums cost, regular price and works out the discount", () => {
    expect(c.cost).toBeCloseTo(6.73, 5);
    expect(c.regularPriceInc).toBeCloseTo(27.2, 5);
    expect(c.regularComplete).toBe(true);
    expect(c.offerPriceInc).toBe(24);
    expect(c.discountInc).toBeCloseTo(3.2, 5);
    expect(c.discountPct).toBeCloseTo(3.2 / 27.2, 5);
  });

  it("works GP out ex GST", () => {
    const ex = 24 / 1.1;
    expect(c.offerPriceEx).toBeCloseTo(ex, 5);
    expect(c.gpDollars).toBeCloseTo(ex - 6.73, 5);
    expect(c.gpPct).toBeCloseTo((ex - 6.73) / ex, 5);
  });

  it("targets the component with the biggest cost share (burger, 70%), and flags under target", () => {
    expect(c.targetGp).toBe(0.7);
    expect(c.targetSource).toBe("dominant");
    expect(c.targetFrom).toBe("Cheeseburger");
    expect(c.underTarget).toBe(true); // 69.1% < 70%
    expect(c.belowCost).toBe(false);
    const burgerLine = c.lines.find((l) => l.name === "Cheeseburger")!;
    expect(burgerLine.costShare).toBeCloseTo(5 / 6.73, 5);
  });

  it("suggests a price that hits the target, rounded up to round_to, and lists a ladder", () => {
    // 6.73 / 0.3 * 1.1 = 24.677 -> up to 25.00
    expect(c.suggestedPriceInc).toBe(25);
    expect(c.ladder.length).toBeGreaterThan(3);
    const s = c.ladder.find((p) => p.isSuggested)!;
    expect(s.price).toBe(25);
    expect(s.meetsTarget).toBe(true);
    expect(c.ladder.find((p) => p.price === 24)?.meetsTarget).toBe(false);
  });

  it("uses target_override when set", () => {
    const o = costOffer({ ...base, target_override: 0.6 }, [burger(), pot()], { itemCosts, settings });
    expect(o.targetGp).toBe(0.6);
    expect(o.targetSource).toBe("override");
    expect(o.underTarget).toBe(false);
  });

  it("gives ties to the lower target and follows the beer when the beer costs more", () => {
    const costs = new Map(itemCosts);
    costs.set("a", ic("a", "A", 3, 10, 0.75));
    costs.set("b", ic("b", "B", 3, 10, 0.65));
    const tie = costOffer(base, [line({ item_id: "a" }), line({ item_id: "b" })], { itemCosts: costs, settings });
    expect(tie.targetGp).toBe(0.65);
    costs.set("keg", ic("keg", "Big keg", 9, 30, 0.72));
    const beerHeavy = costOffer(base, [burger(), line({ item_id: "keg" })], { itemCosts: costs, settings });
    expect(beerHeavy.targetGp).toBe(0.72);
  });

  it("multiplies by qty", () => {
    const o = costOffer({ ...base, price_inc: 40 }, [line({ item_id: "burger", qty: 2 }), pot()], { itemCosts, settings });
    expect(o.cost).toBeCloseTo(11.73, 5);
    expect(o.regularPriceInc).toBeCloseTo(49.2, 5);
  });

  it("uses a per-line regular price override", () => {
    const o = costOffer(base, [line({ item_id: "burger", price_inc_override: 25 }), pot()], { itemCosts, settings });
    expect(o.regularPriceInc).toBeCloseTo(30.2, 5);
  });

  it("handles GST from settings", () => {
    const o = costOffer(base, [burger(), pot()], { itemCosts, settings: { ...settings, gst_rate: 0 } });
    expect(o.offerPriceEx).toBe(24);
    expect(o.gpPct).toBeCloseTo((24 - 6.73) / 24, 5);
  });

  it("flags below cost", () => {
    const o = costOffer({ ...base, price_inc: 6 }, [burger(), pot()], { itemCosts, settings });
    expect(o.belowCost).toBe(true);
    expect(o.underTarget).toBe(true);
  });

  it("has no GP without an offer price and no discount", () => {
    const o = costOffer({ ...base, price_inc: null }, [burger(), pot()], { itemCosts, settings });
    expect(o.gpPct).toBeNull();
    expect(o.discountPct).toBeNull();
    expect(o.underTarget).toBe(false);
    expect(o.suggestedPriceInc).toBe(25);
  });

  it("reports deleted, unpriced and zero-cost components as missing", () => {
    const gone = line({ item_id: null });
    const o = costOffer(base, [burger(), gone, line({ item_id: "nopriced" }), line({ item_id: "nocost" })], { itemCosts, settings });
    expect(o.missing.map((m) => m.reason).sort()).toEqual(["deleted", "no_cost", "no_price"]);
    expect(o.complete).toBe(false);
    expect(o.regularComplete).toBe(false);
    expect(o.discountPct).toBeNull();
    // cost still sums what is known
    expect(o.cost).toBeCloseTo(7, 5);
  });

  it("treats a component missing from itemCosts (deleted after the offer was saved) as deleted", () => {
    const o = costOffer(base, [line({ item_id: "burger" }), line({ item_id: "ghost" })], { itemCosts, settings });
    expect(o.missing).toEqual([{ lineId: expect.any(String), name: "Removed item", reason: "deleted" }]);
  });

  it("falls back to the app default target with no components, and never divides by zero", () => {
    const o = costOffer(base, [], { itemCosts, settings });
    expect(o.targetGp).toBe(DEFAULT_TARGET_GP);
    expect(o.targetSource).toBe("default");
    expect(o.cost).toBe(0);
    expect(o.gpPct).toBeNull();
    expect(o.suggestedPriceInc).toBeNull();
    expect(o.ladder).toEqual([]);
    expect(o.complete).toBe(false);
  });

  it("carries the needsCheck flag from a component", () => {
    const costs = new Map(itemCosts);
    costs.set("burger", ic("burger", "Cheeseburger", 5, 22, 0.7, { needsCheck: true }));
    expect(costOffer(base, [burger()], { itemCosts: costs, settings }).needsCheck).toBe(true);
  });
});

describe("liveOffersUnderTarget", () => {
  it("lists only Live offers under target, worst gap first, filterable by venue", () => {
    const mk = (id: string, price: number, status: Offer["status"], venue = 1): Offer => ({ ...base, id, price_inc: price, status, venue_id: venue });
    const offers = [mk("a", 24, "live"), mk("b", 40, "live"), mk("c", 24, "draft"), mk("d", 10, "live"), mk("e", 24, "retired"), mk("f", 24, "live", 2)];
    const costs = new Map(offers.map((o) => [o.id, costOffer(o, [burger(), pot()], { itemCosts, settings })]));
    expect(liveOffersUnderTarget(offers, costs).map((x) => x.offer.id)).toEqual(["d", "a", "f"]);
    expect(liveOffersUnderTarget(offers, costs, 2).map((x) => x.offer.id)).toEqual(["f"]);
  });
});

describe("groupOfferLines", () => {
  it("groups by offer and sorts by sort", () => {
    const g = groupOfferLines([line({ offer_id: "x", sort: 2 }), line({ offer_id: "y", sort: 1 }), line({ offer_id: "x", sort: 1 })]);
    expect(g.get("x")!.map((l) => l.sort)).toEqual([1, 2]);
    expect(g.get("y")).toHaveLength(1);
  });
});

describe("Brisbane time and isLiveNow", () => {
  // 2026-09-25 is a Friday. Brisbane is UTC+10 all year.
  const at = (iso: string) => new Date(iso); // give UTC instants
  const live = (o: Partial<Offer>): Offer => ({ ...base, status: "live", ...o });

  it("converts an instant to Brisbane wall clock, across midnight", () => {
    expect(brisbaneNow(at("2026-09-25T06:30:00Z"))).toEqual({ date: "2026-09-25", dow: 5, minutes: 16 * 60 + 30 });
    expect(brisbaneNow(at("2026-09-25T14:30:00Z"))).toEqual({ date: "2026-09-26", dow: 6, minutes: 30 });
  });

  it("only Live offers are ever live", () => {
    expect(isLiveNow({ ...base, status: "draft" }, at("2026-09-25T06:00:00Z"))).toBe(false);
    expect(isLiveNow({ ...base, status: "retired" }, at("2026-09-25T06:00:00Z"))).toBe(false);
    expect(isLiveNow(live({}), at("2026-09-25T06:00:00Z"))).toBe(true);
  });

  it("checks the time window as from-inclusive, to-exclusive", () => {
    const o = live({ time_from: "16:00", time_to: "18:00:00" });
    expect(isLiveNow(o, at("2026-09-25T05:59:00Z"))).toBe(false); // 15:59
    expect(isLiveNow(o, at("2026-09-25T06:00:00Z"))).toBe(true); // 16:00
    expect(isLiveNow(o, at("2026-09-25T07:59:00Z"))).toBe(true); // 17:59
    expect(isLiveNow(o, at("2026-09-25T08:00:00Z"))).toBe(false); // 18:00
  });

  it("checks days of the week in Brisbane, not UTC", () => {
    const fri = live({ days_of_week: [5] });
    expect(isLiveNow(fri, at("2026-09-25T06:00:00Z"))).toBe(true);
    expect(isLiveNow(fri, at("2026-09-24T20:00:00Z"))).toBe(true); // Fri 06:00 Brisbane, Thu in UTC
    expect(isLiveNow(fri, at("2026-09-25T15:00:00Z"))).toBe(false); // Sat 01:00 Brisbane
  });

  it("checks an inclusive date window", () => {
    const o = live({ starts_on: "2026-09-25", ends_on: "2026-09-26" });
    expect(isLiveNow(o, at("2026-09-24T12:00:00Z"))).toBe(false); // Thu 22:00
    expect(isLiveNow(o, at("2026-09-25T00:00:00Z"))).toBe(true);
    expect(isLiveNow(o, at("2026-09-26T13:00:00Z"))).toBe(true); // Sat 23:00
    expect(isLiveNow(o, at("2026-09-26T14:00:00Z"))).toBe(false); // Sun 00:00
  });

  it("carries an overnight window past midnight against the day it started", () => {
    const o = live({ days_of_week: [5], time_from: "22:00", time_to: "02:00" });
    expect(isLiveNow(o, at("2026-09-25T12:30:00Z"))).toBe(true); // Fri 22:30
    expect(isLiveNow(o, at("2026-09-25T15:00:00Z"))).toBe(true); // Sat 01:00, started Friday
    expect(isLiveNow(o, at("2026-09-25T16:30:00Z"))).toBe(false); // Sat 02:30
    expect(isLiveNow(o, at("2026-09-26T12:30:00Z"))).toBe(false); // Sat 22:30, Saturday not selected
  });

  it("supports open-ended times", () => {
    expect(isLiveNow(live({ time_from: "16:00" }), at("2026-09-25T13:59:00Z"))).toBe(true); // 23:59
    expect(isLiveNow(live({ time_to: "11:00" }), at("2026-09-25T00:30:00Z"))).toBe(true); // 10:30
    expect(isLiveNow(live({ time_to: "11:00" }), at("2026-09-25T01:30:00Z"))).toBe(false); // 11:30
  });
});

describe("labels", () => {
  it("parses and formats times", () => {
    expect(timeToMinutes("16:30:00")).toBe(990);
    expect(timeToMinutes("")).toBeNull();
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeLabel("16:00")).toBe("4pm");
    expect(timeLabel("16:30")).toBe("4:30pm");
    expect(timeLabel("00:00")).toBe("12am");
    expect(timeLabel("12:00")).toBe("12pm");
  });
  it("summarises days", () => {
    expect(daysLabel(null)).toBe("Every Day");
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every Day");
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("Mon to Fri");
    expect(daysLabel([5, 6])).toBe("Fri, Sat");
    expect(daysLabel([2])).toBe("Tue");
    expect(daysLabel([0, 6])).toBe("Sat, Sun");
  });
  it("summarises the whole window", () => {
    expect(offerWindowLabel({ starts_on: null, ends_on: null, days_of_week: null, time_from: null, time_to: null })).toBe("");
    expect(offerWindowLabel({ starts_on: null, ends_on: "2026-10-31", days_of_week: [5], time_from: "16:00", time_to: "18:00" })).toBe("Fri, 4pm to 6pm, until 31 Oct");
    expect(offerWindowLabel({ starts_on: "2026-10-01", ends_on: "2026-10-31", days_of_week: null, time_from: null, time_to: null })).toBe("1 Oct to 31 Oct");
  });
});
