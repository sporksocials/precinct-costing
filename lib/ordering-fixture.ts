/**
 * Ordering module: an in-memory example venue for DEMO MODE and tests (NEXT_PUBLIC_DEMO=1, see lib/supabase/demo-client.ts).
 * Everything here is invented: names are common drinks, prices and quantities are made up, and nothing is a client price.
 * Never read from, or written to, the real database.
 *
 * Each venue gets its own ids, suppliers, categories and products, so a screen can be checked for "nothing mixes venues":
 * Drift's post-mix lift is a 15 L bag, Greedy's a 5 L bag, and Greedy has no Star order form. "Coke" exists as a post-mix bag and as a carton of cans: names are unique per category, not per venue.
 *
 * TWO SHAPES (one card per product, Troy, 23 Nov 2026):
 *   orderingFixture(venue)    order items as they were BEFORE the change: no ingredient, their own short name, item code and
 *                             stored price. Tests use these as the "old item with no ingredient" fallback.
 *   orderingDemoTables()      what DEMO MODE loads: the same items given their ingredient (FIXTURE_INGREDIENTS, all invented),
 *                             so each carries the ingredient's full name and code and NO stored price, and every price on
 *                             screen is worked out by lib/ordering-facts.ts. One item (Water Bottles) is left with no
 *                             ingredient so the "Needs An Ingredient" fallback can be seen, one wine carton has no carton
 *                             size so "No price: say how many a carton holds" can be seen, and one keg has a free-unit deal.
 */
import type { Ingredient, IngredientDeal } from "./types";
import type {
  OrderingCategory,
  OrderingCountLine,
  OrderingCountSession,
  OrderingProduct,
  OrderingSupplier,
} from "./ordering-types";

export interface OrderingFixture {
  suppliers: OrderingSupplier[];
  categories: OrderingCategory[];
  products: OrderingProduct[];
  sessions: OrderingCountSession[];
  countLines: OrderingCountLine[];
}

/** A valid v4-shaped uuid that is stable per (kind, venue, n): "5a010000-0000-4000-8000-000000000003". */
export function fixtureId(kind: "sup" | "cat" | "prd" | "ses" | "cnt", venueId: number, n: number): string {
  const k = { sup: "51", cat: "52", prd: "53", ses: "54", cnt: "55" }[kind];
  return `${k}${String(venueId).padStart(2, "0")}0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * The example suppliers in the one supplier list (cost_suppliers). Their ids are high numbers so they cannot collide with a
 * real list; the demo client reuses a supplier of the same name when the demo data already has one (see demo-client.ts).
 */
export const FIXTURE_MASTER_SUPPLIERS: readonly { id: number; name: string }[] = [
  { id: 9001, name: "Star" },
  { id: 9002, name: "Lion" },
  { id: 9003, name: "Diablo" },
  { id: 9004, name: "Coke" },
];
const masterId = (n: number): number => FIXTURE_MASTER_SUPPLIERS[n - 1].id;

const FINALISED_AT = "2026-09-28T00:30:00.000Z"; // Monday 28 Sep 2026, 10:30 Brisbane

type P = [name: string, category: number, unit: string, supplier: number | null, par: number, multiple: number, price: number | null, code: string | null];

export function orderingFixture(venueId: number): OrderingFixture {
  const greedy = venueId === 3;
  const sup = (n: number, name: string, over: Partial<OrderingSupplier>): OrderingSupplier => ({
    id: fixtureId("sup", venueId, n), venue_id: venueId, name, cost_supplier_id: masterId(n), method: "email", email_to: null, login_url: null, rep_name: null, rep_phone: null, account_no: null,
    min_order_value: null, min_order_units: null, show_prices_on_order: false, notes: null, active: true, sort: n, ...over,
  });
  const suppliers: OrderingSupplier[] = [
    ...(greedy ? [] : [sup(1, "Star", { email_to: "orders@star.example.com", rep_name: "Mark Holden", rep_phone: "0400 000 001", account_no: "A1001", show_prices_on_order: true })]),
    sup(2, "Lion", { method: "website", login_url: "https://orders.lion.example.com/login", account_no: "L2002", rep_name: "Jason" }),
    sup(3, "Diablo", { email_to: "sales@diablo.example.com", rep_name: "Kevin", min_order_units: 4, notes: "Minimum 4 kegs between venues." }),
    sup(4, "Coke", { method: "website", login_url: "https://orders.coke.example.com", rep_name: "Lucy", min_order_value: 150 }),
  ];
  const cat = (n: number, name: string, unit_name: string, second: string | null): OrderingCategory => ({
    id: fixtureId("cat", venueId, n), venue_id: venueId, name, sort: n, second_location_label: second, unit_name,
  });
  const categories: OrderingCategory[] = [
    cat(1, "Kegs", "keg", "Coldroom"),
    cat(2, "Beer & RTD", "carton", "Coldroom"),
    cat(3, "Wine", "carton", "Coldroom"),
    cat(4, "Spirits", "bottle", "Bar"),
    cat(5, "Post-Mix", "bag", null),
    cat(6, "Soft Drink", "carton", null),
  ];
  // [name, category n, unit, supplier n, par, pack multiple, price inc GST, supplier item code]
  const rows: P[] = [
    ["XXXX Gold Keg", 1, "keg", 2, 6, 1, 210, null],
    ["Pale Ale Keg", 1, "keg", 2, 4, 1, 230, null],
    ["Ginger Beer Keg", 1, "keg", 3, 3, 1, 190, null],
    ["Lager Cans", 2, "carton", greedy ? 2 : 1, 8, 1, 62, "100101"],
    ["Seltzer Cans", 2, "carton", greedy ? 2 : 1, 6, 1, 58, "100102"],
    ["House Sauvignon Blanc", 3, "carton", greedy ? null : 1, 9, 1, 96, "200201"],
    ["House Prosecco", 3, "carton", greedy ? null : 1, 4, 1, 110, "200202"],
    ["Bourbon Bottle", 4, "bottle", greedy ? null : 1, 18, 6, 45, "300301"],
    ["Aperol Bottle", 4, "bottle", greedy ? null : 1, 6, 6, 31, "300302"],
    ["Vodka Bottle", 4, "bottle", greedy ? null : 1, 12, 12, 52, "300303"],
    ["Coke", 5, "bag", 4, 3, 1, greedy ? 75 : 130, null],
    ["Lift Post-Mix Bag", 5, "bag", 4, 2, 1, greedy ? 70 : 125, null],
    ["Water Bottles", 6, "carton", 4, 4, 1, 28, null],
    ["Coke", 6, "carton", 4, 5, 1, 40, null], // same name as the post-mix bag, different category (names repeat across categories)
  ];
  const products: OrderingProduct[] = rows.map(([name, c, unit_name, s, par, pack_multiple, price_inc_gst, supplier_item_code], i) => ({
    id: fixtureId("prd", venueId, i + 1), venue_id: venueId, category_id: fixtureId("cat", venueId, c), sort: i + 1,
    name: name === "Lift Post-Mix Bag" ? `Lift Post-Mix Bag (${greedy ? 5 : 15} L)` : name,
    unit_name, supplier_id: s == null ? null : fixtureId("sup", venueId, s), supplier_item_code, pack_multiple, price_inc_gst,
    ingredient_id: null, costing_packs_per_unit: null, par, notes: null, active: true,
  }));
  const session: OrderingCountSession = {
    id: fixtureId("ses", venueId, 1), venue_id: venueId, started_by: "demo@precinct.local", started_at: "2026-09-28T00:00:00.000Z", status: "finalised",
    finalised_by: "demo@precinct.local", finalised_at: FINALISED_AT, note: null, source: "sheet-import",
  };
  // store, second place for the first products; the last product is left uncounted on purpose
  const counts: [store: number | null, second: number | null][] = [[4, 1], [1, 0], [2, 2], [3, 2], [2, 0], [5, 3], [0, 0], [10, 4], [2, 1], [3, 0], [2, null], [1, null]];
  const countLines: OrderingCountLine[] = counts.map(([store_qty, second_qty], i) => ({
    id: fixtureId("cnt", venueId, i + 1), venue_id: venueId, session_id: session.id, product_id: products[i].id, store_qty, second_qty,
    counted_by: "demo@precinct.local", counted_at: "2026-09-28T00:10:00.000Z", client_uuid: null, product_name: products[i].name, par_at_count: products[i].par, unit_name: products[i].unit_name,
  }));
  return { suppliers, categories, products, sessions: [session], countLines };
}

/* ------------------------------------------------------------------ the ingredients behind the example items (demo mode) */

/** A stable invented ingredient id: "56000000-0000-4000-8000-000000000004". */
export const fixtureIngredientId = (n: number): string => `56000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface FixtureIngredient {
  n: number;
  /** the example order item's name it stands behind; `greedy` picks the venue when the two venues buy a different size */
  product: string;
  greedy?: boolean;
  /** the ingredient's full name, size in brackets */
  name: string;
  category: string;
  /** n of FIXTURE_MASTER_SUPPLIERS */
  supplier: number;
  code: string | null;
  pack_size: number;
  pack_unit: "L" | "each";
  /** the price of ONE order unit inc GST, as the old item held it: the ingredient's ex GST pack price is worked back from it */
  unitInc: number;
  /** packs in a carton: 1 = the pack is the carton, null = nobody has said */
  carton_qty: number | null;
  /** how many packs the price above is for (a wine carton is 6 bottles even when carton_qty is not recorded) */
  packsInUnit?: number;
}

const FIXTURE_ING: readonly FixtureIngredient[] = [
  { n: 1, product: "XXXX Gold Keg", name: "XXXX Gold Keg (49.5L)", category: "Beer", supplier: 2, code: null, pack_size: 49.5, pack_unit: "L", unitInc: 210, carton_qty: null },
  { n: 2, product: "Pale Ale Keg", name: "Pale Ale Keg (49.5L)", category: "Beer", supplier: 2, code: null, pack_size: 49.5, pack_unit: "L", unitInc: 230, carton_qty: null },
  { n: 3, product: "Ginger Beer Keg", name: "Ginger Beer Keg (30L)", category: "Beer", supplier: 3, code: null, pack_size: 30, pack_unit: "L", unitInc: 190, carton_qty: null },
  { n: 4, product: "Lager Cans", name: "Lager Cans (24 x 375ml)", category: "Beer", supplier: 1, code: "100101", pack_size: 24, pack_unit: "each", unitInc: 62, carton_qty: 1 },
  { n: 5, product: "Seltzer Cans", name: "Seltzer Cans (24 x 330ml)", category: "RTD", supplier: 1, code: "100102", pack_size: 24, pack_unit: "each", unitInc: 58, carton_qty: 1 },
  { n: 6, product: "House Sauvignon Blanc", name: "House Sauvignon Blanc (750ml)", category: "Wine", supplier: 1, code: "200201", pack_size: 0.75, pack_unit: "L", unitInc: 96, carton_qty: 6, packsInUnit: 6 },
  { n: 7, product: "House Prosecco", name: "House Prosecco (750ml)", category: "Wine", supplier: 1, code: "200202", pack_size: 0.75, pack_unit: "L", unitInc: 110, carton_qty: null, packsInUnit: 6 },
  { n: 8, product: "Bourbon Bottle", name: "Bourbon (700ml)", category: "Spirits", supplier: 1, code: "300301", pack_size: 0.7, pack_unit: "L", unitInc: 45, carton_qty: 6 },
  { n: 9, product: "Aperol Bottle", name: "Aperol (700ml)", category: "Spirits", supplier: 1, code: "300302", pack_size: 0.7, pack_unit: "L", unitInc: 31, carton_qty: 6 },
  { n: 10, product: "Vodka Bottle", name: "Vodka (1L)", category: "Spirits", supplier: 1, code: "300303", pack_size: 1, pack_unit: "L", unitInc: 52, carton_qty: 12 },
  { n: 11, product: "Coke:5", name: "Coke Post-Mix (15L)", category: "Soft Drinks", supplier: 4, code: null, pack_size: 15, pack_unit: "L", unitInc: 130, carton_qty: null },
  { n: 12, product: "Coke:5", greedy: true, name: "Coke Post-Mix (5L)", category: "Soft Drinks", supplier: 4, code: null, pack_size: 5, pack_unit: "L", unitInc: 75, carton_qty: null },
  { n: 13, product: "Lift Post-Mix Bag (15 L)", name: "Lift Post-Mix (15L)", category: "Soft Drinks", supplier: 4, code: null, pack_size: 15, pack_unit: "L", unitInc: 125, carton_qty: null },
  { n: 14, product: "Lift Post-Mix Bag (5 L)", greedy: true, name: "Lift Post-Mix (5L)", category: "Soft Drinks", supplier: 4, code: null, pack_size: 5, pack_unit: "L", unitInc: 70, carton_qty: null },
  { n: 15, product: "Coke:6", name: "Coke Cans (24 x 375ml)", category: "Soft Drinks", supplier: 4, code: null, pack_size: 24, pack_unit: "each", unitInc: 40, carton_qty: 1 },
];

/** The example item's key: its name, with the category number added for "Coke" (the one name used in two categories). */
const productKey = (name: string, categoryN: number): string => (name === "Coke" ? `Coke:${categoryN}` : name);

/** The invented ingredients, as cost_ingredients rows. `supplier_id` is the FIXTURE master id; the demo client maps it to the supplier of that name. */
export function fixtureIngredients(): Ingredient[] {
  return FIXTURE_ING.map((f) => ({
    id: fixtureIngredientId(f.n),
    name: f.name,
    category: f.category,
    supplier_id: masterId(f.supplier),
    supplier_code: f.code,
    pack_size: f.pack_size,
    pack_unit: f.pack_unit,
    // prices are stored ex GST, to 4 places like the live data
    pack_price: Math.round((f.unitInc / 1.1 / (f.packsInUnit ?? 1)) * 10000) / 10000,
    price_inc_gst: false,
    gst_free: false,
    rebate: 0,
    yield_pct: 1,
    venues: "All",
    active: true,
    last_price_update: "2026-09-20",
    previous_price: null,
    source: "Demo data",
    notes: null,
    updated_at: null,
    carton_qty: f.carton_qty,
  }));
}

/** One free-unit deal, so an order line with free units can be seen: the XXXX Gold keg is buy 5, get the 6th free. */
export function fixtureDeals(): IngredientDeal[] {
  return [{ id: "57000000-0000-4000-8000-000000000001", ingredient_id: fixtureIngredientId(1), kind: "buy_x_get_y", buy_qty: 5, free_qty: 1, min_qty: null, pct_off: null, unit_price: null, special_pack_price: null, starts_on: null, ends_on: null, note: "Demo deal", active: true }];
}

/**
 * The example items as THIN order items: each given its ingredient, so it carries the ingredient's full name and code and no
 * stored price (the database does the copying live; here it is done by hand). Water Bottles is left with no ingredient.
 */
export function linkedFixtureProducts(venueId: number): OrderingProduct[] {
  const greedy = venueId === 3;
  const catN = (categoryId: string): number => Number(categoryId.slice(-2));
  return orderingFixture(venueId).products.map((p) => {
    const key = productKey(p.name, catN(p.category_id));
    const f = FIXTURE_ING.find((x) => x.product === key && !!x.greedy === greedy) ?? FIXTURE_ING.find((x) => x.product === key && !x.greedy && !FIXTURE_ING.some((y) => y.product === key && y.greedy));
    if (!f) return p;
    return { ...p, ingredient_id: fixtureIngredientId(f.n), name: f.name, supplier_item_code: f.code, price_inc_gst: null };
  });
}

/** The table-name keyed rows the demo client loads (only for venues that exist in the demo data: Drift is 1, Greedy 3). */
export function orderingDemoTables(venueIds: readonly number[] = [1, 3]): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {
    ordering_suppliers: [], ordering_categories: [], ordering_products: [], ordering_count_sessions: [], ordering_count_lines: [],
    ordering_orders: [], ordering_order_lines: [], ordering_price_uploads: [], ordering_price_log: [],
  };
  for (const v of venueIds) {
    const f = orderingFixture(v);
    const linked = linkedFixtureProducts(v);
    const nameOf = new Map(linked.map((p) => [p.id, p.name]));
    f.products = linked;
    f.countLines = f.countLines.map((l) => ({ ...l, product_name: nameOf.get(l.product_id) ?? l.product_name }));
    out.ordering_suppliers.push(...(f.suppliers as unknown as Record<string, unknown>[]));
    out.ordering_categories.push(...(f.categories as unknown as Record<string, unknown>[]));
    out.ordering_products.push(...(f.products as unknown as Record<string, unknown>[]));
    out.ordering_count_sessions.push(...(f.sessions as unknown as Record<string, unknown>[]));
    out.ordering_count_lines.push(...(f.countLines as unknown as Record<string, unknown>[]));
  }
  return out;
}
