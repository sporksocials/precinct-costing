"use client";

/**
 * DEMO MODE ONLY (NEXT_PUBLIC_DEMO=1): an in-memory stand-in for the Supabase client used for visual QA.
 * Data is fetched from /api/demo-data (which 404s unless demo mode is on); mutations only touch memory.
 * Implements just the query-builder surface the app uses.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderingDemoTables } from "../ordering-fixture";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const TABLE_KEYS: Record<string, string> = {
  cost_venues: "venues",
  cost_settings: "rawSettings",
  cost_targets: "targets",
  cost_suppliers: "suppliers",
  cost_ingredients: "ingredients",
  cost_preps: "preps",
  cost_menu_items: "items",
  cost_recipe_lines: "lines",
  cost_price_log: "priceLogs",
  cost_specials: "specials",
  cost_allowed_users: "allowedUsers",
  cost_portal_prices: "portalPrices",
  cost_gelato_serves: "gelatoServes",
  cost_gelato_serve_lines: "gelatoServeLines",
  cost_beer_serves: "beerServes",
  cost_beers: "beers",
  cost_beer_prices: "beerPrices",
  cost_offers: "offers",
  cost_offer_lines: "offerLines",
  cost_ingredient_deals: "deals", // not in older demo data: empty
  cost_research_notes: "researchNotes", // not in older demo data: empty
  cost_bar_options: "barOptions", // not in older demo data: empty
  cost_ignored_alerts: "ignoredAlerts", // not in older demo data: empty
  cost_audit_log: "auditLog", // not in demo data: always empty
  cost_sell_price_log: "sellPriceLog", // not in demo data: always empty
  cost_change_history: "changeHistory", // not in demo data: filled in memory by logHistory below
  // Ordering (migration 20261005300000): not in the demo data files; seeded from lib/ordering-fixture.ts when empty (see loadTables)
  ordering_suppliers: "orderingSuppliers",
  ordering_categories: "orderingCategories",
  ordering_products: "orderingProducts",
  ordering_count_sessions: "orderingCountSessions",
  ordering_count_lines: "orderingCountLines",
  ordering_orders: "orderingOrders",
  ordering_order_lines: "orderingOrderLines",
  ordering_price_uploads: "orderingPriceUploads",
  ordering_price_log: "orderingPriceLog",
};

let tablesPromise: Promise<Tables> | null = null;
function loadTables(): Promise<Tables> {
  if (typeof window === "undefined") return new Promise<Tables>(() => {}); // never resolves on the server
  if (!tablesPromise) {
    tablesPromise = fetch("/api/demo-data")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`demo data: ${r.status}`))))
      .then((json: Record<string, Row[]>) => {
        const t: Tables = {};
        for (const [table, key] of Object.entries(TABLE_KEYS)) t[table] = json[key] ?? [];
        // Ordering example data (Drift and Greedy), only when the demo data has none: invented names and prices, memory only
        if (!(t.ordering_products ?? []).length) Object.assign(t, orderingDemoTables());
        return t;
      });
  }
  return tablesPromise;
}

/**
 * Dev-only fault injection for checking the data health banner (only ever read in demo mode):
 *   NEXT_PUBLIC_DEMO_FAULT=lines          the first load drops some recipe lines; the heal step fetches them (silent)
 *   NEXT_PUBLIC_DEMO_FAULT=lines-persist  recipe lines are always short (the red banner)
 *   NEXT_PUBLIC_DEMO_FAULT=rpc            the fingerprint function is "missing" (count fallback)
 *   NEXT_PUBLIC_DEMO_FAULT=blocked        every read returns nothing (row level security)
 */
const FAULT = process.env.NEXT_PUBLIC_DEMO_FAULT ?? "";
let faultUsed = false;

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

const DEMO_USER = "demo@precinct.local";
/** demo QA only: make reads of the edited record fail, like a dropped connection (see window.__demoOutside.failReads) */
let failReads = false;

/** Mimics the edit stamp triggers (migration 20261004230000): a change to a dish or prep, or to its recipe lines, stamps the dish or prep. */
function stampParents(tables: Tables, table: string, changed: Row[], by: string) {
  const at = new Date().toISOString();
  const touch = (t: string, ids: Set<unknown>) => {
    for (const r of tables[t] ?? []) if (ids.has(r.id)) Object.assign(r, { updated_at: at, updated_by: by });
  };
  if (table === "cost_menu_items" || table === "cost_preps") touch(table, new Set(changed.map((r) => r.id)));
  if (table === "cost_recipe_lines") {
    touch("cost_menu_items", new Set(changed.filter((r) => r.parent_type === "item").map((r) => r.parent_id)));
    touch("cost_preps", new Set(changed.filter((r) => r.parent_type === "prep").map((r) => r.parent_id)));
  }
}

/**
 * DEMO ONLY: mimics the cost_history_log() trigger (migration 20261004240000) for the tracked tables, so the Change Log can be
 * checked without a database. Bookkeeping columns never count; an update that changes only those writes nothing.
 */
const HISTORY_KEYS: Record<string, { key: string; parent?: [string, string]; guard?: (tables: Tables, row: Row) => boolean }> = {
  cost_menu_items: { key: "id" }, cost_preps: { key: "id" }, cost_recipe_lines: { key: "id" }, cost_ingredients: { key: "id" },
  cost_beers: { key: "id" }, cost_beer_serves: { key: "id" }, cost_beer_prices: { key: "id", parent: ["cost_beers", "beer_id"] },
  cost_gelato_serves: { key: "id" }, cost_gelato_serve_lines: { key: "id", parent: ["cost_gelato_serves", "serve_id"] },
  cost_offers: { key: "id" }, cost_offer_lines: { key: "id", parent: ["cost_offers", "offer_id"] }, cost_ingredient_deals: { key: "id" },
  cost_suppliers: { key: "id" }, cost_specials: { key: "id" }, cost_targets: { key: "venue_id,category" }, cost_settings: { key: "key" },
  cost_bar_options: { key: "id" }, cost_allowed_users: { key: "email" },
  // Ordering: order lines and the price log are not tracked; count lines only once their session is finalised (see the migration)
  ordering_suppliers: { key: "id" }, ordering_categories: { key: "id" }, ordering_products: { key: "id" }, ordering_count_sessions: { key: "id" },
  ordering_count_lines: { key: "id", parent: ["ordering_count_sessions", "session_id"], guard: (t, r) => (t.ordering_count_sessions ?? []).some((x) => x.id === r.session_id && x.status === "finalised") },
  ordering_orders: { key: "id" }, ordering_price_uploads: { key: "id" },
};
/** Tables whose live created_at column defaults to now() (cost_suppliers has none). */
const HAS_CREATED_AT = new Set(["cost_menu_items", "cost_preps", "cost_ingredients", "cost_beers", "cost_beer_serves", "cost_gelato_serves", "cost_offers", "cost_ingredient_deals", "cost_specials"]);
const BOOKKEEPING = new Set(["updated_at", "updated_by", "created_at", "sort"]);
/** One transaction id per statement (like txid_current()), so rows written by one delete share it. */
let lastTx = 0;
function nextTx(): number {
  lastTx = Math.max(lastTx + 1, Date.now() * 1000);
  return lastTx;
}
/** An error that carries a Postgres code (the real client's errors do), e.g. 23505 for a unique clash. */
class DemoError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}
/** Unique indexes on the restorable tables (live database): a clash is refused with 23505. */
const UNIQUE_KEYS: Record<string, string[]> = { cost_menu_items: ["name", "venue_id"], cost_preps: ["name", "venue_id"], cost_beers: ["venue_id", "name"], cost_gelato_serves: ["venue_id", "name"], cost_beer_prices: ["beer_id", "serve_id"],
  ordering_suppliers: ["venue_id", "name"], ordering_categories: ["venue_id", "name"], ordering_products: ["venue_id", "category_id", "name"], ordering_count_lines: ["session_id", "product_id"] };
/** ON DELETE CASCADE children (delete rows are logged before the parent's, in the same transaction, like the live triggers). */
const CASCADES: Record<string, { table: string; fk: string }[]> = {
  cost_beers: [{ table: "cost_beer_prices", fk: "beer_id" }],
  cost_gelato_serves: [{ table: "cost_gelato_serve_lines", fk: "serve_id" }],
  cost_offers: [{ table: "cost_offer_lines", fk: "offer_id" }],
  ordering_count_sessions: [{ table: "ordering_count_lines", fk: "session_id" }],
  ordering_orders: [{ table: "ordering_order_lines", fk: "order_id" }],
};

/**
 * DEMO ONLY: what the live ordering_* tables do on write, so screens can be checked without a database: the column defaults
 * and nulls for omitted keys (callers strip null keys, so the database fills them), a uuid id, created_at, and the edit stamps
 * (cost_stamp_edit: updated_at and updated_by on insert and update).
 */
const ORDERING_DEFAULTS: Record<string, () => Row> = {
  ordering_suppliers: () => ({ method: "email", email_to: null, login_url: null, rep_name: null, rep_phone: null, account_no: null, min_order_value: null, min_order_units: null, show_prices_on_order: false, notes: null, active: true, sort: 0 }),
  ordering_categories: () => ({ sort: 0, second_location_label: null, unit_name: "carton" }),
  ordering_products: () => ({ sort: 0, supplier_id: null, supplier_item_code: null, pack_multiple: 1, price_inc_gst: null, ingredient_id: null, costing_packs_per_unit: null, par: 0, notes: null, active: true }),
  ordering_count_sessions: () => ({ started_by: null, started_at: new Date().toISOString(), status: "in_progress", finalised_by: null, finalised_at: null, note: null, source: null }),
  ordering_count_lines: () => ({ store_qty: null, second_qty: null, counted_by: null, counted_at: null, client_uuid: null, product_name: null, par_at_count: null, unit_name: null }),
  ordering_orders: () => ({ session_id: null, status: "draft", kind: "count", sent_by: null, sent_at: null, method: null, subject: null, body_text: null, warning_text: null, show_prices: false }),
  ordering_order_lines: () => ({ product_id: null, supplier_item_code: null, unit_name: null, suggested_qty: null, pack_multiple: null, price_inc_gst: null, sort: 0 }),
  ordering_price_uploads: () => ({ supplier_id: null, uploaded_by: null, uploaded_at: new Date().toISOString(), rows_matched: 0, rows_changed: 0, rows_unmatched: 0, updated_costing: false }),
  ordering_price_log: () => ({ old_price: null, new_price: null, upload_id: null, changed_by: null, changed_at: new Date().toISOString() }),
};
const ORDERING_STAMPED = new Set(["ordering_suppliers", "ordering_categories", "ordering_products", "ordering_count_sessions", "ordering_count_lines", "ordering_orders", "ordering_order_lines", "ordering_price_uploads"]);
function newUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === "x" ? 0 : 8)).toString(16));
}
function orderingNewRow(table: string, r: Row): Row {
  const now = new Date().toISOString();
  const row: Row = { id: newUuid(), ...(ORDERING_DEFAULTS[table]?.() ?? {}), ...r };
  if (ORDERING_STAMPED.has(table)) Object.assign(row, { created_at: row.created_at ?? now, updated_at: now, updated_by: DEMO_USER });
  return row;
}
function orderingStamp(table: string, row: Row): Row {
  return ORDERING_STAMPED.has(table) ? { ...row, updated_at: new Date().toISOString(), updated_by: DEMO_USER } : row;
}
/** The two ordering rules the unique constraints cannot show by column list: one count in progress per venue, and a unique client_uuid. */
function orderingChecks(table: string, row: Row, rows: Row[]) {
  if (table === "ordering_count_sessions" && row.status === "in_progress" && rows.some((x) => x.id !== row.id && x.venue_id === row.venue_id && x.status === "in_progress")) {
    throw new DemoError('duplicate key value violates unique constraint "ordering_count_sessions_one_open_idx"', "23505");
  }
  if (table === "ordering_count_lines" && row.client_uuid != null && rows.some((x) => x.id !== row.id && x.client_uuid === row.client_uuid)) {
    throw new DemoError('duplicate key value violates unique constraint "ordering_count_lines_client_uuid_key"', "23505");
  }
}
function logHistory(tables: Tables, table: string, op: "insert" | "update" | "delete", before: Row | null, after: Row | null, tx: number = nextTx()) {
  const spec = HISTORY_KEYS[table];
  if (!spec) return;
  if (spec.guard && !spec.guard(tables, (before ?? after) as Row)) return;
  const old = before ? (JSON.parse(JSON.stringify(before)) as Row) : null;
  const next = after ? (JSON.parse(JSON.stringify(after)) as Row) : null;
  const r = (next ?? old) as Row;
  let changed: string[] = [];
  if (op === "update" && old && next) {
    changed = Object.keys(next).filter((k) => !BOOKKEEPING.has(k) && JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null)).sort();
    if (!changed.length) return;
  }
  let pt: string | null = null;
  let pid: string | null = null;
  if (table === "cost_recipe_lines") {
    pt = r.parent_type === "item" ? "cost_menu_items" : r.parent_type === "prep" ? "cost_preps" : null;
    pid = pt ? String(r.parent_id) : null;
  } else if (spec.parent) {
    pt = spec.parent[0];
    pid = String(r[spec.parent[1]]);
  }
  const log = (tables.cost_change_history ??= []);
  log.push({
    id: Math.max(0, ...log.map((l) => Number(l.id) || 0)) + 1,
    tx_id: tx,
    table_name: table,
    row_key: spec.key.split(",").map((c) => String(r[c.trim()] ?? "")).join("|"),
    op,
    old_row: old,
    new_row: next,
    changed_fields: changed,
    parent_table: pt,
    parent_id: pid,
    changed_by: DEMO_USER,
    changed_at: new Date().toISOString(),
  });
}

type Filter = (r: Row) => boolean;
type Op = "select" | "insert" | "update" | "delete" | "upsert";

class DemoQuery implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean }[] = [];
  private rangeFrom = 0;
  private rangeTo = Infinity;
  private op: Op = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private conflict: string[] = ["id"];
  private head = false;
  private wantCount = false;

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.head) this.head = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }): this {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    if (opts?.onConflict) this.conflict = opts.onConflict.split(",").map((s) => s.trim());
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown): this {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown): this {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]): this {
    const s = new Set(vs);
    this.filters.push((r) => s.has(r[col]));
    return this;
  }
  lt(col: string, v: unknown): this {
    this.filters.push((r) => String(r[col] ?? "") < String(v));
    return this;
  }
  gte(col: string, v: unknown): this {
    this.filters.push((r) => String(r[col] ?? "") >= String(v));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  limit(n: number): this {
    this.rangeFrom = 0;
    this.rangeTo = n - 1;
    return this;
  }

  private async run(): Promise<{ data: Row[] | null; error: { message: string } | null }> {
    const tables = await loadTables();
    const rows = (tables[this.table] ??= []);
    if (failReads && this.op === "select" && (this.table === "cost_menu_items" || this.table === "cost_preps") && this.filters.length) throw new Error("Failed to fetch");
    const match = (r: Row) => this.filters.every((f) => f(r));
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    switch (this.op) {
      case "select": {
        let out = rows.filter(match);
        if (FAULT === "blocked") out = [];
        if (this.head) return { data: null, error: null, count: out.length } as never;
        if (this.orderBy.length) {
          out = [...out].sort((a, b) => {
            for (const { col, asc } of this.orderBy) {
              const x = a[col] as string | number;
              const y = b[col] as string | number;
              const c = x == null ? -1 : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0;
              if (c !== 0) return asc ? c : -c;
            }
            return 0;
          });
        }
        let page = out.slice(this.rangeFrom, this.rangeTo + 1);
        if (this.table === "cost_recipe_lines" && this.rangeFrom === 0 && (FAULT === "lines-persist" || (FAULT === "lines" && !faultUsed))) {
          if (FAULT === "lines") faultUsed = true;
          page = page.filter((_, i) => i % 30 !== 7); // silently lose ~3% of the rows, like the paging bug did
        }
        return { data: clone(page), error: null };
      }
      case "insert": {
        const added = this.payload.map((r) => {
          const row: Row = ORDERING_DEFAULTS[this.table] ? orderingNewRow(this.table, r) : { ...r };
          if (HAS_CREATED_AT.has(this.table) && row.created_at == null) row.created_at = new Date().toISOString(); // the live column default
          if (row.id == null) row.id = Math.max(0, ...rows.map((x) => Number(x.id) || 0)) + 1;
          if (rows.some((x) => x.id === row.id)) throw new DemoError(`duplicate key value violates unique constraint "${this.table}_pkey"`, "23505");
          const uk = UNIQUE_KEYS[this.table];
          if (uk && uk.every((c) => row[c] != null) && rows.some((x) => uk.every((c) => x[c] === row[c]))) {
            throw new DemoError(`duplicate key value violates unique constraint "${this.table}_${uk.join("_")}_key"`, "23505");
          }
          orderingChecks(this.table, row, rows);
          if (this.table === "cost_ingredients" && rows.some((x) => String(x.name).toLowerCase() === String(row.name).toLowerCase())) {
            throw new Error(`duplicate key value violates unique constraint "cost_ingredients_name_key"`);
          }
          if (this.table === "cost_bar_options" && rows.some((x) => x.kind === row.kind && x.name === row.name)) {
            throw new Error(`duplicate key value violates unique constraint "cost_bar_options_kind_name_key"`);
          }
          return row;
        });
        rows.push(...added);
        for (const a of added) logHistory(tables, this.table, "insert", null, a);
        stampParents(tables, this.table, added, DEMO_USER);
        return { data: clone(added), error: null };
      }
      case "upsert": {
        const stored: Row[] = [];
        for (const r of this.payload) {
          const i = rows.findIndex((x) => this.conflict.every((c) => x[c] === r[c]));
          if (i >= 0) {
            const before = rows[i];
            const next = orderingStamp(this.table, { ...rows[i], ...r });
            orderingChecks(this.table, next, rows);
            rows[i] = next;
            stored.push(next);
            logHistory(tables, this.table, "update", before, rows[i]);
          } else {
            const fresh: Row = ORDERING_DEFAULTS[this.table] ? orderingNewRow(this.table, r) : { ...r };
            if (HAS_CREATED_AT.has(this.table) && fresh.created_at == null) fresh.created_at = new Date().toISOString();
            orderingChecks(this.table, fresh, rows);
            const uk = UNIQUE_KEYS[this.table];
            if (uk && uk.every((c) => fresh[c] != null) && rows.some((x) => uk.every((c) => x[c] === fresh[c]))) {
              throw new DemoError(`duplicate key value violates unique constraint "${this.table}_${uk.join("_")}_key"`, "23505");
            }
            rows.push(fresh);
            stored.push(fresh);
            logHistory(tables, this.table, "insert", null, fresh);
          }
        }
        stampParents(tables, this.table, this.payload, DEMO_USER);
        // the live database returns the stored rows (with their ids and defaults); the older tables keep returning the payload
        return { data: clone(ORDERING_DEFAULTS[this.table] ? stored : this.payload), error: null };
      }
      case "update": {
        const out: Row[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (!match(rows[i])) continue;
          const before = rows[i];
          const next: Row = { ...before, ...this.patch };
          // mimic the price-log trigger on cost_ingredients
          if (this.table === "cost_ingredients" && "pack_price" in this.patch && this.patch.pack_price !== before.pack_price) {
            next.previous_price = before.pack_price;
            next.last_price_update = new Date().toISOString().slice(0, 10);
            const logs = (tables.cost_price_log ??= []);
            logs.push({
              id: Math.max(0, ...logs.map((l) => Number(l.id) || 0)) + 1,
              ingredient_id: before.id,
              changed_at: new Date().toISOString(),
              old_price: before.pack_price,
              new_price: next.pack_price,
              source: next.source ?? null,
              entered_by: "demo@precinct.local",
              notes: null,
            });
          }
          const stamped = orderingStamp(this.table, next);
          orderingChecks(this.table, stamped, rows);
          rows[i] = stamped;
          logHistory(tables, this.table, "update", before, stamped);
          out.push(stamped);
        }
        stampParents(tables, this.table, out, DEMO_USER);
        return { data: clone(out), error: null };
      }
      case "delete": {
        const keep = rows.filter((r) => !match(r));
        const gone = rows.filter(match);
        tables[this.table] = keep;
        const tx = nextTx(); // every row this statement deletes shares one transaction id
        for (const c of CASCADES[this.table] ?? []) {
          const ids = new Set(gone.map((g) => g.id));
          const kids = (tables[c.table] ??= []).filter((k) => ids.has(k[c.fk]));
          tables[c.table] = tables[c.table].filter((k) => !ids.has(k[c.fk]));
          for (const k of kids) logHistory(tables, c.table, "delete", k, null, tx);
        }
        if (this.table === "cost_menu_items") {
          const ids = new Set(gone.map((g) => g.id));
          if (tables.cost_research_notes) tables.cost_research_notes = tables.cost_research_notes.filter((n) => !ids.has(n.item_id)); // cascades; not tracked in history
        }
        for (const g of gone) logHistory(tables, this.table, "delete", g, null, tx);
        stampParents(tables, this.table, gone, DEMO_USER);
        return { data: clone(gone), error: null };
      }
    }
  }

  then<A = { data: Row[] | null; error: { message: string } | null }, B = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.run()
      .catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e), ...(e instanceof DemoError && e.code ? { code: e.code } : {}) } }))
      .then(onfulfilled, onrejected);
  }
}

export function createDemoClient(): SupabaseClient {
  const user = { email: "demo@precinct.local" };
  const client = {
    from: (table: string) => new DemoQuery(table),
    rpc: async (name: string, args?: { p_since?: string }) => {
      if (name !== "cost_data_fingerprint" || FAULT === "rpc") return { data: null, error: { code: "42883", message: "function does not exist" } };
      const t = await loadTables();
      const out: Record<string, unknown> = { generated_at: new Date().toISOString() };
      for (const [table, rows] of Object.entries(t)) {
        const inWindow = table === "cost_price_log" && args?.p_since ? rows.filter((r) => String(r.changed_at ?? "") >= args.p_since!) : rows;
        const shown = FAULT === "blocked" ? [] : inWindow;
        out[table] = { count: shown.length, hash: djb2(JSON.stringify(shown)) };
      }
      return { data: out, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithOtp: async () => ({ data: {}, error: null }),
    },
  };
  // DEMO ONLY, for checking the editor's three-way save check: change the demo database "as someone else" behind the page's back
  if (typeof window !== "undefined") {
    const w = window as unknown as { __demoOutside?: Record<string, unknown> };
    const OTHER = "brendan@precinct.local";
    w.__demoOutside = {
      /** a field change on a dish or prep, stamped as Brendan */
      editRow: async (table: string, id: string, patch: Row) => {
        const t = await loadTables();
        const r = (t[table] ?? []).find((x) => x.id === id);
        if (!r) throw new Error("no such row");
        Object.assign(r, patch, { updated_at: new Date().toISOString(), updated_by: OTHER });
      },
      addLine: async (line: Row) => {
        const t = await loadTables();
        (t.cost_recipe_lines ??= []).push(line);
        stampParents(t, "cost_recipe_lines", [line], OTHER);
      },
      editLine: async (lineId: string, patch: Row) => {
        const t = await loadTables();
        const r = (t.cost_recipe_lines ?? []).find((x) => x.id === lineId);
        if (!r) throw new Error("no such line");
        Object.assign(r, patch);
        stampParents(t, "cost_recipe_lines", [r], OTHER);
      },
      removeLine: async (lineId: string) => {
        const t = await loadTables();
        const r = (t.cost_recipe_lines ?? []).find((x) => x.id === lineId);
        if (!r) throw new Error("no such line");
        t.cost_recipe_lines = t.cost_recipe_lines.filter((x) => x.id !== lineId);
        stampParents(t, "cost_recipe_lines", [r], OTHER);
      },
      failReads: (on: boolean) => {
        failReads = on;
      },
      /** what the database holds for one row (for assertions) */
      peek: async (table: string, id: string) => {
        const t = await loadTables();
        return JSON.parse(JSON.stringify((t[table] ?? []).find((x) => x.id === id) ?? null));
      },
      peekLines: async (parentId: string) => {
        const t = await loadTables();
        return JSON.parse(JSON.stringify((t.cost_recipe_lines ?? []).filter((x) => x.parent_id === parentId)));
      },
    };
  }
  // make the demo user an allowed user (browser only — nothing to load during server prerender)
  if (typeof window !== "undefined")
    void loadTables().then((t) => {
    const au = (t.cost_allowed_users ??= []);
    if (!au.some((u) => u.email === user.email)) au.push({ email: user.email });
  });
  return client as unknown as SupabaseClient;
}
