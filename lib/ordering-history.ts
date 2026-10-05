/**
 * Ordering module: plain-English wording for the ordering_* tables in the Change Log (cost_change_history rows). Pure.
 * lib/change-history.ts calls these for any row whose table is listed here; nothing else in the Change Log changes.
 * Which tables are tracked, and why order lines and the price log are not, is in migration 20261005300000_ordering_tables.sql.
 */
import { fmtMoney } from "./change-log";

/** The ordering tables the history trigger records. */
export const ORDERING_TABLES: ReadonlySet<string> = new Set([
  "ordering_suppliers",
  "ordering_categories",
  "ordering_products",
  "ordering_count_sessions",
  "ordering_count_lines",
  "ordering_orders",
  "ordering_price_uploads",
]);

export const isOrderingTable = (table: string): boolean => ORDERING_TABLES.has(table);

type R = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const numOf = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The word for a record of this table, as in "Added Ordering Product: ..." */
export function orderingWord(table: string): string {
  switch (table) {
    case "ordering_suppliers":
      return "Ordering Supplier";
    case "ordering_categories":
      return "Ordering Category";
    case "ordering_products":
      return "Ordering Product";
    case "ordering_count_sessions":
      return "Stock Count";
    case "ordering_count_lines":
      return "Stock Count Entry";
    case "ordering_orders":
      return "Order";
    case "ordering_price_uploads":
      return "Price Upload";
    default:
      return "Ordering Record";
  }
}

/** The record's own name: a supplier, category or product name, a count's date, an order's subject, an upload's file. */
export function orderingName(table: string, r: R, whenLabel: (iso: string) => string): string {
  switch (table) {
    case "ordering_count_sessions": {
      const at = str(r.started_at);
      return at ? `Count started ${whenLabel(at)}` : "A stock count";
    }
    case "ordering_count_lines":
      return str(r.product_name) || "A product";
    case "ordering_orders":
      return str(r.subject) || (str(r.kind) === "top_up" ? "Top-up order" : "Supplier order");
    case "ordering_price_uploads":
      return str(r.file_name) || "A price sheet";
    default:
      return str(r.name) || "A record";
  }
}

const LABELS: Record<string, string> = {
  name: "Name",
  unit_name: "Unit",
  par: "Build To",
  pack_multiple: "Order In Multiples Of",
  price_inc_gst: "Price Inc GST",
  supplier_id: "Supplier",
  category_id: "Category",
  supplier_item_code: "Supplier Item Code",
  ingredient_id: "Costing Ingredient",
  costing_packs_per_unit: "Costing Packs Per Unit",
  min_order_value: "Minimum Order Value",
  min_order_units: "Minimum Order Units",
  show_prices_on_order: "Show Prices On Order",
  email_to: "Email To",
  login_url: "Login Link",
  rep_name: "Rep",
  rep_phone: "Rep Phone",
  account_no: "Account Number",
  second_location_label: "Second Place",
  store_qty: "Store Count",
  second_qty: "Second Place Count",
  par_at_count: "Build To At Count",
  active: "Active",
  notes: "Notes",
  status: "Status",
  note: "Note",
  kind: "Kind",
  show_prices: "Prices On Order",
  body_text: "Order Text",
  warning_text: "Warning",
  subject: "Subject",
  finalised_by: "Finalised By",
  rows_matched: "Rows Matched",
  rows_changed: "Rows Changed",
  rows_unmatched: "Rows Unmatched",
  updated_costing: "Costing Updated",
  venue_id: "Venue",
};

/** The plain label for a column of an ordering table. */
export function orderingFieldLabel(table: string, field: string): string {
  if (field === "method") return table === "ordering_orders" ? "Sent Using" : "How It Is Sent";
  return LABELS[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONEY_FIELDS = new Set(["price_inc_gst", "min_order_value"]);
const WORDS: Record<string, string> = { in_progress: "In Progress", finalised: "Finalised", draft: "Draft", sent: "Sent", count: "From a count", top_up: "Top-up", email: "Email", website: "Website", app: "App", outlook: "Outlook", copy: "Copy" };

export interface OrderingLookups {
  venueName: (id: number) => string | undefined;
  ingredientName: (id: string) => string | undefined;
  /** a record that may no longer be loaded: its name from other history rows ("table|key") */
  recordName: (table: string, key: string) => string | undefined;
}

/** One value of an ordering column as a short readable string. Never throws. */
export function orderingFmt(field: string, v: unknown, lk: OrderingLookups): string {
  if (v == null || v === "") return "None";
  if (field === "venue_id") return lk.venueName(Number(v)) ?? "A venue";
  if (field === "supplier_id") return lk.recordName("ordering_suppliers", str(v)) ?? "A supplier";
  if (field === "category_id") return lk.recordName("ordering_categories", str(v)) ?? "A category";
  if (field === "ingredient_id") return lk.ingredientName(str(v)) ?? "An ingredient";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (MONEY_FIELDS.has(field) && numOf(v) != null) return fmtMoney(v);
  if (field === "body_text" || field === "warning_text") return "Text saved";
  if ((field === "status" || field === "kind" || field === "method") && typeof v === "string" && WORDS[v]) return WORDS[v];
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/** A short "what it was" for an added or deleted record. */
export function orderingSummary(table: string, r: R, lk: OrderingLookups): string {
  const bits: string[] = [];
  switch (table) {
    case "ordering_products":
      bits.push(str(r.unit_name), numOf(r.par) != null ? `Build To ${numOf(r.par)}` : "", numOf(r.price_inc_gst) != null ? fmtMoney(r.price_inc_gst) : "");
      break;
    case "ordering_suppliers":
      bits.push(orderingFmt("method", r.method, lk));
      break;
    case "ordering_categories":
      bits.push(str(r.unit_name), str(r.second_location_label) ? `second place ${str(r.second_location_label)}` : "Store only");
      break;
    case "ordering_count_sessions":
      bits.push(orderingFmt("status", r.status, lk));
      break;
    case "ordering_count_lines":
      bits.push(countText(r));
      break;
    case "ordering_orders":
      bits.push(orderingFmt("status", r.status, lk), orderingFmt("kind", r.kind, lk));
      break;
    case "ordering_price_uploads":
      bits.push(numOf(r.rows_changed) != null ? `${numOf(r.rows_changed)} changed` : "", numOf(r.rows_unmatched) ? `${numOf(r.rows_unmatched)} unmatched` : "");
      break;
    default:
      break;
  }
  return bits.filter(Boolean).join(", ") || "Added";
}

/** "Store 3, second place 1" (null means not counted there). */
export function countText(r: R): string {
  const store = numOf(r.store_qty);
  const second = numOf(r.second_qty);
  const unit = str(r.unit_name);
  const u = unit ? ` ${unit}` : "";
  const parts = [store != null ? `Store ${store}${u}` : "", second != null ? `second place ${second}${u}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "Not counted";
}
