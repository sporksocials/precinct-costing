/**
 * Full change history (cost_change_history, written by the cost_history_log() trigger, read only here).
 * Pure helpers turn a history row into plain-English events for the Change Log; fetchChangeHistory pages the table.
 * Nothing here writes. Unknown tables or columns fall back to readable text instead of throwing, and secrets
 * (supplier portal logins) are never printed.
 *
 * One history row can become several events: an update that changed three columns reads as three lines, an insert or
 * delete as exactly one. describeHistoryRow describes EVERYTHING in the row and marks events that an older log
 * (audit, sell price or ingredient price log) already reports as `covered`; buildFullChangeLog drops those from the feed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_LOOKUPS, buildChangeLog, fmtMoney, fmtPercent, humanise, isMissingTable, type AuditRow, type ChangeEvent, type ChangeKind, type Lookups, type PriceLogRow, type SellPriceRow } from "./change-log";
import { fieldLabel } from "./draft-changes";
import { describeDishAllergens } from "./dish-allergens";
import { cleanGelatoLabels, gelatoLabelText } from "./gelato-labels";
import { countText, isOrderingTable, orderingFieldLabel, orderingFmt, orderingName, orderingSummary, orderingWord, type OrderingLookups } from "./ordering-history";
import { formatQty } from "./parse-qty";
import type { LineUnit } from "./types";

export const HISTORY_TABLE = "cost_change_history";

export interface HistoryRow {
  id: number | string;
  tx_id?: number | string | null;
  table_name: string;
  row_key: string;
  op: "insert" | "update" | "delete";
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_fields: string[] | null;
  parent_table: string | null;
  parent_id: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface HistoryFilter {
  table?: string;
  rowKey?: string;
  parentTable?: string;
  parentId?: string;
  op?: "insert" | "update" | "delete";
  /** ISO timestamps: changed_at >= since, changed_at < until */
  since?: string;
  until?: string;
  /** page size (default 300) */
  limit?: number;
  /** rows to skip (paging) */
  offset?: number;
}
export interface HistoryPage {
  rows: HistoryRow[];
  hasMore: boolean;
  /** the table does not exist yet (migration not applied): not an error */
  missing: boolean;
  error: string | null;
}

export const HISTORY_PAGE = 300;

/** Newest first, paged. A missing table is reported as `missing`, never thrown. */
export async function fetchChangeHistory(sb: SupabaseClient, f: HistoryFilter = {}): Promise<HistoryPage> {
  const limit = Math.max(1, Math.min(f.limit ?? HISTORY_PAGE, 1000));
  const offset = Math.max(0, f.offset ?? 0);
  try {
    let q = sb.from(HISTORY_TABLE).select("*");
    if (f.table) q = q.eq("table_name", f.table);
    if (f.rowKey) q = q.eq("row_key", f.rowKey);
    if (f.parentTable) q = q.eq("parent_table", f.parentTable);
    if (f.parentId) q = q.eq("parent_id", f.parentId);
    if (f.op) q = q.eq("op", f.op);
    if (f.since) q = q.gte("changed_at", f.since);
    if (f.until) q = q.lt("changed_at", f.until);
    const { data, error } = await q.order("changed_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit); // one extra row tells us there is more
    if (error) return { rows: [], hasMore: false, missing: isMissingTable(error), error: isMissingTable(error) ? null : error.message };
    const all = (data ?? []) as HistoryRow[];
    return { rows: all.slice(0, limit), hasMore: all.length > limit, missing: false, error: null };
  } catch (e) {
    return { rows: [], hasMore: false, missing: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}

/* ------------------------------------------------------------------ lookups */

export interface HistoryLookups extends Lookups {
  prepName: (id: string) => { name: string; venueId?: number | null } | undefined;
  supplierName: (id: number) => string | undefined;
  offerName: (id: string) => { name: string; venueId?: number | null } | undefined;
  /** a record that is no longer in the store (deleted): its name from other history rows, "table|key" */
  recordName: (table: string, key: string) => string | undefined;
  /** first name for an email ("Matt"), from the Who Can Sign In list */
  personName: (email: string | null | undefined) => string | null;
}
export const NO_HISTORY_LOOKUPS: HistoryLookups = {
  ...NO_LOOKUPS,
  prepName: () => undefined,
  supplierName: () => undefined,
  offerName: () => undefined,
  recordName: () => undefined,
  personName: (e) => (e ? e.split("@")[0] : null),
};

/* ------------------------------------------------------------------ small helpers */

type R = Record<string, unknown>;
const clip = (s: string, n = 80): string => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const numOf = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONEY = new Set(["sell_price_inc", "hh_price_inc", "pack_price", "previous_price", "unit_price", "special_pack_price", "price_inc", "manual_cost", "price_inc_override"]);
const PERCENT = new Set(["target_override", "target_gp", "yield_pct", "rebate", "pct_off"]);
const STEP_FIELDS: Record<string, string> = { method: "step", garnish: "item", kitchen_method: "step", kitchen_plating: "point" };
const METHOD_FIELDS = new Set(["method", "glass", "garnish", "bar_photo", "kitchen_method", "kitchen_plating", "kitchen_photo", "kitchen_storage", "kitchen_ready"]);

/** Labels that differ from lib/draft-changes (it uses "Method" for both bar and kitchen steps). */
const LABELS: Record<string, string> = {
  kitchen_method: "Kitchen Method",
  kitchen_plating: "Kitchen Plating",
  kitchen_photo: "Kitchen Photo",
  kitchen_storage: "Kitchen Storage",
  bar_photo: "Bar Photo",
  yield_pct: "Yield",
  pack_size: "Pack Size",
  pack_unit: "Pack Unit",
  pack_price: "Pack Price",
  previous_price: "Previous Price",
  last_price_update: "Last Price Update",
  price_inc_gst: "Price Includes GST",
  gst_free: "GST Free",
  supplier_id: "Supplier",
  supplier_code: "Supplier Code",
  allergens_reviewed: "Allergens Reviewed",
  diet_flags: "Diet Flags",
  ingredient_id: "Keg",
  target_gp: "Target GP",
  on_menu: "On Menu",
  price_inc: "Price",
  starts_on: "Starts",
  ends_on: "Ends",
  days_of_week: "Days",
  time_from: "From",
  time_to: "To",
  ml: "Size",
  grams: "Size",
  portal_url: "Portal Link",
  portal_username: "Portal Login",
};
const label = (f: string): string => LABELS[f] ?? fieldLabel(f);
/** The plain label for a column ("Glass", "Kitchen Method"), shared with the per-record History and Undo. */
export const historyFieldLabel = label;

const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);

/** One value as a short readable string. Never throws. */
export function fmtField(field: string, v: unknown, lk: HistoryLookups = NO_HISTORY_LOOKUPS): string {
  if (v == null || v === "") return "None";
  if (field === "portal_username") return "Changed"; // a login: never printed
  if (field === "venue_id") return lk.venueName(Number(v)) ?? "A venue";
  if (field === "supplier_id") return lk.supplierName(Number(v)) ?? "A supplier";
  if (field === "ingredient_id") return lk.ingredientName(String(v)) ?? "An ingredient";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (MONEY.has(field) && numOf(v) != null) return fmtMoney(v);
  if (PERCENT.has(field) && numOf(v) != null) return fmtPercent(v);
  if (field === "ml" && numOf(v) != null) return `${numOf(v)} ml`;
  if (field === "grams" && numOf(v) != null) return `${numOf(v)} g`;
  if (field === "days_of_week" && Array.isArray(v)) return v.length ? v.map((d) => DAYS[Number(d)] ?? String(d)).join(", ") : "Every day";
  if (field === "dietary_labels" && Array.isArray(v)) return v.length ? clip(cleanGelatoLabels(v).map(gelatoLabelText).join(", ")) : "None";
  if (field === "dish_allergens") return clip(describeDishAllergens(v));
  if (Array.isArray(v)) return v.length ? clip(v.map((x) => (isObj(x) ? JSON.stringify(x) : String(x))).join(", ")) : "None";
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (!keys.length) return "None";
    return clip(keys.map((k) => (isObj(v[k]) && str((v[k] as R).note) ? `${k}: ${str((v[k] as R).note)}` : str(v[k]) && typeof v[k] === "string" ? `${k}: ${str(v[k])}` : k)).join("; "));
  }
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  return clip(String(v));
}

/** What changed in an ordered list of steps (method, garnish, plating): added, removed, edited in place, or reordered. */
export function describeSteps(noun: string, before: unknown, after: unknown): { title: string; old: string; next: string } {
  const a = (Array.isArray(before) ? before : []).map(String);
  const b = (Array.isArray(after) ? after : []).map(String);
  const count = (n: number) => `${n} ${noun.toLowerCase()}${n === 1 ? "" : "s"}`;
  const added = b.filter((x) => !a.includes(x));
  const removed = a.filter((x) => !b.includes(x));
  if (a.length === b.length && added.length === 1 && removed.length === 1) {
    const i = b.findIndex((x, ix) => x !== a[ix]);
    return { title: `${noun} ${i + 1} changed`, old: clip(removed[0]), next: clip(added[0]) };
  }
  if (!added.length && !removed.length) return { title: `${noun}s reordered`, old: count(a.length), next: "New order" };
  if (added.length && !removed.length) return { title: added.length === 1 ? `${noun} added` : `${count(added.length)} added`, old: "None", next: added.length === 1 ? clip(added[0]) : count(added.length) };
  if (removed.length && !added.length) return { title: removed.length === 1 ? `${noun} removed` : `${count(removed.length)} removed`, old: removed.length === 1 ? clip(removed[0]) : count(removed.length), next: "None" };
  return { title: `${count(added.length)} added, ${removed.length} removed`, old: count(a.length), next: count(b.length) };
}

/* ------------------------------------------------------------------ what older logs already cover */

/** Columns the older logs already report as their own events (cost_sell_price_log, cost_price_log, cost_audit_log). */
const COVERED: Record<string, string[]> = {
  cost_menu_items: ["sell_price_inc", "hh_price_inc", "active", "target_override"],
  cost_beer_prices: ["sell_price_inc", "hh_price_inc"],
  cost_beers: ["target_gp", "active"],
  cost_gelato_serves: ["sell_price_inc", "target_gp", "on_menu", "active"],
  cost_ingredients: ["pack_price", "previous_price", "last_price_update", "pack_size", "pack_unit", "yield_pct", "rebate", "price_inc_gst", "gst_free", "active", "name", "supplier_id", "supplier_code"],
};
/** Tables the audit log records completely (every insert, update and delete). */
const FULLY_COVERED = new Set(["cost_targets", "cost_settings", "cost_allowed_users"]);

export function isCovered(table: string, op: string, field: string | null, fields: string[]): boolean {
  if (FULLY_COVERED.has(table)) return true;
  if (op !== "update" || !field) return false;
  if (table === "cost_ingredients" && field === "source" && fields.includes("pack_price")) return true; // the price log keeps the source
  return (COVERED[table] ?? []).includes(field);
}

/* ------------------------------------------------------------------ describing a row */

const DRINK_CATEGORIES = new Set(["Cocktail", "Mocktail", "Cold Drink", "Tap Beer", "Packaged Beer & Cider", "Wine", "Spirits", "RTD"]);
const CHILD_TABLES = new Set(["cost_recipe_lines", "cost_gelato_serve_lines", "cost_offer_lines", "cost_beer_prices"]);

interface Ctx {
  row: HistoryRow;
  lk: HistoryLookups;
  o: R;
  n: R;
  r: R;
  fields: string[];
}

function venueOf(c: Ctx): number | undefined {
  const v = numOf(c.r.venue_id);
  return v ?? undefined;
}
function venueSuffix(c: Ctx, id: number | undefined | null): string {
  const v = id != null ? c.lk.venueName(id) : undefined;
  return v ? ` (${v})` : "";
}

/** The "Drink", "Dish", "Prep"... word and the record's own name. */
function recordInfo(c: Ctx): { word: string; name: string; venueId?: number; href?: string } {
  const { row, lk, r } = c;
  const key = row.row_key;
  const stored = lk.recordName(row.table_name, key);
  switch (row.table_name) {
    case "cost_menu_items": {
      const cat = str(r.category);
      const word = cat === "Food" ? "Dish" : cat === "Gelato" ? "Gelato Item" : DRINK_CATEGORIES.has(cat) ? "Drink" : "Menu Item";
      const live = lk.itemName(key);
      return { word, name: str(r.name) || live?.name || stored || "A menu item", venueId: venueOf(c) ?? live?.venueId, href: live ? `/items/${key}` : undefined };
    }
    case "cost_preps": {
      const live = lk.prepName(key);
      return { word: "Prep", name: str(r.name) || live?.name || stored || "A prep", venueId: venueOf(c) ?? live?.venueId ?? undefined, href: live ? `/preps/${key}` : undefined };
    }
    case "cost_ingredients": {
      const live = lk.ingredientName(key);
      return { word: "Ingredient", name: str(r.name) || live || stored || "An ingredient", href: live ? `/ingredients/${key}` : undefined };
    }
    case "cost_beers": {
      const live = lk.beerName(key);
      return { word: "Tap Beer", name: str(r.name) || live?.name || stored || "A tap beer", venueId: venueOf(c) ?? live?.venueId, href: live ? `/beers/${key}` : undefined };
    }
    case "cost_beer_serves":
      return { word: "Beer Serve", name: str(r.name) || lk.beerServeName(key) || stored || "A beer serve" };
    case "cost_gelato_serves": {
      const live = lk.gelatoServeName(key);
      return { word: "Gelato Serve", name: str(r.name) || live?.name || stored || "A gelato serve", venueId: venueOf(c) ?? live?.venueId, href: live ? "/gelato/serves" : undefined };
    }
    case "cost_offers": {
      const live = lk.offerName(key);
      const kind = str(r.kind);
      return { word: kind === "happy_hour" ? "Happy Hour" : kind === "special" ? "Special" : kind === "combo" ? "Combo" : "Offer", name: str(r.name) || live?.name || stored || "An offer", venueId: venueOf(c) ?? live?.venueId ?? undefined };
    }
    case "cost_ingredient_deals":
      return { word: "Deal", name: `${lk.ingredientName(str(r.ingredient_id)) ?? "An ingredient"} deal` };
    case "cost_suppliers":
      return { word: "Supplier", name: str(r.name) || lk.supplierName(Number(key)) || stored || "A supplier" };
    case "cost_specials":
      return { word: "Special", name: str(r.name) || stored || "A special", venueId: venueOf(c) };
    case "cost_targets": {
      const vid = numOf(r.venue_id) ?? undefined;
      return { word: "Target", name: `${(vid != null ? lk.venueName(vid) : undefined) ?? "Venue"} ${str(r.category) || "All"} target`, venueId: vid, href: "/settings" };
    }
    case "cost_settings":
      return { word: "Setting", name: SETTING_NAMES[key] ?? humanise(key), href: "/settings" };
    case "cost_bar_options":
      return { word: str(r.kind) === "rim" ? "Rim" : "Glass", name: str(r.name) || stored || "An option" };
    case "cost_allowed_users":
      return { word: "Sign-In", name: str(r.email) || key, href: "/settings" };
    default:
      if (isOrderingTable(row.table_name)) return { word: orderingWord(row.table_name), name: orderingName(row.table_name, r, orderingWhen), venueId: venueOf(c) };
      return { word: humanise(row.table_name), name: str(r.name) || key };
  }
}

/** "Mon 28 Sep" for a count's name (Brisbane time). */
function orderingWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Brisbane" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${String(p.month).slice(0, 3)}`; // some ICU versions say "Sept"
}
const orderingLk = (lk: HistoryLookups): OrderingLookups => ({ venueName: lk.venueName, ingredientName: lk.ingredientName, recordName: lk.recordName });

/** Stock count entries: only logged once their count is finalised, so every row here is an edit to a finalised count. */
function describeCountEntry(c: Ctx, make: Make): ChangeEvent[] {
  const { row, r } = c;
  const venueId = venueOf(c);
  const name = `${orderingName("ordering_count_lines", r, orderingWhen)}${venueSuffix(c, venueId)}`;
  const extra: Partial<ChangeEvent> = { venueId };
  if (row.op === "insert") return [make("", null, "other", `Count added after finalising: ${name}`, "None", countText(c.n), extra)];
  if (row.op === "delete") return [make("", null, "other", `Count removed after finalising: ${name}`, countText(c.o), "Removed", { ...extra, deleted: true, tone: "bad" })];
  // every edit also moves counted_at, counted_by and client_uuid: only the two quantities are worth a line
  const fields = ["store_qty", "second_qty"].filter((f) => JSON.stringify(c.o[f] ?? null) !== JSON.stringify(c.n[f] ?? null));
  const multi = fields.length > 1;
  return fields.map((f) => {
    const a = numOf(c.o[f]);
    const b = numOf(c.n[f]);
    const dir = a != null && b != null && a !== b ? (b > a ? "up" : "down") : "none";
    return make(multi ? `:${f}` : "", f, "other", `Count edited: ${name}, ${orderingFieldLabel(row.table_name, f)}`, orderingFmt(f, c.o[f], orderingLk(c.lk)), orderingFmt(f, c.n[f], orderingLk(c.lk)), { ...extra, direction: dir });
  });
}
const SETTING_NAMES: Record<string, string> = { gst_rate: "GST rate", round_to: "Round prices up to", alert_pct: "Price alert level", gelato_wastage: "Gelato wastage" };

function kindFor(table: string, field: string): ChangeKind {
  if (table === "cost_menu_items" || table === "cost_preps") {
    if (field === "sell_price_inc" || field === "hh_price_inc") return "sell_price";
    return METHOD_FIELDS.has(field) ? "method" : "recipe";
  }
  if (table === "cost_ingredients") return field === "pack_price" ? "ingredient_price" : "ingredient_detail";
  if (table === "cost_ingredient_deals") return "ingredient_price";
  if (table === "cost_offers") return field === "price_inc" ? "sell_price" : "other";
  if (table === "cost_specials") return field === "sell_price_inc" ? "sell_price" : "other";
  if (table === "cost_beer_prices") return "sell_price";
  if (table === "cost_bar_options") return "method";
  if (table === "cost_targets") return "target";
  if (table === "cost_settings") return "setting";
  if (table === "cost_allowed_users") return "access";
  if (table === "cost_recipe_lines") return "recipe";
  return "other";
}

/** Describes one history row as plain-English events. See the file header. Never throws. */
export function describeHistoryRow(row: HistoryRow, lk: HistoryLookups = NO_HISTORY_LOOKUPS): ChangeEvent[] {
  const o = row.old_row ?? {};
  const n = row.new_row ?? {};
  const r0: R = row.new_row ?? row.old_row ?? {};
  // an update is titled by the name the record had BEFORE (a rename reads "Margarita: Name, Marg")
  const c: Ctx = { row, lk, o, n, r: row.op === "update" && o.name != null ? { ...r0, name: o.name } : r0, fields: row.changed_fields ?? [] };
  const base = { at: iso(row.changed_at), who: row.changed_by && row.changed_by.trim() ? row.changed_by.trim() : null, system: !(row.changed_by && row.changed_by.trim()), historyId: row.id, table: row.table_name, rowKey: row.row_key, op: row.op };
  const make = (suffix: string, field: string | null, kind: ChangeKind, title: string, oldValue: string, newValue: string, extra: Partial<ChangeEvent> = {}): ChangeEvent => ({
    id: `hist:${row.id}${suffix}`,
    ...base,
    kind,
    title,
    detail: "",
    oldValue,
    newValue,
    direction: "none",
    tone: "none",
    covered: isCovered(row.table_name, row.op, field, c.fields),
    ...extra,
  });
  try {
    if (row.table_name === "ordering_count_lines") return describeCountEntry(c, make);
    if (CHILD_TABLES.has(row.table_name)) return describeLine(c, make);
    const info = recordInfo(c);
    const venueId = info.venueId;
    const withVenue = `${info.name}${venueSuffix(c, venueId)}`;
    if (row.op === "insert") return [make("", null, kindFor(row.table_name, ""), `Added ${info.word}: ${withVenue}`, "None", summary(c), { venueId, refHref: info.href })];
    if (row.op === "delete") return [make("", null, kindFor(row.table_name, ""), `Deleted ${info.word}: ${withVenue}`, summary(c), "Deleted", { venueId, deleted: true, tone: "bad" })];
    return describeUpdate(c, info, venueId, withVenue, make);
  } catch {
    return [make("", null, "other", `${humanise(String(row.table_name ?? ""))} ${row.op === "insert" ? "added" : row.op === "delete" ? "deleted" : "changed"}`, "", "", { covered: false })];
  }
}

type Make = (suffix: string, field: string | null, kind: ChangeKind, title: string, oldValue: string, newValue: string, extra?: Partial<ChangeEvent>) => ChangeEvent;

/** A short "what it was" for added and deleted records: category and price, size, status. */
function summary(c: Ctx): string {
  const r = c.r;
  const bits: string[] = [];
  switch (c.row.table_name) {
    case "cost_menu_items":
      bits.push(str(r.category), numOf(r.sell_price_inc) != null ? fmtMoney(r.sell_price_inc) : "");
      break;
    case "cost_preps":
      bits.push(str(r.prep_type), numOf(r.yield_qty) != null ? `makes ${numOf(r.yield_qty)} ${str(r.yield_unit)}` : "");
      break;
    case "cost_ingredients":
      bits.push(str(r.category), numOf(r.pack_price) != null ? `${fmtMoney(r.pack_price)} per ${numOf(r.pack_size) ?? 1} ${str(r.pack_unit)}` : "");
      break;
    case "cost_offers":
      bits.push(str(r.status), numOf(r.price_inc) != null ? fmtMoney(r.price_inc) : "");
      break;
    case "cost_gelato_serves":
      bits.push(numOf(r.grams) != null ? `${numOf(r.grams)} g` : "", numOf(r.sell_price_inc) != null ? fmtMoney(r.sell_price_inc) : "");
      break;
    case "cost_beer_serves":
      bits.push(numOf(r.ml) != null ? `${numOf(r.ml)} ml` : "");
      break;
    case "cost_targets":
      bits.push(fmtPercent(r.target_gp));
      break;
    case "cost_settings":
      bits.push(fmtField(c.row.row_key, r.value));
      break;
    case "cost_ingredient_deals":
      bits.push(humanise(str(r.kind)));
      break;
    default:
      if (isOrderingTable(c.row.table_name)) bits.push(orderingSummary(c.row.table_name, r, orderingLk(c.lk)));
      break;
  }
  const t = bits.filter(Boolean).join(", ");
  return t || (c.row.op === "insert" ? "Added" : "Removed");
}

function describeUpdate(c: Ctx, info: { word: string; name: string; href?: string }, venueId: number | undefined, withVenue: string, make: Make): ChangeEvent[] {
  const t = c.row.table_name;
  const out: ChangeEvent[] = [];
  const fields = c.fields.length ? c.fields : Object.keys(c.n).filter((k) => JSON.stringify(c.o[k]) !== JSON.stringify(c.n[k]));
  const multi = fields.length > 1;
  for (const f of fields) {
    const sfx = multi ? `:${f}` : "";
    const ov = c.o[f];
    const nv = c.n[f];
    const extra: Partial<ChangeEvent> = { venueId, refHref: info.href };
    const step = STEP_FIELDS[f];
    if (step && (Array.isArray(ov) || Array.isArray(nv) || ov == null || nv == null)) {
      const d = describeSteps(step.charAt(0).toUpperCase() + step.slice(1), ov, nv);
      out.push(make(sfx, f, kindFor(t, f), `${withVenue}: ${label(f)}, ${d.title.toLowerCase()}`, d.old, d.next, extra));
      continue;
    }
    if (t === "cost_allowed_users" && f === "display_name") {
      out.push(make(sfx, f, "access", `Name set for ${info.name}`, fmtField(f, ov), fmtField(f, nv), extra));
      continue;
    }
    if (t === "cost_settings" && f === "value") {
      const fmt = c.row.row_key === "round_to" ? (v: unknown) => fmtMoney(v) : (v: unknown) => fmtPercent(v);
      out.push(make(sfx, f, "setting", info.name, ov == null ? "None" : fmt(ov), nv == null ? "None" : fmt(nv), extra));
      continue;
    }
    if (t === "cost_targets" && f === "target_gp") {
      out.push(make(sfx, f, "target", info.name, fmtField(f, ov), fmtField(f, nv), extra));
      continue;
    }
    if (t === "cost_bar_options" && f === "name") {
      out.push(make(sfx, f, "method", `${info.word} renamed`, fmtField(f, ov), fmtField(f, nv), extra));
      continue;
    }
    if (isOrderingTable(t)) {
      const a0 = numOf(ov);
      const b0 = numOf(nv);
      const d0 = a0 != null && b0 != null && a0 !== b0 ? (b0 > a0 ? "up" : "down") : "none";
      out.push(make(sfx, f, "other", `${withVenue}: ${orderingFieldLabel(t, f)}`, orderingFmt(f, ov, orderingLk(c.lk)), orderingFmt(f, nv, orderingLk(c.lk)), { ...extra, direction: d0 }));
      continue;
    }
    const a = numOf(ov);
    const b = numOf(nv);
    const dir = a != null && b != null && a !== b ? (b > a ? "up" : "down") : "none";
    const titleName = t === "cost_menu_items" || t === "cost_preps" || t === "cost_beers" || t === "cost_gelato_serves" || t === "cost_offers" || t === "cost_specials" ? withVenue : info.name;
    out.push(make(sfx, f, kindFor(t, f), `${titleName}: ${label(f)}`, fmtField(f, ov, c.lk), fmtField(f, nv, c.lk), { ...extra, direction: dir }));
  }
  return out;
}

/** Recipe lines, gelato serve lines, offer lines and beer serve prices: added, removed, amount changed. */
function describeLine(c: Ctx, make: Make): ChangeEvent[] {
  const { row, lk, r } = c;
  const t = row.table_name;
  let parent = "A record";
  let venueId: number | undefined;
  let href: string | undefined;
  let what = "An ingredient";
  let amount = (src: R): string => formatQty(Number(src.qty) || 0, (str(src.unit) || "each") as LineUnit);
  const pid = row.parent_id ?? "";
  if (t === "cost_recipe_lines") {
    if (r.parent_type === "item") {
      const it = lk.itemName(pid);
      parent = it?.name ?? lk.recordName("cost_menu_items", pid) ?? "A dish or drink";
      venueId = it?.venueId;
      href = it ? `/items/${pid}` : undefined;
    } else {
      const p = lk.prepName(pid);
      parent = p?.name ?? lk.recordName("cost_preps", pid) ?? "A prep";
      venueId = p?.venueId ?? undefined;
      href = p ? `/preps/${pid}` : undefined;
    }
    const cid = str(r.component_id);
    what = r.component_type === "prep" ? lk.prepName(cid)?.name ?? lk.recordName("cost_preps", cid) ?? "A prep" : lk.ingredientName(cid) ?? lk.recordName("cost_ingredients", cid) ?? "An ingredient";
  } else if (t === "cost_gelato_serve_lines") {
    const s = lk.gelatoServeName(pid);
    parent = s?.name ?? lk.recordName("cost_gelato_serves", pid) ?? "A gelato serve";
    venueId = s?.venueId;
    what = lk.ingredientName(str(r.ingredient_id)) ?? "An ingredient";
  } else if (t === "cost_offer_lines") {
    const of = lk.offerName(pid);
    parent = of?.name ?? lk.recordName("cost_offers", pid) ?? "An offer";
    venueId = of?.venueId ?? undefined;
    what = str(r.item_id) ? lk.itemName(str(r.item_id))?.name ?? "A menu item" : [str(r.beer_id) ? lk.beerName(str(r.beer_id))?.name ?? "A tap beer" : "", str(r.serve_id) ? lk.beerServeName(str(r.serve_id)) ?? "" : ""].filter(Boolean).join(" ") || "An item";
    amount = (src) => `${numOf(src.qty) ?? 1} x`;
  } else {
    // cost_beer_prices: one price per tap beer serve
    const b = lk.beerName(pid);
    parent = b?.name ?? lk.recordName("cost_beers", pid) ?? "A tap beer";
    venueId = b?.venueId;
    href = b ? `/beers/${pid}` : undefined;
    what = lk.beerServeName(str(r.serve_id)) ?? "A serve";
    amount = (src) => (numOf(src.sell_price_inc) != null ? fmtMoney(src.sell_price_inc) : "None");
  }
  const where = `${parent}${venueId != null && lk.venueName(venueId) ? ` (${lk.venueName(venueId)})` : ""}`;
  const kind = kindFor(t, "");
  const extra: Partial<ChangeEvent> = { venueId, refHref: href };
  if (row.op === "insert") return [make("", null, kind, `${where}: ${what} added`, "None", amount(c.n), extra)];
  if (row.op === "delete") return [make("", null, kind, `${where}: ${what} removed`, amount(c.o), "None", extra)];
  const out: ChangeEvent[] = [];
  const f = c.fields;
  const amountFields = t === "cost_beer_prices" ? ["sell_price_inc", "hh_price_inc"] : ["qty", "unit", "price_inc_override"];
  const multi = f.length > 1;
  let doneAmount = false;
  for (const field of f) {
    if (amountFields.includes(field)) {
      if (doneAmount) continue;
      doneAmount = true;
      const a = numOf(c.o.qty ?? c.o.sell_price_inc);
      const b = numOf(c.n.qty ?? c.n.sell_price_inc);
      const title = t === "cost_beer_prices" && field === "hh_price_inc" ? `${where}: ${what} happy hour price` : t === "cost_beer_prices" ? `${where}: ${what} price` : `${where}: ${what} amount`;
      out.push(make(multi ? ":amount" : "", field, kind, title, amount(c.o), amount(c.n), { ...extra, direction: a != null && b != null && a !== b ? (b > a ? "up" : "down") : "none" }));
      continue;
    }
    if (field === "component_id" || field === "ingredient_id" || field === "item_id" || field === "beer_id" || field === "serve_id" || field === "component_type") {
      if (field === "component_type") continue;
      const nameOf = (src: R): string => (t === "cost_recipe_lines" ? (src.component_type === "prep" ? lk.prepName(str(src.component_id))?.name : lk.ingredientName(str(src.component_id))) ?? "Unknown" : lk.ingredientName(str(src[field])) ?? "Unknown");
      out.push(make(multi ? `:${field}` : "", field, kind, `${where}: ${what} swapped`, nameOf(c.o), nameOf(c.n), extra));
      continue;
    }
    out.push(make(multi ? `:${field}` : "", field, kind, `${where}: ${what} ${label(field).toLowerCase()}`, fmtField(field, c.o[field], lk), fmtField(field, c.n[field], lk), extra));
  }
  return out;
}

const iso = (s: string | null | undefined): string => (s && !Number.isNaN(new Date(s).getTime()) ? new Date(s).toISOString() : new Date(0).toISOString());

/* ------------------------------------------------------------------ the merged feed */

const NEAR = 120_000; // ms: a new record and its first lines are saved a moment apart

/**
 * Rows whose events the feed should not repeat. Child rows (recipe lines, serve lines, offer lines, serve prices) of a
 * record that was deleted, or that were added together with a newly created record, are part of that one event.
 */
function hiddenChildIds(rows: HistoryRow[]): Set<string> {
  const deleted = new Set<string>();
  const inserted = new Map<string, number>();
  for (const r of rows) {
    if (CHILD_TABLES.has(r.table_name)) continue;
    const k = `${r.table_name}|${r.row_key}`;
    if (r.op === "delete") deleted.add(k);
    if (r.op === "insert") inserted.set(k, new Date(r.changed_at).getTime());
  }
  const hide = new Set<string>();
  for (const r of rows) {
    if (!CHILD_TABLES.has(r.table_name) || !r.parent_table || !r.parent_id) continue;
    const pk = `${r.parent_table}|${r.parent_id}`;
    if (r.op === "delete" && deleted.has(pk)) hide.add(String(r.id));
    if (r.op === "insert") {
      const at = inserted.get(pk);
      if (at != null && Math.abs(new Date(r.changed_at).getTime() - at) <= NEAR) hide.add(String(r.id));
    }
  }
  return hide;
}

/** Names of records that are gone (or never loaded), from the history itself: "table|key" -> name. */
export function namesFromHistory(rows: HistoryRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const src = r.new_row ?? r.old_row;
    const name = src && (str(src.name) || str(src.email));
    if (name && !m.has(`${r.table_name}|${r.row_key}`)) m.set(`${r.table_name}|${r.row_key}`, name);
  }
  return m;
}

export function sortEvents(events: ChangeEvent[]): ChangeEvent[] {
  return [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * The older logs plus the new history, in one list newest first. Events an older log already reports (sell price,
 * happy hour price, ingredient priced fields, active and own target on items, and everything the audit log keeps for
 * targets, settings and the sign-in list) are left out of the feed; the history rows themselves are kept.
 */
export function buildFullChangeLog(
  src: { audit?: AuditRow[] | null; sell?: SellPriceRow[] | null; prices?: PriceLogRow[] | null; history?: HistoryRow[] | null },
  lk: HistoryLookups = NO_HISTORY_LOOKUPS,
): ChangeEvent[] {
  const legacy = buildChangeLog(src, lk);
  const rows = src.history ?? [];
  if (!rows.length) return legacy;
  const gone = namesFromHistory(rows);
  const lk2: HistoryLookups = { ...lk, recordName: (t, k) => lk.recordName(t, k) ?? gone.get(`${t}|${k}`) };
  const hide = hiddenChildIds(rows);
  const fresh: ChangeEvent[] = [];
  for (const r of rows) {
    if (hide.has(String(r.id))) continue;
    for (const e of describeHistoryRow(r, lk2)) if (!e.covered) fresh.push(e);
  }
  return sortEvents([...legacy, ...fresh]);
}

/** Brisbane-time page helper for the Change Log: how many events to show before "Show More". */
export function pageOf<T>(items: T[], pages: number, size = 100): { shown: T[]; more: boolean } {
  const n = Math.max(1, pages) * size;
  return { shown: items.slice(0, n), more: items.length > n };
}
