import { describe, expect, it } from "vitest";
import { buildTimeline, fieldLabel, fieldValue, type AuditRow } from "@/lib/ingredient-history";
import { isStalePrice, priceIncreases, staleIngredients } from "@/lib/insights";
import { brisbaneToday } from "@/lib/deals";
import type { Ingredient, PriceLog } from "@/lib/types";

const ing = (id: string, last: string | null, extra: Partial<Ingredient> = {}) =>
  ({ id, name: id, active: true, last_price_update: last, pack_price: 10, ...extra }) as unknown as Ingredient;
const plog = (id: number, at: string, o: number | null, n: number | null, extra: Partial<PriceLog> = {}): PriceLog => ({ id, ingredient_id: "a", changed_at: at, old_price: o, new_price: n, source: "Invoice", entered_by: "troy@x.com", notes: null, ...extra });
const audit = (id: number, col: string, o: string | null, n: string | null, at: string): AuditRow => ({ id, column_name: col, old_value: o, new_value: n, changed_by: "abbey@x.com", changed_at: at });

describe("field labels and values", () => {
  it("maps columns to plain words", () => {
    expect(fieldLabel("pack_size")).toBe("Pack size");
    expect(fieldLabel("yield_pct")).toBe("Yield");
    expect(fieldLabel("rebate")).toBe("Rebate per pack");
    expect(fieldLabel("gst_free")).toBe("GST-free");
    expect(fieldLabel("some_new_col")).toBe("Some new col");
    expect(fieldLabel(null)).toBe("Change");
  });
  it("formats values", () => {
    expect(fieldValue("yield_pct", "0.85")).toBe("85%");
    expect(fieldValue("yield_pct", "1")).toBe("100%");
    expect(fieldValue("rebate", "1.5")).toBe("$1.50");
    expect(fieldValue("gst_free", "true")).toBe("Yes");
    expect(fieldValue("active", "false")).toBe("No");
    expect(fieldValue("supplier_id", "7", (n) => (n === 7 ? "Bidfood" : undefined))).toBe("Bidfood");
    expect(fieldValue("supplier_id", "9")).toBe("Supplier 9");
    expect(fieldValue("supplier_code", null)).toBe("None");
    expect(fieldValue("pack_size", "10.000")).toBe("10");
  });
});

describe("buildTimeline", () => {
  it("merges price and audit rows newest first", () => {
    const t = buildTimeline(
      [plog(1, "2026-09-01T00:00:00Z", 4, 5), plog(2, "2026-09-20T00:00:00Z", 5, 6)],
      [audit(9, "pack_size", "10", "12", "2026-09-10T00:00:00Z")],
    );
    expect(t.map((e) => e.key)).toEqual(["p2", "a9", "p1"]);
    expect(t[1]).toMatchObject({ kind: "field", title: "Pack size", from: "10", to: "12", by: "abbey@x.com" });
    expect(t[0]).toMatchObject({ kind: "price", from: "$5.00", to: "$6.00" });
  });
  it("treats a same-price row as a confirmation and drops skipped rows", () => {
    const t = buildTimeline([plog(1, "2026-09-01T00:00:00Z", 5, 5, { source: "Price confirmed" }), plog(2, "2026-09-02T00:00:00Z", null, 7, { entered_by: "alt" })], [], undefined, (l) => l.entered_by === "alt");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "confirmed", title: "Price confirmed", from: null, to: "$5.00" });
  });
  it("works with no audit rows", () => {
    expect(buildTimeline([], [])).toEqual([]);
  });
});

describe("confirming a price clears the stale flag", () => {
  const inUse = new Set(["old", "never", "fresh"]);
  const today = brisbaneToday();
  it("null and old dates are stale; today is not", () => {
    const list = [ing("old", "2025-01-01"), ing("never", null), ing("fresh", today)];
    expect(staleIngredients(list, inUse).map((i) => i.id)).toEqual(["old", "never"]);
    expect(isStalePrice(today)).toBe(false);
    expect(isStalePrice(null)).toBe(true);
  });
  it("leaves the stale list as soon as last_price_update is today, price untouched", () => {
    const before = [ing("old", "2025-01-01"), ing("never", null)];
    expect(staleIngredients(before, inUse)).toHaveLength(2);
    const after = before.map((i) => ({ ...i, last_price_update: today }));
    expect(staleIngredients(after, inUse)).toHaveLength(0);
    expect(after.map((i) => i.pack_price)).toEqual(before.map((i) => i.pack_price));
  });
});

describe("price increases ignore confirmations", () => {
  const ingredients = new Map([["a", ing("a", null)]]);
  it("a same-price confirmation does not hide an earlier rise", () => {
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 86_400_000).toISOString();
    const out = priceIncreases([plog(1, earlier, 10, 12), plog(2, now, 12, 12, { source: "Price confirmed" })], ingredients, [], new Map(), 0.05);
    expect(out).toHaveLength(1);
    expect(out[0].log.id).toBe(1);
  });
  it("a confirmation alone is not an increase", () => {
    expect(priceIncreases([plog(2, new Date().toISOString(), 12, 12)], ingredients, [], new Map(), 0.05)).toHaveLength(0);
  });
});
