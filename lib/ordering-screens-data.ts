/**
 * Ordering module: data access for the home, Setup and History screens (the count and order screens use lib/ordering-data.ts
 * directly). No React. Callers pass the Supabase client. Same rules as ordering-data.ts: one venue at a time, every INSERT
 * goes through insertRows (which strips null keys so a column default applies), a write that touches no row is a failure,
 * and a missing table reads as "Ordering is not set up yet".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./change-log";
import {
  ORDERING_UNAVAILABLE,
  OrderingError,
  T,
  updateCategory,
  updateProduct,
  updateSupplier,
} from "./ordering-data";
import type { CopyPlan } from "./ordering-setup";
import { insertRows, newId } from "./store";
import type { OrderingCountLine, OrderingCountSession, OrderingOrder, OrderingOrderLine } from "./ordering-types";

type DbError = { code?: string; message?: string } | null | undefined;

function fail(error: NonNullable<DbError>): never {
  if (isMissingTable(error)) throw new OrderingError(ORDERING_UNAVAILABLE, "missing_table");
  throw new OrderingError(error.message || "That did not save.", error.code);
}

const PAGE = 1000;
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

/* ------------------------------------------------------------------ the home screens */

export interface VenueSummary {
  venueId: number;
  /** active products */
  products: number;
  /** the newest finalised count */
  lastCount: OrderingCountSession | null;
  /** a count is in progress right now */
  countInProgress: boolean;
  /** orders made and not yet marked as sent */
  draftOrders: number;
}

/** The few numbers on a venue's card and home: cheap (two small queries and two head counts). */
export async function loadVenueSummary(sb: SupabaseClient, venueId: number): Promise<VenueSummary> {
  const [prod, sess, drafts] = await Promise.all([
    sb.from(T.products).select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("active", true),
    sb.from(T.sessions).select("*").eq("venue_id", venueId).neq("status", "cancelled").order("started_at", { ascending: false }).limit(10),
    sb.from(T.orders).select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("status", "draft"),
  ]);
  if (prod.error) fail(prod.error);
  if (sess.error) fail(sess.error);
  if (drafts.error) fail(drafts.error);
  const sessions = (sess.data ?? []) as OrderingCountSession[];
  return {
    venueId,
    products: prod.count ?? 0,
    lastCount: sessions.find((s) => s.status === "finalised") ?? null,
    countInProgress: sessions.some((s) => s.status === "in_progress"),
    draftOrders: drafts.count ?? 0,
  };
}

/** The summaries for several venues at once; one venue failing does not hide the others (its entry is the error). */
export async function loadVenueSummaries(sb: SupabaseClient, venueIds: readonly number[]): Promise<Map<number, VenueSummary | OrderingError>> {
  const out = new Map<number, VenueSummary | OrderingError>();
  await Promise.all(
    venueIds.map(async (id) => {
      try {
        out.set(id, await loadVenueSummary(sb, id));
      } catch (e) {
        out.set(id, e instanceof OrderingError ? e : new OrderingError(e instanceof Error ? e.message : String(e)));
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ reordering */

/** Writes new sort values (only the rows that changed). Every row must save or the call throws. */
export async function saveSortChanges(sb: SupabaseClient, table: "suppliers" | "categories" | "products", changes: readonly { id: string; sort: number }[]): Promise<void> {
  const write = table === "suppliers" ? updateSupplier : table === "categories" ? updateCategory : updateProduct;
  for (let i = 0; i < changes.length; i += 10) {
    await Promise.all(changes.slice(i, i + 10).map((c) => write(sb, c.id, { sort: c.sort })));
  }
}

/* ------------------------------------------------------------------ copy products from another venue */

export interface CopyResult {
  categories: number;
  suppliers: number;
  products: number;
}

/**
 * Adds what the plan says to the target venue: categories and suppliers first, then products pointing at them by name. Rows
 * the venue already has are matched by name, never duplicated, so a copy that stopped half way can simply be run again.
 * `existing` is the target venue's current categories and suppliers (to find ids for products whose category or supplier
 * already existed).
 */
export async function copyVenueSetup(
  sb: SupabaseClient,
  targetVenueId: number,
  plan: CopyPlan,
  existing: { categories: readonly { id: string; name: string }[]; suppliers: readonly { id: string; name: string }[] },
): Promise<CopyResult> {
  const key = (s: string) => s.trim().toLowerCase();
  const catId = new Map(existing.categories.map((c) => [key(c.name), c.id]));
  const supId = new Map(existing.suppliers.map((s) => [key(s.name), s.id]));

  if (plan.categories.length) {
    const rows = plan.categories.map((c) => ({ ...c, id: newId(), venue_id: targetVenueId }));
    const { error } = await insertRows(sb, T.categories, rows).select("id");
    if (error) fail(error);
    for (const r of rows) catId.set(key(r.name), r.id);
  }
  if (plan.suppliers.length) {
    const rows = plan.suppliers.map((s) => ({ ...s, id: newId(), venue_id: targetVenueId }));
    const { error } = await insertRows(sb, T.suppliers, rows).select("id");
    if (error) fail(error);
    for (const r of rows) supId.set(key(r.name), r.id);
  }
  let products = 0;
  for (let i = 0; i < plan.products.length; i += 100) {
    const rows = plan.products.slice(i, i + 100).map((p) => ({
      ...p.draft,
      id: newId(),
      venue_id: targetVenueId,
      category_id: catId.get(key(p.categoryName)),
      supplier_id: p.supplierName ? supId.get(key(p.supplierName)) ?? null : null,
    }));
    const { error } = await insertRows(sb, T.products, rows).select("id");
    if (error) fail(error);
    products += rows.length;
  }
  return { categories: plan.categories.length, suppliers: plan.suppliers.length, products };
}

/* ------------------------------------------------------------------ history */

/** A page of count sessions, newest first. `before` (an ISO start time) continues from the last one already loaded. */
export async function loadSessionsPage(sb: SupabaseClient, venueId: number, opts: { before?: string; limit?: number } = {}): Promise<OrderingCountSession[]> {
  let q = sb.from(T.sessions).select("*").eq("venue_id", venueId).neq("status", "cancelled");
  if (opts.before) q = q.lt("started_at", opts.before);
  const { data, error } = await q.order("started_at", { ascending: false }).limit(opts.limit ?? 12);
  if (error) fail(error);
  return (data ?? []) as OrderingCountSession[];
}

export async function loadSession(sb: SupabaseClient, venueId: number, sessionId: string): Promise<OrderingCountSession | null> {
  const { data, error } = await sb.from(T.sessions).select("*").eq("venue_id", venueId).eq("id", sessionId).limit(1);
  if (error) fail(error);
  return ((data ?? [])[0] as OrderingCountSession | undefined) ?? null;
}

/** The lines of several sessions (for the "42 of 118 counted" tallies). Only the columns the tally needs are read. */
export async function loadLinesForSessions(sb: SupabaseClient, sessionIds: readonly string[]): Promise<Pick<OrderingCountLine, "id" | "session_id" | "product_id" | "store_qty" | "second_qty">[]> {
  if (!sessionIds.length) return [];
  return pageAll((a, b) => sb.from(T.countLines).select("id,session_id,product_id,store_qty,second_qty").in("session_id", [...sessionIds]).order("id").range(a, b));
}

/** One product's order lines across the venue's orders, with the orders they belong to. */
export async function loadOrderHistoryForProduct(sb: SupabaseClient, venueId: number, productId: string): Promise<{ orders: OrderingOrder[]; lines: OrderingOrderLine[] }> {
  const { data, error } = await sb.from(T.orderLines).select("*").eq("venue_id", venueId).eq("product_id", productId).limit(500);
  if (error) fail(error);
  const lines = (data ?? []) as OrderingOrderLine[];
  const ids = Array.from(new Set(lines.map((l) => l.order_id)));
  if (!ids.length) return { orders: [], lines };
  const { data: o, error: e2 } = await sb.from(T.orders).select("*").eq("venue_id", venueId).in("id", ids);
  if (e2) fail(e2);
  return { orders: (o ?? []) as OrderingOrder[], lines };
}

/** Orders made from any of these counts (to tell a count with no order from a count whose order missed a product). */
export async function loadOrdersForSessions(sb: SupabaseClient, venueId: number, sessionIds: readonly string[]): Promise<OrderingOrder[]> {
  if (!sessionIds.length) return [];
  const { data, error } = await sb.from(T.orders).select("*").eq("venue_id", venueId).in("session_id", [...sessionIds]).limit(1000);
  if (error) fail(error);
  return (data ?? []) as OrderingOrder[];
}

