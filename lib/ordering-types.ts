/**
 * Ordering module: row types for the ordering_* tables (migration 20261005300000_ordering_tables.sql) and the view-model
 * types used by lib/ordering.ts and lib/ordering-data.ts. Every table is separate per venue: every row has venue_id.
 * Types only, no runtime code.
 */

/** How an order goes out. email: a draft is opened; website: a login page and a copied list; app: e.g. Ordermentum. */
export type OrderingMethod = "email" | "website" | "app";
/** How an order was actually sent (saved on the order). */
export type OrderSendMethod = "email" | "outlook" | "copy" | "website" | "other";
export type CountStatus = "in_progress" | "finalised" | "cancelled";
export type OrderStatus = "draft" | "sent";
export type OrderKind = "count" | "top_up";

/** Edit stamps kept by the cost_stamp_edit() trigger (updated_by is the signed-in email, null for direct database work). */
interface Stamped {
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
}

/**
 * One supplier's TERMS at one venue (how the order goes out, rep, account, minimums). The supplier itself lives once in the costing
 * list (cost_suppliers, renamed on the Suppliers tab of Ingredients); `name` is a copy of that name kept by the database, so
 * editing it here does nothing. One row per (venue, supplier): `cost_supplier_id` is unique within a venue.
 */
export interface OrderingSupplier extends Stamped {
  id: string;
  venue_id: number;
  /** a copy of cost_suppliers.name, forced by the database; rename on the master list */
  name: string;
  /** the supplier in the one supplier list (cost_suppliers.id) */
  cost_supplier_id: number;
  method: OrderingMethod;
  email_to: string | null;
  login_url: string | null;
  rep_name: string | null;
  rep_phone: string | null;
  account_no: string | null;
  /** dollars; a warning only, never blocks an order */
  min_order_value: number | null;
  /** cartons, kegs or bottles; a warning only */
  min_order_units: number | null;
  /** no longer shown or written by any screen (the order screen always shows a line price when there is one); the column stays */
  show_prices_on_order: boolean;
  notes: string | null;
  active: boolean;
  sort: number;
}

export interface OrderingCategory extends Stamped {
  id: string;
  venue_id: number;
  name: string;
  /** shelf order on the count screen */
  sort: number;
  /** "Bar" or "Coldroom"; null means this category is counted in the Store only */
  second_location_label: string | null;
  /** the default unit for products in this category (carton, keg, bag, bottle) */
  unit_name: string;
}

/**
 * One venue's order item: a THIN shell over an ingredient (one card per product, Troy, 23 Nov 2026). People edit only the
 * per-venue things: the shelf group (category_id, sort), "Counted By" (unit_name), "Build To" (par), pack_multiple, notes and
 * whether it is on this venue's order list (active). The name, the supplier and the supplier item code are COPIES the database
 * keeps equal to the ingredient's (trigger ordering_products_follow_ingredient), so the count screen, its offline copy and the
 * history pages can keep reading plain product rows.
 */
export interface OrderingProduct extends Stamped {
  id: string;
  venue_id: number;
  category_id: string;
  sort: number;
  /** a copy of the ingredient's full name, kept by the database (an item with no ingredient keeps the name it had) */
  name: string;
  /** "Counted By": one counted and ordered unit (carton, keg, bag, bottle, tub, each) */
  unit_name: string;
  /** the terms row of the ingredient's supplier at this venue (ordering_suppliers.id), set by the database from the ingredient */
  supplier_id: string | null;
  /** a copy of the ingredient's Supplier Code, kept by the database */
  supplier_item_code: string | null;
  /** orders round UP to a multiple of this (Star spirits: 6 or 12); most products 1 */
  pack_multiple: number;
  /**
   * NO LONGER SHOWN OR WRITTEN BY ANY SCREEN (thin order items, 23 Nov 2026; the columns stay in the database). The price,
   * the free-unit deal and the packs in a carton are read from the ingredient by lib/ordering-facts.ts. The stored price and
   * deal are read only as the FALLBACK for an item that has no ingredient yet.
   */
  price_inc_gst: number | null;
  deal_buy_qty?: number | null;
  deal_free_qty?: number | null;
  alt_supplier_name?: string | null;
  alt_item_code?: string | null;
  alt_price_inc_gst?: number | null;
  alt_price_on?: string | null;
  costing_packs_per_unit: number | null;
  /** the ingredient this order item is (cost_ingredients.id). Null only for an old item that has not been given one yet. */
  ingredient_id: string | null;
  /** "Build To": the stock level an order brings the product back up to, in its unit */
  par: number;
  notes: string | null;
  active: boolean;
}

export interface OrderingCountSession extends Stamped {
  id: string;
  venue_id: number;
  started_by: string | null;
  started_at: string;
  status: CountStatus;
  finalised_by: string | null;
  finalised_at: string | null;
  note: string | null;
  /** null for a count taken in the app; 'sheet-import' for one brought in from the old workbook */
  source: string | null;
}

/** A null quantity means not counted in that place; 0 is a deliberate zero. No row at all means the product was not counted. */
export interface OrderingCountLine extends Stamped {
  id: string;
  venue_id: number;
  session_id: string;
  product_id: string;
  store_qty: number | null;
  second_qty: number | null;
  counted_by: string | null;
  /** the device's clock when the person tapped (last write wins on sync) */
  counted_at: string | null;
  /** set by the device so a retried offline edit never saves twice */
  client_uuid: string | null;
  /** snapshots at count time */
  product_name: string | null;
  par_at_count: number | null;
  unit_name: string | null;
}

export interface OrderingOrder extends Stamped {
  id: string;
  venue_id: number;
  supplier_id: string;
  /** null for a top-up order */
  session_id: string | null;
  status: OrderStatus;
  kind: OrderKind;
  sent_by: string | null;
  sent_at: string | null;
  method: OrderSendMethod | null;
  subject: string | null;
  /** the exact text that was sent or copied */
  body_text: string | null;
  warning_text: string | null;
  show_prices: boolean;
}

export interface OrderingOrderLine extends Stamped {
  id: string;
  venue_id: number;
  order_id: string;
  product_id: string | null;
  /** snapshots as at the order */
  product_name: string;
  supplier_item_code: string | null;
  unit_name: string | null;
  suggested_qty: number | null;
  ordered_qty: number;
  pack_multiple: number | null;
  price_inc_gst: number | null;
  /** the product's free-unit deal as at the order */
  deal_buy_qty?: number | null;
  deal_free_qty?: number | null;
  sort: number;
}

export interface OrderingPriceUpload extends Stamped {
  id: string;
  venue_id: number;
  supplier_id: string | null;
  file_name: string;
  uploaded_by: string | null;
  uploaded_at: string;
  rows_matched: number;
  rows_changed: number;
  rows_unmatched: number;
  updated_costing: boolean;
}

export interface OrderingPriceLog {
  id: string;
  venue_id: number;
  product_id: string;
  old_price: number | null;
  new_price: number | null;
  upload_id: string | null;
  changed_by: string | null;
  changed_at: string;
}

/* ------------------------------------------------------------------ view models */

/** The result of suggestOrder for one product. */
export interface Suggestion {
  /** no count line, or nothing counted in either place: no suggestion is made */
  uncounted: boolean;
  /** store + second place (a place left null counts as 0 once something was counted); null when uncounted */
  counted: number | null;
  /** par minus counted, before rounding; can be negative when overstocked. 0 when uncounted */
  need: number;
  /** what to order: need rounded UP to the pack multiple, never below 0 */
  orderQty: number;
  /** how far over par (positive), 0 when at or under par */
  over: number;
  /** counted is below par (an order is suggested) */
  belowPar: boolean;
}

/** One product with its count and the suggestion made from it. */
export interface SuggestedLine {
  product: OrderingProduct;
  storeQty: number | null;
  secondQty: number | null;
  suggestion: Suggestion;
}

/** All the lines for one supplier. `lines` is what to order (quantity above 0); the rest are exposed for review screens. */
export interface SupplierOrderGroup {
  /** null for the "Unassigned" group (products with no supplier) */
  supplierId: string | null;
  supplierName: string;
  supplier: OrderingSupplier | null;
  /** counted and below par: the lines to order, in shelf order */
  lines: SuggestedLine[];
  /** counted, nothing to order (at or over par) */
  zeroLines: SuggestedLine[];
  /** not counted, so no suggestion */
  uncountedLines: SuggestedLine[];
}

/** What the totals functions and the text builder read from a line (an order line row fits). */
export interface PricedLine {
  ordered_qty: number;
  /** one unit, inc GST */
  price_inc_gst: number | null;
  /** buy X get Y free: the free units are in ordered_qty but are not paid for */
  deal_buy_qty?: number | null;
  deal_free_qty?: number | null;
  /** the line has no GST in it, so its ex GST value is the same as its inc GST value */
  gst_free?: boolean | null;
}
export interface OrderTextLine extends PricedLine {
  product_name: string;
  unit_name: string | null;
  supplier_item_code?: string | null;
}
export interface MoneyPair {
  inc: number;
  ex: number;
}
export interface OrderTotals extends MoneyPair {
  /** lines with a quantity above 0 and a price */
  pricedLines: number;
  /** lines with a quantity above 0 and no price (their value is not in the totals) */
  unpricedLines: number;
  /** total units ordered */
  units: number;
}

/** An order line as saved (no id yet): the snapshot the data layer inserts. */
export interface OrderLineDraft {
  product_id: string | null;
  product_name: string;
  supplier_item_code: string | null;
  unit_name: string | null;
  suggested_qty: number | null;
  ordered_qty: number;
  pack_multiple: number | null;
  price_inc_gst: number | null;
  deal_buy_qty?: number | null;
  deal_free_qty?: number | null;
  sort: number;
}

export interface CountProgress {
  /** active products in the venue */
  total: number;
  /** products with a quantity in at least one place */
  counted: number;
  uncounted: OrderingProduct[];
  overPar: { product: OrderingProduct; counted: number; over: number }[];
  /** categories with a second place where only one of the two places was counted */
  partial: { product: OrderingProduct; missing: "store" | "second" }[];
}

/**
 * One tap on the count screen, queued on the device. A field left undefined was not touched by this edit; null clears it
 * (not counted); 0 is a deliberate zero.
 */
export interface CountEdit {
  client_uuid: string;
  session_id: string;
  venue_id: number;
  product_id: string;
  store_qty?: number | null;
  second_qty?: number | null;
  /** ISO time on the device */
  at: string;
  by: string | null;
  product_name?: string | null;
  par_at_count?: number | null;
  unit_name?: string | null;
}

/** A count line as written to the database (an upsert on session_id + product_id): no id, the database fills it. */
export type CountLineWrite = Omit<OrderingCountLine, "id" | "created_at" | "updated_at" | "updated_by">;

export interface CountMerge {
  /** every line after the merge (server lines plus the ones the queue changed) */
  lines: CountLineWrite[];
  /** the lines to upsert: only those the queue actually changed */
  writes: CountLineWrite[];
  /** client_uuids not applied because the server already has them or holds a newer write */
  skipped: string[];
}
