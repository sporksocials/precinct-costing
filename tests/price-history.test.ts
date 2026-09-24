import { describe, expect, it } from "vitest";
import { brisbaneDay, changePct, changePctLabel, priceChangeRows, whoLabel } from "@/lib/price-history";
import type { SellPriceLog } from "@/lib/types";

const log = (o: Partial<SellPriceLog>): SellPriceLog => ({
  id: 1, kind: "item", item_id: "i", beer_id: null, serve_id: null, venue_id: 1,
  old_price: null, new_price: null, old_hh_price: null, new_hh_price: null, cost_per_portion: null, gp_pct: null,
  changed_by: null, changed_at: "2026-09-25T02:00:00Z", ...o,
});

describe("price history", () => {
  it("computes change %", () => {
    expect(changePct(20, 21)).toBeCloseTo(0.05);
    expect(changePct(null, 21)).toBeNull();
    expect(changePct(0, 21)).toBeNull();
    expect(changePctLabel(0.05)).toBe("+5%");
    expect(changePctLabel(-0.125)).toBe("-12.5%");
  });
  it("formats Brisbane dates across the UTC day boundary", () => {
    expect(brisbaneDay("2026-09-25T02:00:00Z")).toBe("Fri 25 Sep");
    expect(brisbaneDay("2026-09-24T15:00:00Z")).toBe("Fri 25 Sep"); // 01:00 AEST
  });
  it("labels who", () => {
    expect(whoLabel("troy@x.com")).toBe("Troy");
    expect(whoLabel(null)).toBe("Unknown");
  });
  it("builds rows newest first, splitting price and happy hour", () => {
    const rows = priceChangeRows([
      log({ id: 1, old_price: 20, new_price: 22, changed_at: "2026-09-01T00:00:00Z" }),
      log({ id: 2, old_price: 22, new_price: 22, old_hh_price: null, new_hh_price: 15, changed_at: "2026-09-10T00:00:00Z", gp_pct: 0.7 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Happy Hour", "Price"]);
    expect(rows[1].changePct).toBeCloseTo(0.1);
  });
});
