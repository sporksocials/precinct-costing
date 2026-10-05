/**
 * Ordering > Count screen: the pure helpers (no React, no browser, no database). The screen keeps its logic here so it can be
 * tested: what a row shows, what a tap does, what the header says, which rows a filter keeps, what the review sheet lists.
 * See components/ordering/count/ for the screen and lib/ordering-count-device.ts for the device storage.
 *
 * The three states of one counting place (Store, or the category's second place):
 *   untouched  null     shown as a dash, not counted
 *   zero       0        counted as none (a deliberate act: Zero, minus from 1, or typing 0)
 *   counted    1, 2...  counted
 * "None" must never look like "forgotten": a zero is only ever written by a person.
 */
import { countProgress, isCounted } from "./ordering";
import type { CountEdit, CountProgress, OrderingCategory, OrderingCountSession, OrderingProduct } from "./ordering-types";

/* ------------------------------------------------------------------ quantities */

/** The biggest number a place can hold (a typo guard: nobody has 10,000 cartons of anything). */
export const MAX_QTY = 9999;

export type PlaceState = "untouched" | "zero" | "counted";

export function placeState(qty: number | null | undefined): PlaceState {
  if (qty == null || !Number.isFinite(Number(qty))) return "untouched";
  return Number(qty) === 0 ? "zero" : "counted";
}

/** Digits only, at most four of them: what a typed number box keeps from whatever was typed or pasted (whole units only). */
export function sanitiseQtyText(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 4);
}

/** A typed number: empty is "clear it" (null, back to not counted), digits are the number, anything else is refused (undefined). */
export function parseQtyText(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d{1,4}$/.test(t)) return undefined;
  return Math.min(MAX_QTY, Number(t));
}

/** Plus: not counted becomes 1, otherwise one more (capped). Minus: one fewer, never below 0; not counted stays not counted (Zero is its own button). */
export function stepQty(current: number | null | undefined, dir: 1 | -1): number | null {
  const state = placeState(current);
  if (dir === 1) return state === "untouched" ? 1 : Math.min(MAX_QTY, Number(current) + 1);
  if (state === "untouched") return null;
  return Math.max(0, Number(current) - 1);
}

/** What a number box shows: "" for not counted (the box then shows a dash placeholder), else the number. */
export function qtyBoxText(qty: number | null | undefined): string {
  return placeState(qty) === "untouched" ? "" : String(Number(qty));
}

/* ------------------------------------------------------------------ units and labels */

/** "carton" gives "Cartons", "keg" gives "Kegs", "box" gives "Boxes". An empty unit reads "Units". */
export function unitPlural(unit: string | null | undefined): string {
  const u = (unit ?? "").trim().toLowerCase();
  const base = !u ? "unit" : u.endsWith("s") && u.length > 3 ? u.slice(0, -1) : u === "ctn" ? "carton" : u;
  const plural = /(s|x|ch|sh)$/.test(base) ? `${base}es` : `${base}s`;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

/** "Cartons, Build To 8" (the small grey line under a product's name). */
export function productSubline(p: Pick<OrderingProduct, "unit_name" | "par">): string {
  return `${unitPlural(p.unit_name)}, Build To ${p.par}`;
}

/** The name of the first place: always "Store". */
export const STORE_LABEL = "Store";

/* ------------------------------------------------------------------ rows */

export interface RowQty {
  store: number | null;
  second: number | null;
}

export type RowState = "uncounted" | "counted";
export interface RowStatus {
  state: RowState;
  /** store + second where either was counted (a blank place counts as 0 once the product was counted at all); null when uncounted */
  total: number | null;
  /** a two-place product with only one place counted: the label of the place still blank ("Coldroom"), else null */
  blank: string | null;
}

/** What a row says about itself. Uncounted means neither place was touched. */
export function rowStatus(qty: RowQty | undefined, secondLabel: string | null): RowStatus {
  const store = qty?.store ?? null;
  const second = qty?.second ?? null;
  if (store == null && second == null) return { state: "uncounted", total: null, blank: null };
  const blank = secondLabel ? (store == null ? STORE_LABEL : second == null ? secondLabel : null) : null;
  return { state: "counted", total: (store ?? 0) + (second ?? 0), blank };
}

/* ------------------------------------------------------------------ progress and the header */

export function progressText(counted: number, total: number): string {
  return `${counted} of ${total} counted`;
}

/** 0 to 100, whole percent; an empty venue is 0. */
export function progressPercent(counted: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((counted / total) * 100))) : 0;
}

export type SyncKind = "saved" | "saving" | "offline" | "retrying";
export interface SyncStatus {
  kind: SyncKind;
  text: string;
}

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

/**
 * The status in the header. Always words (and an icon on screen), never colour alone.
 *   Saved                                  nothing waiting, nothing in flight
 *   Saving...                              a sync is running, or one is about to start
 *   Offline: N changes waiting to sync     no connection (the taps are safe on this device)
 *   Offline: saved on this device          no connection and nothing waiting
 *   Not synced yet: N changes. Retrying    online, but the last try failed
 */
export function syncStatus(s: { online: boolean; pending: number; syncing: boolean; failed: boolean }): SyncStatus {
  if (!s.online) return s.pending > 0 ? { kind: "offline", text: `Offline: ${changes(s.pending)} waiting to sync` } : { kind: "offline", text: "Offline: saved on this device" };
  if (s.pending === 0 && !s.syncing) return { kind: "saved", text: "Saved" };
  if (s.failed && !s.syncing) return { kind: "retrying", text: `Not synced yet: ${changes(s.pending)}. Retrying` };
  return { kind: "saving", text: "Saving..." };
}

/** Seconds to wait before the next sync try after `attempt` failures: 4, 8, 16, then every 30. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 4_000 * 2 ** Math.max(0, attempt));
}

/** Finalise waits for the device's queued changes to reach the database, and needs a connection. */
export function finaliseBlock(s: { online: boolean; pending: number; syncing: boolean }): string | null {
  if (!s.online) return "You are offline. Your counts are safe on this device. Finalise once you are back online.";
  if (s.pending > 0 || s.syncing) return `${changes(Math.max(1, s.pending))} still saving. Finalise once they have synced.`;
  return null;
}

/* ------------------------------------------------------------------ the list: groups, filters, jump targets */

export interface CountGroup {
  category: OrderingCategory;
  products: OrderingProduct[];
}

export interface CountFilter {
  query: string;
  uncountedOnly: boolean;
  /** products touched since the Show Uncounted switch went on: kept on screen so a row does not vanish under the finger that just counted it */
  pinned: ReadonlySet<string>;
}

export const normaliseQuery = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ");

/** Which rows the filters keep. Search matches the product name; Show Uncounted keeps rows with nothing counted plus the pinned ones. */
export function filterGroups(groups: readonly CountGroup[], qty: ReadonlyMap<string, RowQty>, f: CountFilter): CountGroup[] {
  const q = normaliseQuery(f.query);
  return groups
    .map((g) => ({
      category: g.category,
      products: g.products.filter((p) => {
        if (q && !p.name.toLowerCase().includes(q)) return false;
        if (f.uncountedOnly && !f.pinned.has(p.id)) {
          const r = qty.get(p.id);
          if (r && (r.store != null || r.second != null)) return false;
        }
        return true;
      }),
    }))
    .filter((g) => g.products.length > 0);
}

export interface CategoryJump {
  id: string;
  name: string;
  counted: number;
  total: number;
}

/** The jump chips: every category (all products, not the filtered ones) with how many of its products are counted. */
export function categoryJumps(groups: readonly CountGroup[], qty: ReadonlyMap<string, RowQty>): CategoryJump[] {
  return groups.map((g) => ({
    id: g.category.id,
    name: g.category.name,
    total: g.products.length,
    counted: g.products.filter((p) => {
      const r = qty.get(p.id);
      return !!r && (r.store != null || r.second != null);
    }).length,
  }));
}

/** Element ids the screen scrolls to. */
export const categoryAnchor = (categoryId: string): string => `count-cat-${categoryId}`;
export const rowAnchor = (productId: string): string => `count-row-${productId}`;

/**
 * Scroll spy: the category the person is looking at. `tops` are the sections' distances from the top of the viewport in list
 * order; the current one is the last whose top has reached `line` (just under the sticky header). Before the first, the first.
 */
export function activeCategory(tops: readonly { id: string; top: number }[], line: number): string | null {
  if (!tops.length) return null;
  let current = tops[0].id;
  for (const t of tops) if (t.top <= line + 1) current = t.id;
  return current;
}

/* ------------------------------------------------------------------ the review sheet */

export interface ReviewRow {
  product: OrderingProduct;
  categoryName: string;
}
export interface ReviewLists {
  counted: number;
  total: number;
  uncounted: ReviewRow[];
  overPar: (ReviewRow & { counted: number; over: number })[];
  partial: (ReviewRow & { missing: string })[];
}

/** What Finish Count shows: what is not counted yet (in shelf order), what is over Build To, and two-place products with one place blank. */
export function reviewLists(products: readonly OrderingProduct[], categories: readonly OrderingCategory[], qty: ReadonlyMap<string, RowQty>): ReviewLists {
  const lines = [...qty.entries()].map(([product_id, r]) => ({ product_id, store_qty: r.store, second_qty: r.second }));
  const progress: CountProgress = countProgress(products, lines, categories);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const secondLabel = new Map(categories.map((c) => [c.id, c.second_location_label]));
  const row = (product: OrderingProduct): ReviewRow => ({ product, categoryName: catName.get(product.category_id) ?? "" });
  const shelf = new Map(categories.map((c, i) => [c.id, i]));
  const byShelf = (a: ReviewRow, b: ReviewRow) => (shelf.get(a.product.category_id) ?? 1e9) - (shelf.get(b.product.category_id) ?? 1e9) || a.product.sort - b.product.sort || a.product.name.localeCompare(b.product.name);
  return {
    counted: progress.counted,
    total: progress.total,
    uncounted: progress.uncounted.map(row).sort(byShelf),
    overPar: progress.overPar.map((o) => ({ ...row(o.product), counted: o.counted, over: o.over })).sort(byShelf),
    partial: progress.partial.map((x) => ({ ...row(x.product), missing: x.missing === "store" ? STORE_LABEL : secondLabel.get(x.product.category_id) ?? "Second place" })).sort(byShelf),
  };
}

/** True when every active product has a count (nothing left on the Not Counted list). */
export function allCounted(l: Pick<ReviewLists, "uncounted">): boolean {
  return l.uncounted.length === 0;
}

/* ------------------------------------------------------------------ the device queue */

/**
 * Adds one tap to the queue. A tap on the same product as the newest waiting edit (and that edit is not already on its way to
 * the database) folds into it, so a person tapping + ten times leaves one queued edit rather than ten. The folded edit gets a
 * NEW client_uuid: if the old one had in fact reached the database (a reply lost on patchy wifi), the same uuid would make the
 * server read the newer value as "already saved" and drop it.
 */
export function coalesceEdit(queue: readonly CountEdit[], edit: CountEdit, inFlight: ReadonlySet<string>, newUuid: () => string): CountEdit[] {
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    if (q.session_id !== edit.session_id || q.product_id !== edit.product_id) continue;
    if (inFlight.has(q.client_uuid)) break;
    const merged: CountEdit = {
      ...q,
      ...edit,
      client_uuid: newUuid(),
      store_qty: edit.store_qty !== undefined ? edit.store_qty : q.store_qty,
      second_qty: edit.second_qty !== undefined ? edit.second_qty : q.second_qty,
    };
    return [...queue.slice(0, i), ...queue.slice(i + 1), merged];
  }
  return [...queue, edit];
}

/** The distinct sessions the queue holds edits for (the sync sends each to its own session). */
export function queueSessions(queue: readonly CountEdit[]): string[] {
  return [...new Set(queue.map((e) => e.session_id))];
}

/* ------------------------------------------------------------------ the offline copy */

/** What the screen keeps on the device so it opens with no signal. */
export interface CountCache {
  v: 1;
  /** whose device copy this is: it is only ever shown to the same signed-in person */
  email: string;
  venueId: number;
  savedAt: string;
  categories: OrderingCategory[];
  products: OrderingProduct[];
  /** newest first */
  sessions: OrderingCountSession[];
  /** the session being counted or viewed when saved (null before one was opened) */
  sessionId: string | null;
  /** that session's count lines as the database last held them */
  lines: import("./ordering-types").OrderingCountLine[];
}

/** A device copy may be shown only to the person it was saved for, for the same venue. Anything else is stale or someone else's. */
export function cacheUsable(cache: CountCache | null | undefined, email: string | null | undefined, venueId: number): cache is CountCache {
  if (!cache || cache.v !== 1 || !email) return false;
  return cache.venueId === venueId && cache.email.toLowerCase() === email.toLowerCase() && Array.isArray(cache.products) && Array.isArray(cache.categories);
}

/* ------------------------------------------------------------------ dates for the screen */

const dayTime = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** "Mon, 5 Oct, 9:12 am" in Brisbane time. */
export function whenText(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? dayTime.format(new Date(t)).replace(/\s?(am|pm)$/i, (_m, ap: string) => ` ${ap.toLowerCase()}`) : "";
}

/** The session in view: the open one, else the latest finalised one. */
export function openOrLast(sessions: readonly OrderingCountSession[]): { open: OrderingCountSession | null; last: OrderingCountSession | null } {
  const open = sessions.find((s) => s.status === "in_progress") ?? null;
  const last = [...sessions].filter((s) => s.status === "finalised").sort((a, b) => Date.parse(b.finalised_at ?? b.started_at) - Date.parse(a.finalised_at ?? a.started_at))[0] ?? null;
  return { open, last };
}

export { isCounted };
