/**
 * Ordering module: an in-memory example venue for DEMO MODE and tests (NEXT_PUBLIC_DEMO=1, see lib/supabase/demo-client.ts).
 * Everything here is invented: names are common drinks, prices and quantities are made up, and nothing is a client price.
 * Never read from, or written to, the real database.
 *
 * Each venue gets its own ids, suppliers, categories and products, so a screen can be checked for "nothing mixes venues":
 * Drift's post-mix lift is a 15 L bag, Greedy's a 5 L bag, and Greedy has no Star order form. "Coke" exists as a post-mix bag and as a carton of cans: names are unique per category, not per venue.
 */
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

const FINALISED_AT = "2026-09-28T00:30:00.000Z"; // Monday 28 Sep 2026, 10:30 Brisbane

type P = [name: string, category: number, unit: string, supplier: number | null, par: number, multiple: number, price: number | null, code: string | null];

export function orderingFixture(venueId: number): OrderingFixture {
  const greedy = venueId === 3;
  const sup = (n: number, name: string, over: Partial<OrderingSupplier>): OrderingSupplier => ({
    id: fixtureId("sup", venueId, n), venue_id: venueId, name, method: "email", email_to: null, login_url: null, rep_name: null, rep_phone: null, account_no: null,
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

/** The table-name keyed rows the demo client loads (only for venues that exist in the demo data: Drift is 1, Greedy 3). */
export function orderingDemoTables(venueIds: readonly number[] = [1, 3]): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {
    ordering_suppliers: [], ordering_categories: [], ordering_products: [], ordering_count_sessions: [], ordering_count_lines: [],
    ordering_orders: [], ordering_order_lines: [], ordering_price_uploads: [], ordering_price_log: [],
  };
  for (const v of venueIds) {
    const f = orderingFixture(v);
    out.ordering_suppliers.push(...(f.suppliers as unknown as Record<string, unknown>[]));
    out.ordering_categories.push(...(f.categories as unknown as Record<string, unknown>[]));
    out.ordering_products.push(...(f.products as unknown as Record<string, unknown>[]));
    out.ordering_count_sessions.push(...(f.sessions as unknown as Record<string, unknown>[]));
    out.ordering_count_lines.push(...(f.countLines as unknown as Record<string, unknown>[]));
  }
  return out;
}
