import { describe, expect, it } from "vitest";
import { NO_HISTORY_LOOKUPS, buildFullChangeLog, describeHistoryRow, describeSteps, fetchChangeHistory, isCovered, pageOf, type HistoryLookups, type HistoryRow } from "@/lib/change-history";
import { matchesFilter, FILTERS, changeLogReportText } from "@/lib/change-log";

const lk: HistoryLookups = {
  ...NO_HISTORY_LOOKUPS,
  venueName: (id) => (id === 1 ? "Drift" : id === 2 ? "Chiobu" : id === 4 ? "Gelato" : undefined),
  itemName: (id) => (id === "i1" ? { name: "Margarita", venueId: 1 } : id === "i2" ? { name: "Fish Tacos", venueId: 2 } : undefined),
  prepName: (id) => (id === "p1" ? { name: "Lime Cordial", venueId: 1 } : undefined),
  ingredientName: (id) => (id === "ing1" ? "Tequila" : id === "ing2" ? "Lime Juice" : id === "keg" ? "XXXX Keg" : undefined),
  beerName: (id) => (id === "b1" ? { name: "XXXX Gold", venueId: 1 } : undefined),
  beerServeName: (id) => (id === "s1" ? "Pint" : undefined),
  gelatoServeName: (id) => (id === "g1" ? { name: "Double Scoop", venueId: 4 } : undefined),
  offerName: (id) => (id === "o1" ? { name: "Margarita Monday", venueId: 1 } : undefined),
  supplierName: (id) => (id === 7 ? "Bidfood" : undefined),
  personName: (e) => (e === "matt@x.com" ? "Matt" : e ? e.split("@")[0] : null),
};

let nextId = 1;
const row = (p: Partial<HistoryRow> & Pick<HistoryRow, "table_name" | "op">): HistoryRow => ({
  id: nextId++,
  row_key: "k",
  old_row: null,
  new_row: null,
  changed_fields: [],
  parent_table: null,
  parent_id: null,
  changed_by: "troy@x.com",
  changed_at: "2026-10-05T01:00:00Z",
  ...p,
});
const one = (r: HistoryRow) => {
  const evs = describeHistoryRow(r, lk);
  expect(evs).toHaveLength(1);
  return evs[0];
};

describe("steps", () => {
  it("adds, removes, edits and reorders", () => {
    expect(describeSteps("Step", ["a"], ["a", "b"])).toEqual({ title: "Step added", old: "None", next: "b" });
    expect(describeSteps("Step", ["a", "b"], ["a"])).toEqual({ title: "Step removed", old: "b", next: "None" });
    expect(describeSteps("Step", ["a", "b"], ["a", "c"])).toEqual({ title: "Step 2 changed", old: "b", next: "c" });
    expect(describeSteps("Step", ["a", "b"], ["b", "a"]).title).toBe("Steps reordered");
    expect(describeSteps("Step", null, ["a", "b"]).title).toBe("2 steps added");
    expect(describeSteps("Step", ["a", "b", "c"], ["x", "y"]).title).toBe("2 steps added, 3 removed");
  });
});

describe("menu items and preps", () => {
  it("describes a method step change with the venue and who", () => {
    const e = one(row({ table_name: "cost_menu_items", row_key: "i1", op: "update", changed_fields: ["method"], old_row: { name: "Margarita", venue_id: 1, method: ["Shake"] }, new_row: { name: "Margarita", venue_id: 1, method: ["Shake", "Strain over ice"] } }));
    expect(e.kind).toBe("method");
    expect(e.title).toBe("Margarita (Drift): Method, step added");
    expect([e.oldValue, e.newValue]).toEqual(["None", "Strain over ice"]);
    expect(e.who).toBe("troy@x.com");
    expect(e.venueId).toBe(1);
    expect(e.refHref).toBe("/items/i1");
    expect(e.covered).toBe(false);
    expect(e.op).toBe("update");
  });
  it("makes one event per changed field: glass, garnish, name, category, section, portions, notes", () => {
    const evs = describeHistoryRow(
      row({
        table_name: "cost_menu_items",
        row_key: "i1",
        op: "update",
        changed_fields: ["category", "garnish", "glass", "name", "notes", "portions", "section"],
        old_row: { name: "Margarita", venue_id: 1, glass: "Coupe Glass", garnish: ["Lime wheel"], category: "Cocktail", section: "Classics", portions: 1, notes: null },
        new_row: { name: "Marg", venue_id: 1, glass: "Rocks Glass, Salt Rim", garnish: [], category: "Mocktail", section: "Sours", portions: 2, notes: "House" },
      }),
      lk,
    );
    const by = Object.fromEntries(evs.map((e) => [e.id.split(":")[2], e]));
    expect(evs).toHaveLength(7);
    expect(by.glass.title).toBe("Margarita (Drift): Glass");
    expect([by.glass.oldValue, by.glass.newValue]).toEqual(["Coupe Glass", "Rocks Glass, Salt Rim"]);
    expect(by.garnish.title).toBe("Margarita (Drift): Garnish, item removed");
    expect(by.name.title).toBe("Margarita (Drift): Name");
    expect(by.section.title).toContain("Menu Section");
    expect(by.portions.title).toContain("Serves");
    expect(by.notes.newValue).toBe("House");
    expect(by.category.kind).toBe("recipe");
    expect(by.glass.kind).toBe("method");
  });
  it("marks sell price, happy hour price, active and own target on items as covered by the older logs", () => {
    const evs = describeHistoryRow(row({ table_name: "cost_menu_items", row_key: "i1", op: "update", changed_fields: ["active", "hh_price_inc", "sell_price_inc", "target_override"], old_row: { name: "Margarita", venue_id: 1 }, new_row: { name: "Margarita", venue_id: 1 } }), lk);
    expect(evs.every((e) => e.covered)).toBe(true);
    const mixed = describeHistoryRow(row({ table_name: "cost_menu_items", row_key: "i1", op: "update", changed_fields: ["glass", "sell_price_inc"], old_row: { name: "Margarita", venue_id: 1 }, new_row: { name: "Margarita", venue_id: 1 } }), lk);
    expect(mixed.map((e) => e.covered)).toEqual([false, true]);
  });
  it("says Deleted Drink with the venue, and names a dish a Dish", () => {
    const d = one(row({ table_name: "cost_menu_items", row_key: "gone", op: "delete", old_row: { name: "Margarita", venue_id: 1, category: "Cocktail", sell_price_inc: 18 } }));
    expect(d.title).toBe("Deleted Drink: Margarita (Drift)");
    expect(d.deleted).toBe(true);
    expect([d.oldValue, d.newValue]).toEqual(["Cocktail, $18.00", "Deleted"]);
    expect(d.tone).toBe("bad");
    expect(d.refHref).toBeUndefined();
    expect(one(row({ table_name: "cost_menu_items", row_key: "x", op: "delete", old_row: { name: "Fish Tacos", venue_id: 2, category: "Food" } })).title).toBe("Deleted Dish: Fish Tacos (Chiobu)");
    expect(one(row({ table_name: "cost_menu_items", row_key: "n", op: "insert", new_row: { name: "Negroni", venue_id: 1, category: "Cocktail" } })).title).toBe("Added Drink: Negroni (Drift)");
  });
  it("preps use the prep lookup and yield", () => {
    const e = one(row({ table_name: "cost_preps", row_key: "p1", op: "update", changed_fields: ["yield_qty"], old_row: { name: "Lime Cordial", venue_id: 1, yield_qty: 2 }, new_row: { name: "Lime Cordial", venue_id: 1, yield_qty: 3 } }));
    expect(e.title).toBe("Lime Cordial (Drift): Batch Yield");
    expect(e.refHref).toBe("/preps/p1");
    const k = describeHistoryRow(row({ table_name: "cost_preps", row_key: "p1", op: "update", changed_fields: ["kitchen_method", "active"], old_row: { name: "Lime Cordial", venue_id: 1, kitchen_method: [], active: true }, new_row: { name: "Lime Cordial", venue_id: 1, kitchen_method: ["Juice limes"], active: false } }), lk);
    expect(k.map((x) => x.covered)).toEqual([false, false]); // prep active is not in the audit log
    expect(k.find((x) => x.id.endsWith("active"))?.oldValue).toBe("Yes");
    expect(k.find((x) => x.id.endsWith("kitchen_method"))?.title).toBe("Lime Cordial (Drift): Kitchen Method, step added");
  });
});

describe("recipe lines", () => {
  const parent = { parent_table: "cost_menu_items", parent_id: "i1" };
  it("added, removed and amount changed, with the ingredient name and amount", () => {
    const add = one(row({ table_name: "cost_recipe_lines", op: "insert", ...parent, new_row: { parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "ing2", qty: 30, unit: "ml" } }));
    expect(add.title).toBe("Margarita (Drift): Lime Juice added");
    expect([add.oldValue, add.newValue]).toEqual(["None", "30 ml"]);
    expect(add.kind).toBe("recipe");
    expect(add.deleted).toBeUndefined();
    const rem = one(row({ table_name: "cost_recipe_lines", op: "delete", ...parent, old_row: { parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "ing1", qty: 0.06, unit: "L" } }));
    expect(rem.title).toBe("Margarita (Drift): Tequila removed");
    expect(rem.oldValue).toBe("60 ml");
    const ch = one(row({ table_name: "cost_recipe_lines", op: "update", changed_fields: ["qty"], ...parent, old_row: { parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "ing1", qty: 30, unit: "ml" }, new_row: { parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "ing1", qty: 45, unit: "ml" } }));
    expect(ch.title).toBe("Margarita (Drift): Tequila amount");
    expect([ch.oldValue, ch.newValue]).toEqual(["30 ml", "45 ml"]);
    expect(ch.direction).toBe("up");
  });
  it("names a prep component and a prep parent, and falls back for deleted names", () => {
    const e = one(row({ table_name: "cost_recipe_lines", op: "insert", parent_table: "cost_preps", parent_id: "p1", new_row: { parent_type: "prep", parent_id: "p1", component_type: "ingredient", component_id: "ing2", qty: 1, unit: "kg" } }));
    expect(e.title).toBe("Lime Cordial (Drift): Lime Juice added");
    const p = one(row({ table_name: "cost_recipe_lines", op: "insert", ...parent, new_row: { parent_type: "item", parent_id: "i1", component_type: "prep", component_id: "p1", qty: 20, unit: "ml" } }));
    expect(p.title).toBe("Margarita (Drift): Lime Cordial added");
    const g = one(row({ table_name: "cost_recipe_lines", op: "insert", parent_table: "cost_menu_items", parent_id: "zz", new_row: { parent_type: "item", parent_id: "zz", component_type: "ingredient", component_id: "nope", qty: 1, unit: "each" } }));
    expect(g.title).toBe("A dish or drink: An ingredient added");
    expect(g.oldValue).toBe("None");
  });
  it("a swapped ingredient reads as a swap", () => {
    const e = one(row({ table_name: "cost_recipe_lines", op: "update", changed_fields: ["component_id"], ...parent, old_row: { parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "ing1", qty: 30, unit: "ml" }, new_row: { parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "ing2", qty: 30, unit: "ml" } }));
    expect(e.title).toBe("Margarita (Drift): Lime Juice swapped");
    expect([e.oldValue, e.newValue]).toEqual(["Tequila", "Lime Juice"]);
  });
});

describe("every other tracked table", () => {
  it("ingredients: details shown, priced fields covered, source covered only with a price change", () => {
    const e = one(row({ table_name: "cost_ingredients", row_key: "ing1", op: "update", changed_fields: ["notes"], old_row: { name: "Tequila", notes: null }, new_row: { name: "Tequila", notes: "Use Jose" } }));
    expect(e.title).toBe("Tequila: Notes");
    expect(e.kind).toBe("ingredient_detail");
    expect(e.covered).toBe(false);
    expect(e.refHref).toBe("/ingredients/ing1");
    const p = describeHistoryRow(row({ table_name: "cost_ingredients", row_key: "ing1", op: "update", changed_fields: ["last_price_update", "pack_price", "previous_price", "source"], old_row: { name: "Tequila" }, new_row: { name: "Tequila" } }), lk);
    expect(p.every((x) => x.covered)).toBe(true);
    expect(isCovered("cost_ingredients", "update", "source", ["source"])).toBe(false);
    expect(one(row({ table_name: "cost_ingredients", row_key: "x", op: "delete", old_row: { name: "Old Gin", category: "Spirits", pack_price: 40, pack_size: 0.7, pack_unit: "L" } })).title).toBe("Deleted Ingredient: Old Gin");
  });
  it("tap beers, beer serves and serve prices", () => {
    const b = one(row({ table_name: "cost_beers", row_key: "b1", op: "update", changed_fields: ["ingredient_id"], old_row: { name: "XXXX Gold", venue_id: 1, ingredient_id: "ing1" }, new_row: { name: "XXXX Gold", venue_id: 1, ingredient_id: "keg" } }));
    expect(b.title).toBe("XXXX Gold (Drift): Keg");
    expect([b.oldValue, b.newValue]).toEqual(["Tequila", "XXXX Keg"]);
    expect(one(row({ table_name: "cost_beers", row_key: "b1", op: "update", changed_fields: ["target_gp"], old_row: { name: "XXXX Gold", venue_id: 1 }, new_row: { name: "XXXX Gold", venue_id: 1 } })).covered).toBe(true);
    expect(one(row({ table_name: "cost_beer_serves", row_key: "s1", op: "update", changed_fields: ["ml"], old_row: { name: "Pint", ml: 570 }, new_row: { name: "Pint", ml: 568 } })).title).toBe("Pint: Size");
    const pr = one(row({ table_name: "cost_beer_prices", op: "insert", parent_table: "cost_beers", parent_id: "b1", new_row: { beer_id: "b1", serve_id: "s1", sell_price_inc: 11 } }));
    expect(pr.title).toBe("XXXX Gold (Drift): Pint added");
    expect(pr.newValue).toBe("$11.00");
    expect(one(row({ table_name: "cost_beer_prices", op: "update", changed_fields: ["sell_price_inc"], parent_table: "cost_beers", parent_id: "b1", old_row: { beer_id: "b1", serve_id: "s1", sell_price_inc: 10 }, new_row: { beer_id: "b1", serve_id: "s1", sell_price_inc: 11 } })).covered).toBe(true);
  });
  it("gelato serves and their lines", () => {
    expect(one(row({ table_name: "cost_gelato_serves", row_key: "g1", op: "update", changed_fields: ["grams"], old_row: { name: "Double Scoop", venue_id: 4, grams: 100 }, new_row: { name: "Double Scoop", venue_id: 4, grams: 110 } })).title).toBe("Double Scoop (Gelato): Size");
    const l = one(row({ table_name: "cost_gelato_serve_lines", op: "update", changed_fields: ["qty"], parent_table: "cost_gelato_serves", parent_id: "g1", old_row: { serve_id: "g1", ingredient_id: "ing2", qty: 50, unit: "g" }, new_row: { serve_id: "g1", ingredient_id: "ing2", qty: 60, unit: "g" } }));
    expect(l.title).toBe("Double Scoop (Gelato): Lime Juice amount");
    expect(l.kind).toBe("other");
  });
  it("offers and offer lines", () => {
    const o = one(row({ table_name: "cost_offers", row_key: "o1", op: "update", changed_fields: ["price_inc"], old_row: { name: "Margarita Monday", venue_id: 1, price_inc: 12 }, new_row: { name: "Margarita Monday", venue_id: 1, price_inc: 14 } }));
    expect(o.title).toBe("Margarita Monday (Drift): Price");
    expect([o.oldValue, o.newValue]).toEqual(["$12.00", "$14.00"]);
    expect(o.kind).toBe("sell_price");
    expect(one(row({ table_name: "cost_offers", row_key: "o1", op: "delete", old_row: { name: "Margarita Monday", venue_id: 1, kind: "happy_hour", status: "live", price_inc: 12 } })).title).toBe("Deleted Happy Hour: Margarita Monday (Drift)");
    const days = one(row({ table_name: "cost_offers", row_key: "o1", op: "update", changed_fields: ["days_of_week"], old_row: { name: "M", venue_id: 1, days_of_week: [1] }, new_row: { name: "M", venue_id: 1, days_of_week: [1, 2] } }));
    expect([days.oldValue, days.newValue]).toEqual(["Mon", "Mon, Tue"]);
    const ol = one(row({ table_name: "cost_offer_lines", op: "insert", parent_table: "cost_offers", parent_id: "o1", new_row: { offer_id: "o1", item_id: "i1", qty: 2 } }));
    expect(ol.title).toBe("Margarita Monday (Drift): Margarita added");
    expect(ol.newValue).toBe("2 x");
  });
  it("deals, suppliers (never the portal login) and specials", () => {
    const d = one(row({ table_name: "cost_ingredient_deals", row_key: "d1", op: "update", changed_fields: ["special_pack_price"], old_row: { ingredient_id: "ing1", special_pack_price: 40 }, new_row: { ingredient_id: "ing1", special_pack_price: 35 } }));
    expect(d.title).toBe("Tequila deal: Special Pack Price");
    expect(d.kind).toBe("ingredient_price");
    expect(d.newValue).toBe("$35.00");
    const s = one(row({ table_name: "cost_suppliers", row_key: "7", op: "update", changed_fields: ["portal_username"], old_row: { name: "Bidfood", portal_username: "secret-user" }, new_row: { name: "Bidfood", portal_username: "other-user" } }));
    expect(s.title).toBe("Bidfood: Portal Login");
    expect(JSON.stringify(s)).not.toMatch(/secret-user|other-user/);
    expect(one(row({ table_name: "cost_specials", row_key: "3", op: "update", changed_fields: ["sell_price_inc"], old_row: { name: "Pie Night", venue_id: 2, sell_price_inc: 20 }, new_row: { name: "Pie Night", venue_id: 2, sell_price_inc: 22 } })).kind).toBe("sell_price");
    expect(one(row({ table_name: "cost_suppliers", row_key: "9", op: "delete", old_row: { name: "Old Co" } })).title).toBe("Deleted Supplier: Old Co");
  });
  it("targets, settings, glass and rim lists, sign-ins (all covered or read-only, no secrets)", () => {
    const t = one(row({ table_name: "cost_targets", row_key: "1|Wine", op: "update", changed_fields: ["target_gp"], old_row: { venue_id: 1, category: "Wine", target_gp: 0.72 }, new_row: { venue_id: 1, category: "Wine", target_gp: 0.78 } }));
    expect(t.title).toBe("Drift Wine target");
    expect([t.oldValue, t.newValue]).toEqual(["72%", "78%"]);
    expect(t.covered).toBe(true);
    const st = one(row({ table_name: "cost_settings", row_key: "round_to", op: "update", changed_fields: ["value"], old_row: { key: "round_to", value: 0.2 }, new_row: { key: "round_to", value: 0.5 } }));
    expect([st.title, st.oldValue, st.newValue, st.covered]).toEqual(["Round prices up to", "$0.20", "$0.50", true]);
    const g = one(row({ table_name: "cost_bar_options", op: "insert", row_key: "x", new_row: { kind: "glass", name: "Fishbowl" } }));
    expect([g.title, g.kind, g.covered]).toEqual(["Added Glass: Fishbowl", "method", false]);
    expect(one(row({ table_name: "cost_bar_options", op: "delete", row_key: "x", old_row: { kind: "rim", name: "Salt" } })).title).toBe("Deleted Rim: Salt");
    expect(one(row({ table_name: "cost_bar_options", op: "update", row_key: "x", changed_fields: ["name"], old_row: { kind: "glass", name: "Fishbowl" }, new_row: { kind: "glass", name: "Fish Bowl" } })).title).toBe("Glass renamed");
    expect(one(row({ table_name: "cost_allowed_users", op: "insert", row_key: "matt@x.com", new_row: { email: "matt@x.com" } })).title).toBe("Added Sign-In: matt@x.com");
    expect(one(row({ table_name: "cost_allowed_users", op: "delete", row_key: "matt@x.com", old_row: { email: "matt@x.com" } })).title).toBe("Deleted Sign-In: matt@x.com");
    const nm = one(row({ table_name: "cost_allowed_users", op: "update", row_key: "matt@x.com", changed_fields: ["display_name"], old_row: { email: "matt@x.com", display_name: null }, new_row: { email: "matt@x.com", display_name: "Matt" } }));
    expect([nm.title, nm.oldValue, nm.newValue, nm.kind]).toEqual(["Name set for matt@x.com", "None", "Matt", "access"]);
  });
  it("labels a database-only change System and never throws on junk", () => {
    const e = one(row({ table_name: "cost_settings", row_key: "gst_rate", op: "update", changed_by: null, changed_fields: ["value"], old_row: { value: 0.1 }, new_row: { value: 0.15 } }));
    expect(e.system).toBe(true);
    expect(e.who).toBeNull();
    const j = describeHistoryRow({ id: 1, table_name: "cost_widgets", row_key: "w", op: "update", old_row: null, new_row: null, changed_fields: ["colour_code"], parent_table: null, parent_id: null, changed_by: null, changed_at: "nonsense" }, lk);
    expect(j.length).toBeGreaterThan(0);
    expect(typeof j[0].title).toBe("string");
    expect(describeHistoryRow({} as never, lk)[0].kind).toBe("other");
  });
});

describe("the merged feed", () => {
  const lines = (k: string, op: "insert" | "delete", at: string): HistoryRow =>
    row({ id: k as never, table_name: "cost_recipe_lines", op, parent_table: "cost_menu_items", parent_id: "gone", changed_at: at, ...(op === "insert" ? { new_row: { parent_type: "item", parent_id: "gone", component_type: "ingredient", component_id: "ing1", qty: 1, unit: "g" } } : { old_row: { parent_type: "item", parent_id: "gone", component_type: "ingredient", component_id: "ing1", qty: 1, unit: "g" } }) });
  it("hides events the older logs already report, keeps the rest, and merges newest first", () => {
    const history = [
      row({ id: 101, table_name: "cost_menu_items", row_key: "i1", op: "update", changed_fields: ["sell_price_inc"], old_row: { name: "Margarita", venue_id: 1 }, new_row: { name: "Margarita", venue_id: 1 }, changed_at: "2026-10-05T02:00:00Z" }),
      row({ id: 102, table_name: "cost_menu_items", row_key: "i1", op: "update", changed_fields: ["glass", "sell_price_inc"], old_row: { name: "Margarita", venue_id: 1, glass: "A" }, new_row: { name: "Margarita", venue_id: 1, glass: "B" }, changed_at: "2026-10-05T03:00:00Z" }),
      row({ id: 103, table_name: "cost_settings", row_key: "gst_rate", op: "update", changed_fields: ["value"], old_row: { value: 0.1 }, new_row: { value: 0.2 }, changed_at: "2026-10-05T04:00:00Z" }),
    ];
    const feed = buildFullChangeLog({ sell: [{ id: 1, kind: "item", item_id: "i1", old_price: 10, new_price: 12, changed_at: "2026-10-05T02:00:00Z" }], history }, lk);
    expect(feed.map((e) => e.id)).toEqual(["hist:102:glass", "sell:1"]);
  });
  it("hides lines of a deleted record and lines saved with a new record, but keeps lone line edits", () => {
    const history = [
      row({ id: 1, table_name: "cost_menu_items", row_key: "gone", op: "delete", old_row: { name: "Margarita", venue_id: 1, category: "Cocktail" }, changed_at: "2026-10-05T05:00:00Z" }),
      lines("2", "delete", "2026-10-05T04:59:59Z"),
      lines("3", "delete", "2026-10-05T04:59:59Z"),
      row({ id: 4, table_name: "cost_menu_items", row_key: "new1", op: "insert", new_row: { name: "Negroni", venue_id: 1, category: "Cocktail" }, changed_at: "2026-10-05T06:00:00Z" }),
      { ...lines("5", "insert", "2026-10-05T06:00:02Z"), parent_id: "new1" },
      { ...lines("6", "insert", "2026-10-06T06:00:02Z"), parent_id: "new1" },
    ];
    const feed = buildFullChangeLog({ history }, lk);
    expect(feed.map((e) => e.id).sort()).toEqual(["hist:1", "hist:4", "hist:6"].sort());
    const del = feed.find((e) => e.id === "hist:1")!;
    expect(del.title).toBe("Deleted Drink: Margarita (Drift)");
  });
  it("uses names from deleted rows when the store no longer has them", () => {
    const history = [
      row({ id: 1, table_name: "cost_menu_items", row_key: "gone", op: "delete", old_row: { name: "Old Drink", venue_id: 1, category: "Cocktail" }, changed_at: "2026-10-05T05:00:00Z" }),
      row({ id: 2, table_name: "cost_recipe_lines", op: "update", changed_fields: ["qty"], parent_table: "cost_menu_items", parent_id: "gone", old_row: { parent_type: "item", parent_id: "gone", component_type: "ingredient", component_id: "ing1", qty: 1, unit: "g" }, new_row: { parent_type: "item", parent_id: "gone", component_type: "ingredient", component_id: "ing1", qty: 2, unit: "g" }, changed_at: "2026-10-04T05:00:00Z" }),
    ];
    expect(buildFullChangeLog({ history }, lk).find((e) => e.id.startsWith("hist:2"))?.title).toBe("Old Drink: Tequila amount");
  });
  it("without history it is exactly the old feed", () => {
    expect(buildFullChangeLog({}, lk)).toEqual([]);
    expect(buildFullChangeLog({ history: [] , sell: [{ id: 1, kind: "item", item_id: "i1", old_price: 1, new_price: 2, changed_at: "2026-10-05T02:00:00Z" }] }, lk)).toHaveLength(1);
  });
  it("filters: recipes, methods, prices, deleted, other, sign-in list", () => {
    expect(FILTERS.map((f) => f.label)).toEqual(expect.arrayContaining(["Recipes", "Methods And Bar Display", "Prices", "Deleted", "Sign-In List", "Other"]));
    const history = [
      row({ id: 1, table_name: "cost_recipe_lines", op: "insert", parent_table: "cost_menu_items", parent_id: "i1", new_row: { parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "ing1", qty: 1, unit: "g" }, changed_at: "2026-10-05T01:00:00Z" }),
      row({ id: 2, table_name: "cost_menu_items", row_key: "i1", op: "update", changed_fields: ["method"], old_row: { name: "Margarita", venue_id: 1, method: [] }, new_row: { name: "Margarita", venue_id: 1, method: ["x"] }, changed_at: "2026-10-05T02:00:00Z" }),
      row({ id: 3, table_name: "cost_offers", row_key: "o1", op: "update", changed_fields: ["price_inc"], old_row: { name: "O", venue_id: 1, price_inc: 1 }, new_row: { name: "O", venue_id: 1, price_inc: 2 }, changed_at: "2026-10-05T03:00:00Z" }),
      row({ id: 4, table_name: "cost_suppliers", row_key: "9", op: "delete", old_row: { name: "Old Co" }, changed_at: "2026-10-05T04:00:00Z" }),
      row({ id: 5, table_name: "cost_beer_serves", row_key: "s1", op: "update", changed_fields: ["name"], old_row: { name: "A" }, new_row: { name: "B" }, changed_at: "2026-10-05T05:00:00Z" }),
    ];
    const feed = buildFullChangeLog({ history, audit: [{ id: 9, table_name: "cost_allowed_users", row_key: "m@x.y", op: "insert", changed_at: "2026-10-05T06:00:00Z" }, { id: 10, table_name: "cost_allowed_users", row_key: "z@x.y", op: "delete", changed_at: "2026-10-05T07:00:00Z" }] }, lk);
    const ids = (f: Parameters<typeof matchesFilter>[1]) => feed.filter((e) => matchesFilter(e, f)).map((e) => e.id).sort();
    expect(ids("recipes")).toEqual(["hist:1"]);
    expect(ids("methods")).toEqual(["hist:2"]);
    expect(ids("prices")).toEqual(["hist:3"]);
    expect(ids("deleted")).toEqual(["audit:10", "hist:4"]);
    expect(ids("other")).toEqual(["hist:4", "hist:5"]);
    expect(ids("access")).toEqual(["audit:10", "audit:9"]);
    expect(ids("all")).toHaveLength(7);
  });
  it("the Copy Report text includes the new events", () => {
    const feed = buildFullChangeLog({ history: [row({ id: 1, table_name: "cost_menu_items", row_key: "x", op: "delete", old_row: { name: "Margarita", venue_id: 1, category: "Cocktail" }, changed_at: "2026-10-05T05:00:00Z" })] }, lk);
    expect(changeLogReportText(feed, "All venues", new Date("2026-10-06T00:00:00Z"))).toContain("Deleted Drink: Margarita (Drift), Cocktail to Deleted");
  });
  it("pages a long feed", () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    expect(pageOf(items, 1)).toEqual({ shown: items.slice(0, 100), more: true });
    expect(pageOf(items, 3).more).toBe(false);
    expect(pageOf(items, 3).shown).toHaveLength(250);
  });
});

describe("fetchChangeHistory", () => {
  const fake = (result: { data?: unknown[]; error?: { code?: string; message: string } | null }) => {
    const calls: [string, ...unknown[]][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "order"]) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q);
    q.range = (...a: unknown[]) => (calls.push(["range", ...a]), Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
    return { sb: { from: (t: string) => (calls.push(["from", t]), q) } as never, calls };
  };
  it("pages newest first and reports more", async () => {
    const data = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const { sb, calls } = fake({ data });
    const page = await fetchChangeHistory(sb, { limit: 3, offset: 6, table: "cost_menu_items", rowKey: "i1", op: "delete", since: "a", until: "b", parentTable: "p", parentId: "q" });
    expect(page.rows).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    expect(calls).toContainEqual(["from", "cost_change_history"]);
    expect(calls).toContainEqual(["range", 6, 9]);
    expect(calls).toContainEqual(["order", "changed_at", { ascending: false }]);
    for (const c of [["eq", "table_name", "cost_menu_items"], ["eq", "row_key", "i1"], ["eq", "op", "delete"], ["gte", "changed_at", "a"], ["lt", "changed_at", "b"], ["eq", "parent_table", "p"], ["eq", "parent_id", "q"]]) expect(calls).toContainEqual(c);
  });
  it("a missing table is not an error, other errors are reported, a throw is caught", async () => {
    expect(await fetchChangeHistory(fake({ error: { code: "42P01", message: "relation does not exist" } }).sb)).toEqual({ rows: [], hasMore: false, missing: true, error: null });
    const bad = await fetchChangeHistory(fake({ error: { message: "permission denied" } }).sb);
    expect(bad.missing).toBe(false);
    expect(bad.error).toBe("permission denied");
    const thrown = await fetchChangeHistory({ from: () => { throw new Error("boom"); } } as never);
    expect(thrown.error).toBe("boom");
  });
});
