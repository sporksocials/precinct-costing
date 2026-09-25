import { describe, expect, it } from "vitest";
import {
  NO_LOOKUPS,
  auditEvent,
  brisbaneDayLabel,
  brisbaneTime,
  buildChangeLog,
  changeLogReportText,
  fmtMoney,
  fmtPercent,
  groupByDay,
  ingredientPriceEvent,
  isMissingTable,
  matchesFilter,
  matchesSearch,
  sellPriceEvents,
  type Lookups,
} from "@/lib/change-log";

const lk: Lookups = {
  ...NO_LOOKUPS,
  venueName: (id) => (id === 1 ? "Drift" : id === 2 ? "Chiobu" : undefined),
  itemName: (id) => (id === "i1" ? { name: "Fish Tacos", venueId: 2 } : undefined),
  beerName: (id) => (id === "b1" ? { name: "XXXX Gold", venueId: 1 } : undefined),
  beerServeName: (id) => (id === "s1" ? "Pint" : undefined),
  gelatoServeName: (id) => (id === "g1" ? { name: "Double Scoop", venueId: 4 } : undefined),
  ingredientName: (id) => (id === "ing1" ? "Bacon" : undefined),
};

describe("formatting", () => {
  it("formats percents and dollars", () => {
    expect(fmtPercent("0.72")).toBe("72%");
    expect(fmtPercent(0.725)).toBe("72.5%");
    expect(fmtMoney("4.5")).toBe("$4.50");
    expect(fmtMoney(null)).toBe("None");
  });
});

describe("audit events", () => {
  it("maps a venue target change with the venue name", () => {
    const e = auditEvent({ id: 1, table_name: "cost_targets", row_key: "1/Wine", op: "update", column_name: "target_gp", old_value: "0.72", new_value: "0.78", changed_by: "demo@example.com", changed_at: "2026-09-25T04:14:00Z" }, lk);
    expect(e.kind).toBe("target");
    expect(e.title).toBe("Drift Wine target");
    expect(e.oldValue).toBe("72%");
    expect(e.newValue).toBe("78%");
    expect(e.detail).toBe("Up 6 points");
    expect(e.direction).toBe("up");
    expect(e.tone).toBe("good");
    expect(e.venueId).toBe(1);
    expect(e.who).toBe("demo@example.com");
  });
  it("labels settings", () => {
    const g = auditEvent({ id: 2, table_name: "cost_settings", row_key: "gst_rate", op: "update", column_name: "value", old_value: "0.1", new_value: "0.15" }, lk);
    expect([g.title, g.oldValue, g.newValue]).toEqual(["GST rate", "10%", "15%"]);
    const r = auditEvent({ id: 3, table_name: "cost_settings", row_key: "round_to", op: "update", column_name: "value", old_value: "0.2", new_value: "0.5" }, lk);
    expect([r.title, r.oldValue, r.newValue]).toEqual(["Round prices up to", "$0.20", "$0.50"]);
    expect(auditEvent({ id: 4, table_name: "cost_settings", row_key: "alert_pct", op: "update", column_name: "value", old_value: "0.05", new_value: "0.1" }, lk).title).toBe("Price alert level");
    expect(auditEvent({ id: 5, table_name: "cost_settings", row_key: "some_new_key", op: "update", column_name: "value", old_value: "1", new_value: "2" }, lk).title).toBe("Some new key");
  });
  it("maps access added and removed", () => {
    const a = auditEvent({ id: 6, table_name: "cost_allowed_users", row_key: "matt@example.com", op: "insert", new_value: '{"email":"matt@example.com"}' }, lk);
    expect(a.kind).toBe("access");
    expect(a.title).toBe("Access added: matt@example.com");
    const d = auditEvent({ id: 7, table_name: "cost_allowed_users", row_key: "matt@example.com", op: "delete", old_value: "{}" }, lk);
    expect(d.title).toBe("Access removed: matt@example.com");
    expect(d.who).toBeNull();
  });
  it("maps target overrides on items, beers and serves", () => {
    const i = auditEvent({ id: 8, table_name: "cost_menu_items", row_key: "i1", op: "update", column_name: "target_override", old_value: null, new_value: "0.65" }, lk);
    expect(i.kind).toBe("override");
    expect(i.title).toBe("Fish Tacos own target");
    expect(i.refHref).toBe("/items/i1");
    expect(i.venueId).toBe(2);
    expect(i.oldValue).toBe("None");
    const b = auditEvent({ id: 9, table_name: "cost_beers", row_key: "b1", op: "update", column_name: "target_gp", old_value: "0.7", new_value: "0.6" }, lk);
    expect(b.refHref).toBe("/beers/b1");
    expect(b.tone).toBe("bad");
    expect(auditEvent({ id: 10, table_name: "cost_gelato_serves", row_key: "g1", op: "update", column_name: "target_gp", old_value: "0.6", new_value: "0.7" }, lk).refHref).toBe("/gelato/serves");
  });
  it("maps ingredient attribute changes and treats a rising cost as bad", () => {
    const y = auditEvent({ id: 11, table_name: "cost_ingredients", row_key: "ing1", op: "update", column_name: "yield_pct", old_value: "1", new_value: "0.85" }, lk);
    expect(y.kind).toBe("ingredient_detail");
    expect(y.title).toBe("Bacon: Yield");
    expect([y.oldValue, y.newValue]).toEqual(["100%", "85%"]);
    expect(y.refHref).toBe("/ingredients/ing1");
    const p = auditEvent({ id: 12, table_name: "cost_ingredients", row_key: "ing1", op: "update", column_name: "pack_price", old_value: "10", new_value: "12" }, lk);
    expect(p.tone).toBe("bad");
  });
  it("never crashes on unknown tables, columns or junk", () => {
    const e = auditEvent({ id: 13, table_name: "cost_widgets", row_key: "w1", op: "update", column_name: "colour_code", old_value: "a", new_value: "b" }, lk);
    expect(e.title).toBe("Widgets: Colour code changed");
    expect(e.oldValue).toBe("a");
    const j = auditEvent({ id: 14 } as never, lk);
    expect(typeof j.title).toBe("string");
    expect(j.who).toBeNull();
    expect(auditEvent({ id: 15, table_name: "cost_targets", row_key: "zzz", op: "insert", new_value: "not json" }, lk).kind).toBe("target");
  });
  it("target inserts read the new value from the row json", () => {
    const e = auditEvent({ id: 16, table_name: "cost_targets", row_key: "2/Food", op: "insert", new_value: '{"venue_id":2,"category":"Food","target_gp":0.72}' }, lk);
    expect(e.title).toBe("Target set: Chiobu Food target");
    expect(e.newValue).toBe("72%");
  });
});

describe("sell prices and ingredient prices", () => {
  it("shows the item, old and new price and the change percent", () => {
    const [e] = sellPriceEvents({ id: 1, kind: "item", item_id: "i1", venue_id: 2, old_price: 20, new_price: 22, changed_by: "a@b.c", changed_at: "2026-09-25T01:00:00Z" }, lk);
    expect(e.title).toBe("Fish Tacos sell price");
    expect([e.oldValue, e.newValue]).toEqual(["$20.00", "$22.00"]);
    expect(e.detail).toBe("+$2.00 (+10%)");
    expect(e.tone).toBe("good");
    expect(e.refHref).toBe("/items/i1");
    expect(e.venueId).toBe(2);
  });
  it("names beer serves, gelato serves, and falls back for deleted items", () => {
    expect(sellPriceEvents({ id: 2, kind: "beer_serve", beer_id: "b1", serve_id: "s1", old_price: 10, new_price: 9 }, lk)[0].title).toBe("XXXX Gold Pint sell price");
    expect(sellPriceEvents({ id: 3, kind: "gelato_serve", serve_id: "g1", old_price: 6, new_price: 7 }, lk)[0].venueId).toBe(4);
    expect(sellPriceEvents({ id: 4, kind: "item", item_id: "gone", old_price: 1, new_price: 2 }, lk)[0].title).toBe("A menu item sell price");
  });
  it("splits a happy hour change into its own event, and marks a drop red", () => {
    const evs = sellPriceEvents({ id: 5, kind: "item", item_id: "i1", old_price: 10, new_price: 10, old_hh_price: 8, new_hh_price: 7 }, lk);
    expect(evs).toHaveLength(1);
    expect(evs[0].title).toBe("Fish Tacos happy hour price");
    expect(evs[0].tone).toBe("bad");
  });
  it("maps ingredient price changes", () => {
    const e = ingredientPriceEvent({ id: 9, ingredient_id: "ing1", old_price: 10, new_price: 12, entered_by: "x@y.z", source: "invoice", changed_at: "2026-09-25T02:00:00Z" }, lk);
    expect(e.kind).toBe("ingredient_price");
    expect(e.title).toBe("Bacon pack price");
    expect(e.tone).toBe("bad");
    expect(e.detail).toContain("Source: invoice");
  });
});

describe("combine, filter, group", () => {
  const events = buildChangeLog(
    {
      audit: [
        { id: 1, table_name: "cost_targets", row_key: "1/Wine", op: "update", column_name: "target_gp", old_value: "0.72", new_value: "0.78", changed_by: "a@b.c", changed_at: "2026-09-25T04:14:00Z" },
        { id: 2, table_name: "cost_allowed_users", row_key: "m@x.y", op: "insert", changed_at: "2026-09-24T20:00:00Z" },
      ],
      sell: [{ id: 3, kind: "item", item_id: "i1", old_price: 20, new_price: 22, changed_by: "a@b.c", changed_at: "2026-09-25T04:14:00Z" }],
      prices: [{ id: 4, ingredient_id: "ing1", old_price: 1, new_price: 2, entered_by: "a@b.c", changed_at: "2026-09-26T00:00:00Z" }],
    },
    lk,
  );
  it("sorts newest first with a stable id tie-break", () => {
    expect(events.map((e) => e.id)).toEqual(["price:4", "sell:3", "audit:1", "audit:2"]);
  });
  it("filters by kind and search", () => {
    expect(events.filter((e) => matchesFilter(e, "targets"))).toHaveLength(1);
    expect(events.filter((e) => matchesFilter(e, "prices"))).toHaveLength(2);
    expect(events.filter((e) => matchesFilter(e, "ingredients"))).toHaveLength(1);
    expect(events.filter((e) => matchesFilter(e, "access"))).toHaveLength(1);
    expect(events.filter((e) => matchesSearch(e, "wine"))).toHaveLength(1);
    expect(events.filter((e) => matchesSearch(e, "unknown"))).toHaveLength(1);
  });
  it("groups by Brisbane day (UTC 20:00 on the 24th is 6am on the 25th)", () => {
    const now = new Date("2026-09-26T03:00:00Z");
    const g = groupByDay(events, now);
    expect(g.map((x) => x.label)).toEqual(["Sat 26 Sep", "Fri 25 Sep"]);
    expect(g[1].events).toHaveLength(3);
    expect(brisbaneTime("2026-09-25T04:14:00Z")).toBe("2:14 pm");
    expect(brisbaneDayLabel("2025-01-02T00:00:00Z", now)).toBe("Thu 2 Jan 2025");
  });
  it("copes with empty sources and builds a report", () => {
    expect(buildChangeLog({}, lk)).toEqual([]);
    const text = changeLogReportText(events, "All venues", new Date("2026-09-26T03:00:00Z"));
    expect(text).toContain("Fri 25 Sep");
    expect(text).toContain("Drift Wine target, 72% to 78%");
  });
  it("recognises a missing table", () => {
    expect(isMissingTable({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingTable({ message: "Could not find the table 'public.cost_audit_log' in the schema cache" })).toBe(true);
    expect(isMissingTable({ message: "permission denied" })).toBe(false);
  });
});
