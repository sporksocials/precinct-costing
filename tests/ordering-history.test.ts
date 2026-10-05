import { describe, expect, it } from "vitest";
import { NO_HISTORY_LOOKUPS, buildFullChangeLog, describeHistoryRow, type HistoryLookups, type HistoryRow } from "@/lib/change-history";
import { ORDERING_TABLES, countText, isOrderingTable, orderingFieldLabel, orderingFmt, orderingWord } from "@/lib/ordering-history";

const lk: HistoryLookups = {
  ...NO_HISTORY_LOOKUPS,
  venueName: (id) => (id === 1 ? "Drift" : id === 3 ? "Greedy" : undefined),
  ingredientName: (id) => (id === "ing1" ? "Jim Beam 700ml" : undefined),
  recordName: (t, k) => (t === "ordering_suppliers" && k === "sup1" ? "Star" : t === "ordering_categories" && k === "cat1" ? "Spirits" : undefined),
};

let nextId = 1;
const row = (p: Partial<HistoryRow> & Pick<HistoryRow, "table_name" | "op">): HistoryRow => ({
  id: nextId++, row_key: "k", old_row: null, new_row: null, changed_fields: [], parent_table: null, parent_id: null, changed_by: "troy@x.com", changed_at: "2026-10-05T01:00:00Z", ...p,
});
const product = { id: "p1", venue_id: 1, name: "Jim Beam", unit_name: "bottle", par: 18, price_inc_gst: 45, supplier_id: "sup1", category_id: "cat1", pack_multiple: 6, ingredient_id: "ing1", active: true };

describe("ordering wording in the Change Log", () => {
  it("every ordering table has a word", () => {
    for (const t of ORDERING_TABLES) expect(orderingWord(t)).not.toBe("Ordering Record");
    expect(isOrderingTable("ordering_products")).toBe(true);
    expect(isOrderingTable("ordering_order_lines")).toBe(false);
    expect(isOrderingTable("cost_menu_items")).toBe(false);
  });
  it("a Build To change reads in plain words with who, the venue and both values", () => {
    const [e] = describeHistoryRow(row({ table_name: "ordering_products", op: "update", old_row: product, new_row: { ...product, par: 24 }, changed_fields: ["par"] }), lk);
    expect(e.title).toBe("Jim Beam (Drift): Build To");
    expect(e.oldValue).toBe("18");
    expect(e.newValue).toBe("24");
    expect(e.direction).toBe("up");
    expect(e.who).toBe("troy@x.com");
    expect(e.venueId).toBe(1);
  });
  it("price, supplier and costing link are formatted by their meaning, not the cost_ingredients column of the same name", () => {
    const evs = describeHistoryRow(row({ table_name: "ordering_products", op: "update", old_row: product, new_row: { ...product, price_inc_gst: 48.5, supplier_id: null, ingredient_id: null }, changed_fields: ["ingredient_id", "price_inc_gst", "supplier_id"] }), lk);
    const by = Object.fromEntries(evs.map((e) => [e.title.split(": ")[1], [e.oldValue, e.newValue]]));
    expect(by["Price Inc GST"]).toEqual(["$45.00", "$48.50"]);
    expect(by.Supplier).toEqual(["Star", "None"]);
    expect(by["Costing Ingredient"]).toEqual(["Jim Beam 700ml", "None"]);
  });
  it("adding and deleting records", () => {
    const [added] = describeHistoryRow(row({ table_name: "ordering_products", op: "insert", new_row: product }), lk);
    expect(added.title).toBe("Added Ordering Product: Jim Beam (Drift)");
    expect(added.newValue).toBe("bottle, Build To 18, $45.00");
    const [gone] = describeHistoryRow(row({ table_name: "ordering_suppliers", op: "delete", old_row: { id: "sup1", venue_id: 3, name: "Lion", method: "website" } }), lk);
    expect(gone.title).toBe("Deleted Ordering Supplier: Lion (Greedy)");
    expect(gone.deleted).toBe(true);
  });
  it("a supplier's settings", () => {
    const [e] = describeHistoryRow(row({ table_name: "ordering_suppliers", op: "update", old_row: { id: "s", venue_id: 1, name: "Star", show_prices_on_order: false, min_order_value: null, method: "email" }, new_row: { id: "s", venue_id: 1, name: "Star", show_prices_on_order: true, min_order_value: 650, method: "email" }, changed_fields: ["min_order_value", "show_prices_on_order"] }), lk);
    expect(e.title).toContain("Star (Drift)");
    const evs = describeHistoryRow(row({ table_name: "ordering_suppliers", op: "update", old_row: { id: "s", venue_id: 1, name: "Star", show_prices_on_order: false, min_order_value: null }, new_row: { id: "s", venue_id: 1, name: "Star", show_prices_on_order: true, min_order_value: 650 }, changed_fields: ["min_order_value", "show_prices_on_order"] }), lk);
    expect(evs.map((x) => [x.title.split(": ")[1], x.oldValue, x.newValue])).toEqual([["Minimum Order Value", "None", "$650.00"], ["Show Prices On Order", "No", "Yes"]]);
  });
  it("an edit to a finalised count says the product, the place and the old value", () => {
    const base = { id: "l1", venue_id: 1, session_id: "ses", product_name: "Jim Beam", unit_name: "bottle" };
    const evs = describeHistoryRow(
      row({ table_name: "ordering_count_lines", op: "update", parent_table: "ordering_count_sessions", parent_id: "ses", old_row: { ...base, store_qty: 3, second_qty: 1, counted_at: "a", client_uuid: "u1" }, new_row: { ...base, store_qty: 5, second_qty: 1, counted_at: "b", client_uuid: "u2" }, changed_fields: ["client_uuid", "counted_at", "store_qty"] }),
      lk,
    );
    expect(evs).toHaveLength(1);
    expect(evs[0].title).toBe("Count edited: Jim Beam (Drift), Store Count");
    expect([evs[0].oldValue, evs[0].newValue]).toEqual(["3", "5"]);
    const [added] = describeHistoryRow(row({ table_name: "ordering_count_lines", op: "insert", new_row: { ...base, store_qty: 2, second_qty: null } }), lk);
    expect(added.title).toBe("Count added after finalising: Jim Beam (Drift)");
    expect(added.newValue).toBe("Store 2 bottle");
    const [removed] = describeHistoryRow(row({ table_name: "ordering_count_lines", op: "delete", old_row: { ...base, store_qty: 2, second_qty: 0 } }), lk);
    expect(removed.title).toBe("Count removed after finalising: Jim Beam (Drift)");
    expect(removed.oldValue).toBe("Store 2 bottle, second place 0 bottle");
    expect(removed.deleted).toBe(true);
  });
  it("counts, orders and price uploads", () => {
    const [session] = describeHistoryRow(row({ table_name: "ordering_count_sessions", op: "update", old_row: { id: "ses", venue_id: 1, started_at: "2026-09-28T00:00:00Z", status: "in_progress" }, new_row: { id: "ses", venue_id: 1, started_at: "2026-09-28T00:00:00Z", status: "finalised" }, changed_fields: ["status"] }), lk);
    expect(session.title).toBe("Count started Mon 28 Sep (Drift): Status");
    expect([session.oldValue, session.newValue]).toEqual(["In Progress", "Finalised"]);
    const [sent] = describeHistoryRow(row({ table_name: "ordering_orders", op: "update", old_row: { id: "o", venue_id: 1, subject: "Drift Order", status: "draft", body_text: null, method: null }, new_row: { id: "o", venue_id: 1, subject: "Drift Order", status: "sent", body_text: "x", method: "outlook" }, changed_fields: ["body_text", "method", "status"] }), lk);
    expect(sent.title).toMatch(/^Drift Order \(Drift\): /);
    const [up] = describeHistoryRow(row({ table_name: "ordering_price_uploads", op: "insert", new_row: { id: "u", venue_id: 1, file_name: "Star Oct.xlsx", rows_changed: 12, rows_unmatched: 3 } }), lk);
    expect(up.title).toBe("Added Price Upload: Star Oct.xlsx (Drift)");
    expect(up.newValue).toBe("12 changed, 3 unmatched");
  });
  it("shows up in the merged Change Log feed", () => {
    const feed = buildFullChangeLog({ history: [row({ table_name: "ordering_products", op: "update", old_row: product, new_row: { ...product, par: 20 }, changed_fields: ["par"] })] }, lk);
    expect(feed.map((e) => e.title)).toEqual(["Jim Beam (Drift): Build To"]);
  });
  it("small helpers", () => {
    expect(orderingFieldLabel("ordering_orders", "method")).toBe("Sent Using");
    expect(orderingFieldLabel("ordering_suppliers", "method")).toBe("How It Is Sent");
    expect(orderingFieldLabel("ordering_products", "pack_multiple")).toBe("Order In Multiples Of");
    expect(orderingFieldLabel("ordering_products", "something_new")).toBe("Something New");
    expect(orderingFmt("body_text", "long text", { venueName: () => undefined, ingredientName: () => undefined, recordName: () => undefined })).toBe("Text saved");
    expect(countText({ store_qty: null, second_qty: null })).toBe("Not counted");
  });
});
