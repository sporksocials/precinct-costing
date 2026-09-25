import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndex, costItem } from "@/lib/costing";
import { brisbaneToday } from "@/lib/deals";
import { brisbaneDayAt, dealPriceChanges, msUntilBrisbaneMidnight, rolloverDelayMs, rolloverMessage, ROLLOVER_BUFFER_MS } from "@/lib/rollover";
import { DEFAULT_SETTINGS, type Ingredient, type IngredientDeal, type MenuItem, type RecipeLine } from "@/lib/types";

const deal = (over: Partial<IngredientDeal>): IngredientDeal => ({
  id: "d1",
  ingredient_id: "keg",
  kind: "special_price",
  buy_qty: null,
  free_qty: null,
  min_qty: null,
  pct_off: null,
  unit_price: null,
  special_pack_price: 300,
  starts_on: null,
  ends_on: null,
  note: null,
  active: true,
  ...over,
});
const ing = (): Ingredient => ({
  id: "keg", name: "Keg", category: null, supplier_id: null, supplier_code: null, pack_size: 50, pack_unit: "L", pack_price: 400,
  price_inc_gst: false, gst_free: true, rebate: 0, yield_pct: 1, venues: null, active: true, last_price_update: null, previous_price: null,
  source: null, notes: null, updated_at: null,
});
const line: RecipeLine = { id: "l1", parent_type: "item", parent_id: "it1", component_type: "ingredient", component_id: "keg", qty: 1, unit: "L", note: null, sort: 1 };
const item: MenuItem = { id: "it1", name: "Pint", venue_id: 1, category: "Tap Beer", section: null, portions: 1, sell_price_inc: 10, target_override: null, hh_price_inc: null, active: true, source: null, notes: null };

// 2026-09-25 23:59:30 Brisbane = 13:59:30 UTC
const BEFORE_MIDNIGHT = Date.parse("2026-09-25T13:59:30Z");
const cost = (deals: IngredientDeal[], today: string) => costItem(item, buildIndex([ing()], [], [line], deals, today), DEFAULT_SETTINGS, []).costPerPortion;

afterEach(() => {
  vi.useRealTimers();
});

describe("rollover timer maths", () => {
  it("counts down to the next Brisbane midnight", () => {
    expect(msUntilBrisbaneMidnight(BEFORE_MIDNIGHT)).toBe(30_000);
    expect(rolloverDelayMs(BEFORE_MIDNIGHT)).toBe(30_000 + ROLLOVER_BUFFER_MS);
    // exactly at midnight the next one is a full day away, never zero
    expect(msUntilBrisbaneMidnight(Date.parse("2026-09-25T14:00:00Z"))).toBe(86_400_000);
    expect(msUntilBrisbaneMidnight(Date.parse("2026-09-25T14:00:01Z"))).toBe(86_400_000 - 1000);
    // Brisbane noon
    expect(msUntilBrisbaneMidnight(Date.parse("2026-09-26T02:00:00Z"))).toBe(12 * 3_600_000);
  });

  it("does not depend on the device timezone (UTC, Los Angeles)", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Australia/Brisbane"]) {
        process.env.TZ = tz;
        expect(msUntilBrisbaneMidnight(BEFORE_MIDNIGHT)).toBe(30_000);
        expect(brisbaneDayAt(BEFORE_MIDNIGHT)).toBe("2026-09-25");
        expect(brisbaneDayAt(BEFORE_MIDNIGHT + 31_000)).toBe("2026-09-26");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("a timer set with the delay lands on the new Brisbane date (fake clock)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
    let seen: string | null = null;
    setTimeout(() => {
      seen = brisbaneToday();
    }, rolloverDelayMs(Date.now()));
    expect(brisbaneToday()).toBe("2026-09-25");
    vi.advanceTimersByTime(29_999);
    expect(seen).toBeNull();
    vi.advanceTimersByTime(ROLLOVER_BUFFER_MS + 1);
    expect(seen).toBe("2026-09-26");
  });

  it("the delay is always positive and at most a day, and the date flips exactly there", () => {
    for (let t = BEFORE_MIDNIGHT; t < BEFORE_MIDNIGHT + 90_000_000; t += 1_234_567) {
      const ms = msUntilBrisbaneMidnight(t);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(86_400_000);
      expect(brisbaneDayAt(t + ms)).not.toBe(brisbaneDayAt(t + ms - 1));
    }
  });
});

describe("costs across a date rollover", () => {
  it("a deal ending yesterday stops applying at rollover", () => {
    const d = [deal({ ends_on: "2026-09-25" })];
    expect(cost(d, "2026-09-25")).toBeCloseTo(6, 6); // live: $300 / 50 L
    expect(cost(d, "2026-09-26")).toBeCloseTo(8, 6); // over: base $400 / 50 L
    const changes = dealPriceChanges([ing()], d, "2026-09-25", "2026-09-26");
    expect(changes).toEqual([{ ingredientId: "keg", from: 300, to: 400 }]);
    expect(rolloverMessage(changes)).toBe("A deal ended, so costs were refreshed");
  });

  it("a deal starting tomorrow applies at rollover", () => {
    const d = [deal({ starts_on: "2026-09-26" })];
    expect(cost(d, "2026-09-25")).toBeCloseTo(8, 6);
    expect(cost(d, "2026-09-26")).toBeCloseTo(6, 6);
    const changes = dealPriceChanges([ing()], d, "2026-09-25", "2026-09-26");
    expect(changes).toEqual([{ ingredientId: "keg", from: 400, to: 300 }]);
    expect(rolloverMessage(changes)).toBe("A deal started, so costs were refreshed");
  });

  it("no change and no message when there are no deals, or nothing crosses a boundary", () => {
    expect(dealPriceChanges([ing()], [], "2026-09-25", "2026-09-26")).toEqual([]);
    expect(dealPriceChanges([ing()], undefined, "2026-09-25", "2026-09-26")).toEqual([]);
    expect(dealPriceChanges([ing()], [deal({ ends_on: "2026-12-31" })], "2026-09-25", "2026-09-26")).toEqual([]);
    expect(dealPriceChanges([ing()], [deal({ active: false })], "2026-09-25", "2026-09-26")).toEqual([]);
    expect(dealPriceChanges([ing()], [deal({ ends_on: "2026-09-25" })], "2026-09-25", "2026-09-25")).toEqual([]);
    expect(rolloverMessage([])).toBeNull();
    expect(cost([], "2026-09-25")).toBeCloseTo(cost([], "2026-09-26"), 12);
  });

  it("a deal that never changed the price (dearer than base) is silent when it expires", () => {
    const d = [deal({ special_pack_price: 500, ends_on: "2026-09-25" })];
    expect(dealPriceChanges([ing()], d, "2026-09-25", "2026-09-26")).toEqual([]);
  });

  it("costs recomputed after rollover equal a fresh index built for the new date", () => {
    const d = [deal({ ends_on: "2026-09-25" }), deal({ id: "d2", kind: "percent_off", special_pack_price: null, pct_off: 0.05, starts_on: "2026-09-26" })];
    const carried = buildIndex([ing()], [], [line], d, "2026-09-25"); // what the open app held
    const recomputed = buildIndex([ing()], [], [line], d, "2026-09-26"); // memo re-run with the new `today`
    const fresh = buildIndex([ing()], [], [line], d, brisbaneDayAt(BEFORE_MIDNIGHT + 31_000));
    expect(costItem(item, recomputed, DEFAULT_SETTINGS, [])).toEqual(costItem(item, fresh, DEFAULT_SETTINGS, []));
    expect(costItem(item, recomputed, DEFAULT_SETTINGS, []).costPerPortion).not.toBe(costItem(item, carried, DEFAULT_SETTINGS, []).costPerPortion);
    expect(costItem(item, recomputed, DEFAULT_SETTINGS, []).costPerPortion).toBeCloseTo((400 * 0.95) / 50, 6);
  });
});
