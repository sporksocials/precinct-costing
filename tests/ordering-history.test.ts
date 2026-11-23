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
  it("a terms row pointing at a different supplier reads as Supplier, with the supplier's name", () => {
    const withMasters: HistoryLookups = { ...lk, recordName: (t, k) => (t === "cost_suppliers" ? ({ "7": "Star", "9": "Lion" } as Record<string, string>)[k] : lk.recordName(t, k)) };
    const [e] = describeHistoryRow(row({ table_name: "ordering_suppliers", op: "update", old_row: { id: "s", venue_id: 1, name: "Star", cost_supplier_id: 7 }, new_row: { id: "s", venue_id: 1, name: "Lion", cost_supplier_id: 9 }, changed_fields: ["cost_supplier_id"] }), withMasters);
    expect(e.title).toContain(": Supplier");
    expect([e.oldValue, e.newValue]).toEqual(["Star", "Lion"]);
    // no name known: still a readable word, never a number or an unknown field
    expect(orderingFmt("cost_supplier_id", 7, { venueName: () => undefined, ingredientName: () => undefined, recordName: () => undefined })).toBe("A supplier");
    expect(orderingFieldLabel("ordering_suppliers", "cost_supplier_id")).toBe("Supplier");
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

/* ------------------------------------------------------------------ an ingredient rename shows once (thin order items, 23 Nov 2026) */

import { followedIngredientRowIds, orderingFieldLabel as fieldLabelOf } from "@/lib/ordering-history";
type FullRow = HistoryRow;

describe("order items that only followed their ingredient are folded into the ingredient's change", () => {
  const AT = "2026-11-23T04:00:00.000Z";
  let id = 100;
  const h = (over: Partial<FullRow>): FullRow => ({ id: id++, tx_id: 7, table_name: "ordering_products", row_key: "p", op: "update", old_row: null, new_row: null, changed_fields: [], parent_table: null, parent_id: null, changed_by: "troy@x.com", changed_at: AT, ...over });
  const ingRename = h({ table_name: "cost_ingredients", row_key: "ing1", old_row: { id: "ing1", name: "Bombay Sapphire" }, new_row: { id: "ing1", name: "Bombay Sapphire London Dry Gin (700ml)" }, changed_fields: ["name"] });
  const follow = (venue: number, over: Partial<FullRow> = {}) =>
    h({ row_key: `p${venue}`, old_row: { id: `p${venue}`, venue_id: venue, name: "Bombay Sapphire", ingredient_id: "ing1" }, new_row: { id: `p${venue}`, venue_id: venue, name: "Bombay Sapphire London Dry Gin (700ml)", ingredient_id: "ing1" }, changed_fields: ["name"], ...over });

  it("hides the per-venue rows a rename caused, in the same transaction", () => {
    const rows = [ingRename, follow(1), follow(2)];
    expect([...followedIngredientRowIds(rows)].sort()).toEqual([String(rows[1].id), String(rows[2].id)].sort());
  });
  it("a supplier code change is the same", () => {
    const code = h({ table_name: "cost_ingredients", row_key: "ing1", changed_fields: ["supplier_code"], new_row: { id: "ing1" } });
    const p = follow(1, { changed_fields: ["supplier_item_code"] });
    expect(followedIngredientRowIds([code, p]).has(String(p.id))).toBe(true);
    const both = follow(2, { changed_fields: ["name", "supplier_item_code"] });
    expect(followedIngredientRowIds([ingRename, both]).has(String(both.id))).toBe(true);
  });
  it("with no transaction id, a row stamped within a few seconds of the ingredient's change is folded, a later one is not", () => {
    const ing = { ...ingRename, tx_id: null };
    const near = follow(1, { tx_id: null, changed_at: "2026-11-23T04:00:02.000Z" });
    const far = follow(2, { tx_id: null, changed_at: "2026-11-23T04:10:00.000Z" });
    const hide = followedIngredientRowIds([ing, near, far]);
    expect(hide.has(String(near.id))).toBe(true);
    expect(hide.has(String(far.id))).toBe(false);
  });
  it("direct database work on a linked item's name (the migration that first copied the names) is folded too", () => {
    const mig = follow(1, { tx_id: 99, changed_by: null });
    expect(followedIngredientRowIds([mig]).has(String(mig.id))).toBe(true);
  });
  it("never hides what a person changed: Build To, Counted By, Active, a note, a category", () => {
    for (const fields of [["par"], ["unit_name", "par", "pack_multiple"], ["active"], ["notes"], ["category_id"], ["name", "par"]]) {
      const r = follow(1, { changed_fields: fields });
      expect(followedIngredientRowIds([ingRename, r]).has(String(r.id)), fields.join()).toBe(false);
    }
  });
  it("never hides a rename of an item with no ingredient, or one a person made in another transaction", () => {
    const unlinked = follow(1, { new_row: { id: "p1", venue_id: 1, name: "Bar Mats", ingredient_id: null } });
    const other = follow(2, { tx_id: 8 });
    const hide = followedIngredientRowIds([ingRename, unlinked, other]);
    expect(hide.has(String(unlinked.id))).toBe(false);
    expect(hide.has(String(other.id))).toBe(false);
    // and an insert or a delete is never one of these
    expect(followedIngredientRowIds([ingRename, follow(1, { op: "insert" })]).size).toBe(0);
  });
  it("the Change Log shows no Ordering Product event for the rename, and still shows a real Build To change", () => {
    const par = h({ tx_id: 12, row_key: "p1", old_row: { id: "p1", venue_id: 1, name: "X", par: 4, ingredient_id: "ing1" }, new_row: { id: "p1", venue_id: 1, name: "X", par: 6, ingredient_id: "ing1" }, changed_fields: ["par"] });
    const f1 = follow(1);
    const f2 = follow(2);
    const events = buildFullChangeLog({ history: [ingRename, f1, f2, par] });
    const ordering = events.filter((e) => e.table === "ordering_products");
    // the two per-venue name rows are gone; the Build To change a person made is still there, once
    expect(ordering.map((e) => String(e.historyId))).toEqual([String(par.id)]);
    expect(ordering[0].title).toContain("Build To");
    // without the fold both would have been events
    expect(buildFullChangeLog({ history: [f1, f2].map((r) => ({ ...r, tx_id: 500 })) }).filter((e) => e.table === "ordering_products")).toHaveLength(2);
  });
  it("an order item's unit reads Counted By; a category's default keeps Unit", () => {
    expect(fieldLabelOf("ordering_products", "unit_name")).toBe("Counted By");
    expect(fieldLabelOf("ordering_categories", "unit_name")).toBe("Unit");
  });
});
