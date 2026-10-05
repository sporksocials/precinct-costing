/**
 * Ordering module: the data access layer (no React). Typed async functions over the Supabase client, per venue.
 * Callers pass the client: `getSupabaseBrowser()` in the app (demo mode swaps in the in-memory client), a fake in tests.
 *
 * Rules kept here:
 *   - Every INSERT goes through insertRow/insertRows below, which strip null/undefined keys (withoutNulls from lib/store.tsx)
 *     so a column with a server-side default gets its default. They mirror the store's helpers of the same name (the store
 *     keeps its own private); tests/ordering-data.test.ts pins that this file has no other raw insert.
 *   - Count lines are written with UPSERT on (session_id, product_id), not insert: a cleared quantity must reach the
 *     database as an explicit null, and withoutNulls would drop it. That is the one place nulls are sent on purpose.
 *   - A write that touches no row is a failure (row level security can do that silently), never a silent success.
 *   - Edit stamps (updated_at, updated_by = the signed-in email) are filled in by the database trigger cost_stamp_edit(), as
 *     for every cost_* table, so nothing here sets them. Who counted, started, finalised or sent is passed in by the caller.
 *   - Sent orders never change: line edits check the order is still a draft.
 * Errors are thrown as OrderingError with a plain-English message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./change-log";
import { mergeCountEdits } from "./ordering";
import { insertRow, insertRows, newId } from "./store";
import type {
  CountEdit,
  CountLineWrite,
  OrderLineDraft,
  OrderKind,
  OrderSendMethod,
  OrderingCategory,
  OrderingCountLine,
  OrderingCountSession,
  OrderingOrder,
  OrderingOrderLine,
  OrderingProduct,
  OrderingSupplier,
} from "./ordering-types";

export const T = {
  suppliers: "ordering_suppliers",
  categories: "ordering_categories",
  products: "ordering_products",
  sessions: "ordering_count_sessions",
  countLines: "ordering_count_lines",
  orders: "ordering_orders",
  orderLines: "ordering_order_lines",
  priceUploads: "ordering_price_uploads",
  priceLog: "ordering_price_log",
} as const;

export const ORDERING_UNAVAILABLE = "Ordering is not set up in the database yet. Ask SPORK to apply the Ordering update.";

export class OrderingError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "OrderingError";
  }
}

type DbError = { code?: string; message?: string } | null | undefined;

/** Turns a Supabase error into the plain message a screen can show. `what` names the clash for a unique violation. */
function fail(error: NonNullable<DbError>, clash?: string): never {
  if (isMissingTable(error)) throw new OrderingError(ORDERING_UNAVAILABLE, "missing_table");
  if (error.code === "23505") throw new OrderingError(clash ?? "That already exists at this venue.", "23505");
  if (error.code === "23503") throw new OrderingError("That is still in use or no longer exists. Refresh and try again.", "23503");
  throw new OrderingError(error.message || "That did not save.", error.code);
}

const NOT_SAVED = "That change did not save. It may have been removed by someone else, or you may not have access. Refresh and try again.";

function one<T>(rows: unknown, what = NOT_SAVED): T {
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first) throw new OrderingError(what, "not_saved");
  return first as T;
}

const PAGE = 1000;

/** Reads every row of a query, paging past the API's 1000 row limit. `page` must be ordered by a unique column. */
async function pageAll<R>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: DbError }>): Promise<R[]> {
  const out: R[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(error);
    const rows = (data ?? []) as R[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/* ------------------------------------------------------------------ loading */

export interface OrderingVenueData {
  suppliers: OrderingSupplier[];
  categories: OrderingCategory[];
  products: OrderingProduct[];
  /** the latest sessions, newest first */
  sessions: OrderingCountSession[];
  /** the count in progress, if any (there is at most one per venue) */
  openSession: OrderingCountSession | null;
}

/** One venue's ordering data. Nothing from another venue is ever read. Throws OrderingError(ORDERING_UNAVAILABLE) before the migration is applied. */
export async function loadVenueOrdering(sb: SupabaseClient, venueId: number, sessionLimit = 12): Promise<OrderingVenueData> {
  const [suppliers, categories, products, sessionsRes] = await Promise.all([
    pageAll<OrderingSupplier>((a, b) => sb.from(T.suppliers).select("*").eq("venue_id", venueId).order("sort").order("name").order("id").range(a, b)),
    pageAll<OrderingCategory>((a, b) => sb.from(T.categories).select("*").eq("venue_id", venueId).order("sort").order("name").order("id").range(a, b)),
    pageAll<OrderingProduct>((a, b) => sb.from(T.products).select("*").eq("venue_id", venueId).order("sort").order("name").order("id").range(a, b)),
    sb.from(T.sessions).select("*").eq("venue_id", venueId).order("started_at", { ascending: false }).limit(sessionLimit),
  ]);
  if (sessionsRes.error) fail(sessionsRes.error);
  const sessions = (sessionsRes.data ?? []) as OrderingCountSession[];
  return { suppliers, categories, products, sessions, openSession: sessions.find((s) => s.status === "in_progress") ?? null };
}

export async function loadCountLines(sb: SupabaseClient, sessionId: string): Promise<OrderingCountLine[]> {
  return pageAll<OrderingCountLine>((a, b) => sb.from(T.countLines).select("*").eq("session_id", sessionId).order("id").range(a, b));
}

/** One product's counts across sessions, newest first (the per-product History page). Load the sessions separately for their dates. */
export async function loadCountLinesForProduct(sb: SupabaseClient, venueId: number, productId: string, limit = 52): Promise<OrderingCountLine[]> {
  const { data, error } = await sb.from(T.countLines).select("*").eq("venue_id", venueId).eq("product_id", productId).order("counted_at", { ascending: false }).limit(limit);
  if (error) fail(error);
  return (data ?? []) as OrderingCountLine[];
}

export async function loadOrders(sb: SupabaseClient, venueId: number, opts: { sessionId?: string; limit?: number } = {}): Promise<OrderingOrder[]> {
  let q = sb.from(T.orders).select("*").eq("venue_id", venueId);
  if (opts.sessionId) q = q.eq("session_id", opts.sessionId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  if (error) fail(error);
  return (data ?? []) as OrderingOrder[];
}

export async function loadOrderLines(sb: SupabaseClient, orderId: string): Promise<OrderingOrderLine[]> {
  const { data, error } = await sb.from(T.orderLines).select("*").eq("order_id", orderId).order("sort").order("id");
  if (error) fail(error);
  return (data ?? []) as OrderingOrderLine[];
}

/* ------------------------------------------------------------------ suppliers, categories, products */

export type SupplierDraft = Omit<OrderingSupplier, "id" | "venue_id" | "created_at" | "updated_at" | "updated_by">;
export type CategoryDraft = Omit<OrderingCategory, "id" | "venue_id" | "created_at" | "updated_at" | "updated_by">;
export type ProductDraft = Omit<OrderingProduct, "id" | "venue_id" | "created_at" | "updated_at" | "updated_by">;

/** A supplier with the defaults a new one starts from. */
export function blankSupplier(name = ""): SupplierDraft {
  return { name, method: "email", email_to: null, login_url: null, rep_name: null, rep_phone: null, account_no: null, min_order_value: null, min_order_units: null, show_prices_on_order: false, notes: null, active: true, sort: 0 };
}
export function blankCategory(name = "", unit_name = "carton"): CategoryDraft {
  return { name, sort: 0, second_location_label: null, unit_name };
}
export function blankProduct(categoryId: string, name = "", unit_name = "carton"): ProductDraft {
  return { category_id: categoryId, sort: 0, name, unit_name, supplier_id: null, supplier_item_code: null, pack_multiple: 1, price_inc_gst: null, ingredient_id: null, costing_packs_per_unit: null, par: 0, notes: null, active: true };
}

export async function createSupplier(sb: SupabaseClient, venueId: number, draft: SupplierDraft, id: string = newId()): Promise<OrderingSupplier> {
  const { data, error } = await insertRow(sb, T.suppliers, { ...draft, id, venue_id: venueId }).select("*");
  if (error) fail(error, `A supplier called ${draft.name} already exists at this venue.`);
  return one<OrderingSupplier>(data);
}
export async function updateSupplier(sb: SupabaseClient, id: string, patch: Partial<SupplierDraft>): Promise<OrderingSupplier> {
  const { data, error } = await sb.from(T.suppliers).update(patch).eq("id", id).select("*");
  if (error) fail(error, "Another supplier at this venue already has that name.");
  return one<OrderingSupplier>(data);
}

export async function createCategory(sb: SupabaseClient, venueId: number, draft: CategoryDraft, id: string = newId()): Promise<OrderingCategory> {
  const { data, error } = await insertRow(sb, T.categories, { ...draft, id, venue_id: venueId }).select("*");
  if (error) fail(error, `A category called ${draft.name} already exists at this venue.`);
  return one<OrderingCategory>(data);
}
export async function updateCategory(sb: SupabaseClient, id: string, patch: Partial<CategoryDraft>): Promise<OrderingCategory> {
  const { data, error } = await sb.from(T.categories).update(patch).eq("id", id).select("*");
  if (error) fail(error, "Another category at this venue already has that name.");
  return one<OrderingCategory>(data);
}

export async function createProduct(sb: SupabaseClient, venueId: number, draft: ProductDraft, id: string = newId()): Promise<OrderingProduct> {
  const { data, error } = await insertRow(sb, T.products, { ...draft, id, venue_id: venueId }).select("*");
  if (error) fail(error, `A product called ${draft.name} already exists in that category at this venue.`);
  return one<OrderingProduct>(data);
}
/** Changes to a product (a new Build To, a new price) are recorded in the change history by the database, with who and the old value. */
export async function updateProduct(sb: SupabaseClient, id: string, patch: Partial<ProductDraft>): Promise<OrderingProduct> {
  const { data, error } = await sb.from(T.products).update(patch).eq("id", id).select("*");
  if (error) fail(error, "Another product in that category already has that name.");
  return one<OrderingProduct>(data);
}
/** Many inserts at once (the sheet import): every row goes through insertRows. Rows keep the order given. */
export async function createProducts(sb: SupabaseClient, venueId: number, drafts: readonly ProductDraft[]): Promise<OrderingProduct[]> {
  if (!drafts.length) return [];
  const { data, error } = await insertRows(sb, T.products, drafts.map((d) => ({ ...d, id: newId(), venue_id: venueId }))).select("*");
  if (error) fail(error, "One of those products already exists in its category at this venue.");
  return (data ?? []) as OrderingProduct[];
}

/* ------------------------------------------------------------------ count sessions and lines */

/**
 * Start Count: begins a count, or RESUMES the one already in progress (there is at most one per venue, enforced by a unique
 * index, so two phones starting at once end up in the same count). `resumed` says which happened.
 */
export async function startCountSession(sb: SupabaseClient, venueId: number, by: string | null, id: string = newId()): Promise<{ session: OrderingCountSession; resumed: boolean }> {
  const { data, error } = await insertRow(sb, T.sessions, { id, venue_id: venueId, started_by: by, status: "in_progress" }).select("*");
  if (!error) return { session: one<OrderingCountSession>(data), resumed: false };
  if (error.code === "23505") {
    const open = await findOpenSession(sb, venueId);
    if (open) return { session: open, resumed: true };
  }
  fail(error);
}

export async function findOpenSession(sb: SupabaseClient, venueId: number): Promise<OrderingCountSession | null> {
  const { data, error } = await sb.from(T.sessions).select("*").eq("venue_id", venueId).eq("status", "in_progress").limit(1);
  if (error) fail(error);
  return ((data ?? [])[0] as OrderingCountSession | undefined) ?? null;
}

/**
 * Writes count lines (an upsert on session_id + product_id, see the file header for why it is not an insert). Chunked so a
 * whole sheet is one call or two.
 */
export async function upsertCountLines(sb: SupabaseClient, lines: readonly CountLineWrite[]): Promise<OrderingCountLine[]> {
  const saved: OrderingCountLine[] = [];
  for (let i = 0; i < lines.length; i += 200) {
    const { data, error } = await sb.from(T.countLines).upsert(lines.slice(i, i + 200), { onConflict: "session_id,product_id" }).select("*");
    if (error) fail(error, "That quantity was already saved.");
    saved.push(...((data ?? []) as OrderingCountLine[]));
  }
  return saved;
}

export interface CountSyncResult {
  /** lines written to the database */
  written: number;
  /** client_uuids not applied: already saved, or the database holds a newer count */
  skipped: string[];
  /** every line of the session after the sync (what the screen should show) */
  lines: OrderingCountLine[];
}

/**
 * Syncs a device's queued count edits for one session: reads the session's lines, merges the edits (last write wins by
 * the device's clock; a retried edit is skipped; 0 stays distinct from null), upserts only what changed. Safe to call again
 * with the same queue. The caller clears the edits it passed in once this resolves. Edits for other sessions are ignored.
 */
export async function syncCountEdits(sb: SupabaseClient, sessionId: string, queue: readonly CountEdit[]): Promise<CountSyncResult> {
  const mine = queue.filter((e) => e.session_id === sessionId);
  const server = await loadCountLines(sb, sessionId);
  if (!mine.length) return { written: 0, skipped: [], lines: server };
  const merged = mergeCountEdits(server, mine);
  const saved = merged.writes.length ? await upsertCountLines(sb, merged.writes) : [];
  const byProduct = new Map(server.map((l) => [l.product_id, l]));
  for (const s of saved) byProduct.set(s.product_id, s);
  return { written: saved.length, skipped: merged.skipped, lines: [...byProduct.values()] };
}

/**
 * Finalise: marks the count ready to order. Edits after this are still allowed and are logged with the old values by the
 * database. Finalising twice is fine (the second call returns the session as it is).
 */
export async function finaliseCountSession(sb: SupabaseClient, sessionId: string, by: string | null, now: string = new Date().toISOString()): Promise<OrderingCountSession> {
  const { data, error } = await sb.from(T.sessions).update({ status: "finalised", finalised_by: by, finalised_at: now }).eq("id", sessionId).eq("status", "in_progress").select("*");
  if (error) fail(error);
  const first = (data ?? [])[0] as OrderingCountSession | undefined;
  if (first) return first;
  const { data: existing, error: e2 } = await sb.from(T.sessions).select("*").eq("id", sessionId);
  if (e2) fail(e2);
  return one<OrderingCountSession>(existing, "That count could not be found.");
}

/* ------------------------------------------------------------------ orders */

export interface NewOrder {
  supplierId: string;
  sessionId: string | null;
  kind: OrderKind;
  showPrices: boolean;
  lines: readonly OrderLineDraft[];
}

/**
 * Saves a draft order and its lines. If the lines are refused the draft is removed again, so no empty order is left behind.
 * Lines with a quantity of 0 are not saved.
 */
export async function createOrder(sb: SupabaseClient, venueId: number, o: NewOrder, id: string = newId()): Promise<{ order: OrderingOrder; lines: OrderingOrderLine[] }> {
  const { data, error } = await insertRow(sb, T.orders, { id, venue_id: venueId, supplier_id: o.supplierId, session_id: o.sessionId, kind: o.kind, show_prices: o.showPrices, status: "draft" }).select("*");
  if (error) fail(error);
  const order = one<OrderingOrder>(data);
  const rows = o.lines.filter((l) => l.ordered_qty > 0).map((l, i) => ({ ...l, id: newId(), venue_id: venueId, order_id: id, sort: i }));
  if (!rows.length) return { order, lines: [] };
  const { data: saved, error: e2 } = await insertRows(sb, T.orderLines, rows).select("*");
  if (e2) {
    await sb.from(T.orders).delete().eq("id", id).eq("status", "draft");
    fail(e2);
  }
  return { order, lines: ((saved ?? []) as OrderingOrderLine[]).sort((a, b) => a.sort - b.sort) };
}

async function assertDraft(sb: SupabaseClient, orderId: string): Promise<void> {
  const { data, error } = await sb.from(T.orders).select("id,status").eq("id", orderId);
  if (error) fail(error);
  const row = (data ?? [])[0] as { status?: string } | undefined;
  if (!row) throw new OrderingError("That order could not be found.", "not_found");
  if (row.status !== "draft") throw new OrderingError("That order has been sent, so it cannot be changed.", "sent");
}

/** Changes a quantity on a DRAFT order's line. A sent order never changes. */
export async function updateDraftOrderLine(sb: SupabaseClient, orderId: string, lineId: string, patch: Partial<Pick<OrderingOrderLine, "ordered_qty" | "price_inc_gst">>): Promise<OrderingOrderLine> {
  await assertDraft(sb, orderId);
  const { data, error } = await sb.from(T.orderLines).update(patch).eq("id", lineId).eq("order_id", orderId).select("*");
  if (error) fail(error);
  return one<OrderingOrderLine>(data);
}

/** Adds a line (a product not in the suggestion) to a DRAFT order. */
export async function addDraftOrderLine(sb: SupabaseClient, venueId: number, orderId: string, line: OrderLineDraft): Promise<OrderingOrderLine> {
  await assertDraft(sb, orderId);
  const { data, error } = await insertRow(sb, T.orderLines, { ...line, id: newId(), venue_id: venueId, order_id: orderId }).select("*");
  if (error) fail(error);
  return one<OrderingOrderLine>(data);
}

/** Removes a line from a DRAFT order. */
export async function removeDraftOrderLine(sb: SupabaseClient, orderId: string, lineId: string): Promise<void> {
  await assertDraft(sb, orderId);
  const { error } = await sb.from(T.orderLines).delete().eq("id", lineId).eq("order_id", orderId);
  if (error) fail(error);
}

export interface SentDetails {
  by: string | null;
  method: OrderSendMethod;
  subject: string;
  /** the exact text that went out */
  bodyText: string;
  warningText: string | null;
  showPrices: boolean;
  at?: string;
}

/** Mark As Sent: saves who, when, how and the exact text. Only a draft can be marked; marking twice returns the order as it is. */
export async function markOrderSent(sb: SupabaseClient, orderId: string, d: SentDetails): Promise<OrderingOrder> {
  const patch = { status: "sent", sent_by: d.by, sent_at: d.at ?? new Date().toISOString(), method: d.method, subject: d.subject, body_text: d.bodyText, warning_text: d.warningText, show_prices: d.showPrices };
  const { data, error } = await sb.from(T.orders).update(patch).eq("id", orderId).eq("status", "draft").select("*");
  if (error) fail(error);
  const first = (data ?? [])[0] as OrderingOrder | undefined;
  if (first) return first;
  const { data: existing, error: e2 } = await sb.from(T.orders).select("*").eq("id", orderId);
  if (e2) fail(e2);
  return one<OrderingOrder>(existing, "That order could not be found.");
}

/* ------------------------------------------------------------------ the offline queue (this device) */

/** Where unsent count edits wait on this device. A thin wrapper so tests can pass a fake; the app passes window.localStorage. */
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const queueKey = (venueId: number) => `precinct-ordering-queue-v1:${venueId}`;

/** Edits waiting to sync for a venue. Unreadable or missing storage reads as an empty queue, never throws. */
export function readCountQueue(storage: QueueStorage | null | undefined, venueId: number): CountEdit[] {
  try {
    const raw = storage?.getItem(queueKey(venueId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as CountEdit[]).filter((e) => e && typeof e.client_uuid === "string" && typeof e.product_id === "string") : [];
  } catch {
    return [];
  }
}
/** Saves the queue; returns false when the device refused (storage full or blocked), so the screen can warn. */
export function writeCountQueue(storage: QueueStorage | null | undefined, venueId: number, queue: readonly CountEdit[]): boolean {
  try {
    if (!storage) return false;
    storage.setItem(queueKey(venueId), JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}
/** Adds one tap to the queue (saved on the device first). `edit.client_uuid` defaults to a new one. */
export function enqueueCountEdit(storage: QueueStorage | null | undefined, venueId: number, edit: Omit<CountEdit, "client_uuid"> & { client_uuid?: string }): { queue: CountEdit[]; saved: boolean } {
  const full: CountEdit = { ...edit, client_uuid: edit.client_uuid ?? newId() };
  const queue = [...readCountQueue(storage, venueId), full];
  return { queue, saved: writeCountQueue(storage, venueId, queue) };
}
/** After a sync: removes the edits that were sent (by client_uuid), keeping any tapped while the sync ran. */
export function dropSyncedEdits(storage: QueueStorage | null | undefined, venueId: number, sent: readonly CountEdit[]): CountEdit[] {
  const done = new Set(sent.map((e) => e.client_uuid));
  const queue = readCountQueue(storage, venueId).filter((e) => !done.has(e.client_uuid));
  writeCountQueue(storage, venueId, queue);
  return queue;
}

/** What the count screen shows while edits are pending: the server's lines with the queue applied on top (nothing written). */
export function countLinesWithQueue(serverLines: readonly OrderingCountLine[], queue: readonly CountEdit[]): CountLineWrite[] {
  return mergeCountEdits(serverLines, queue).lines;
}
