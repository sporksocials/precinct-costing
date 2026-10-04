import { describe, expect, it } from "vitest";
import { costItem } from "@/lib/costing";
import { buildIndex } from "@/lib/costing";
import { costPerServe, MIN_MULTIPLE_SERVES, parseServeCount, portionsForMode, servesMode, switchToOneNote } from "@/lib/serves";
import type { Ingredient, MenuItem, RecipeLine } from "@/lib/types";

describe("servesMode", () => {
  it("1 (and blank or 0) is One Serve; more than 1 is Multiple Serves", () => {
    expect(servesMode(1)).toBe("one");
    expect(servesMode("1")).toBe("one");
    expect(servesMode(null)).toBe("one");
    expect(servesMode(undefined)).toBe("one");
    expect(servesMode(0)).toBe("one");
    expect(servesMode(14)).toBe("multiple");
    expect(servesMode("14")).toBe("multiple");
    expect(servesMode(2.5)).toBe("multiple");
  });

  it("a stored fraction is not hidden as One Serve", () => {
    expect(servesMode(0.5)).toBe("multiple");
  });
});

describe("portionsForMode", () => {
  it("One Serve always stores 1", () => {
    expect(portionsForMode("one", 14)).toBe(1);
    expect(portionsForMode("one", 1)).toBe(1);
    expect(portionsForMode("one", null)).toBe(1);
  });

  it("Multiple Serves keeps a valid number, else starts at the minimum", () => {
    expect(portionsForMode("multiple", 14)).toBe(14);
    expect(portionsForMode("multiple", 12.5)).toBe(12.5);
    expect(portionsForMode("multiple", 1)).toBe(MIN_MULTIPLE_SERVES);
    expect(portionsForMode("multiple", null)).toBe(MIN_MULTIPLE_SERVES);
  });

  it("one to multiple to one lands back on 1", () => {
    const multi = portionsForMode("multiple", 1);
    expect(servesMode(multi)).toBe("multiple");
    expect(portionsForMode("one", multi)).toBe(1);
  });
});

describe("parseServeCount", () => {
  it("accepts integers and decimals", () => {
    expect(parseServeCount("14")).toBe(14);
    expect(parseServeCount(" 12.5 ")).toBe(12.5);
    expect(parseServeCount("1,000")).toBe(1000);
    expect(parseServeCount("3.")).toBe(3);
  });

  it("lifts anything below the minimum to 2", () => {
    expect(parseServeCount("1")).toBe(2);
    expect(parseServeCount("0")).toBe(2);
    expect(parseServeCount("1.5")).toBe(2);
  });

  it("rejects text, blanks and negatives", () => {
    expect(parseServeCount("")).toBeNull();
    expect(parseServeCount("abc")).toBeNull();
    expect(parseServeCount("-4")).toBeNull();
    expect(parseServeCount("2 serves")).toBeNull();
  });
});

describe("switching to One Serve", () => {
  it("costPerServe divides by portions and treats blank or 0 as 1, like the costing engine", () => {
    expect(costPerServe(28, 14)).toBe(2);
    expect(costPerServe(28, 0)).toBe(28);
    expect(costPerServe(28, null)).toBe(28);
  });

  it("the note says what cost per serve becomes", () => {
    expect(switchToOneNote(28, 14)).toBe("Cost per serve will become $28.00");
  });

  it("no note when nothing changes", () => {
    expect(switchToOneNote(28, 1)).toBeNull();
    expect(switchToOneNote(0, 14)).toBeNull();
  });

  it("matches what lib/costing.ts really does with the stored value", () => {
    const ing = { id: "i1", name: "Flour", category: "Food", pack_size: 1, pack_unit: "kg", pack_price: 28, price_inc_gst: false, gst_free: true, rebate: 0, yield_pct: 1, venues: "All", active: true } as unknown as Ingredient;
    const line = { id: "l1", parent_type: "item", parent_id: "it", component_type: "ingredient", component_id: "i1", qty: 1, unit: "kg", note: null, sort: 1 } as unknown as RecipeLine;
    const index = buildIndex([ing], [], [line], [], "2026-10-04");
    const settings = { gst_rate: 0.1, round_to: 0.2, alert_pct: 0.05, gelato_wastage: 0 };
    const item = { id: "it", name: "Slice", venue_id: 1, category: "Food", section: null, portions: 14, sell_price_inc: 6, target_override: null, hh_price_inc: null, active: true, source: null, notes: null } as MenuItem;
    const many = costItem(item, index, settings, []);
    expect(many.recipeCost).toBeCloseTo(28, 6);
    expect(many.costPerPortion).toBeCloseTo(2, 6);
    const note = switchToOneNote(many.recipeCost, item.portions);
    const one = costItem({ ...item, portions: portionsForMode("one", item.portions) }, index, settings, []);
    expect(one.costPerPortion).toBeCloseTo(28, 6);
    expect(note).toBe(`Cost per serve will become $${one.costPerPortion.toFixed(2)}`);
  });
});
