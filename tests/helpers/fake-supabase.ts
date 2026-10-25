/**
 * A small, honest in-memory stand-in for the Supabase client, for the invoice modules' tests.
 * Supports from().select / insert / update / delete / upsert, eq / neq / in / is / gt / gte / lt / lte, order, limit, range,
 * single / maybeSingle, and select-after-write. It behaves like PostgREST where it matters here:
 *  - a read returns at most `maxRows` (1000) rows, so code that forgets to page loses rows in the test too;
 *  - a write with no .select() returns data null; a write whose filters match nothing succeeds with zero rows (so an `.eq`
 *    guard on an update shows up as an empty result, never an error);
 *  - insert fills the table's defaults, a missing id, and rejects a duplicate on a configured unique key (code 23505);
 *  - serial tables (cost_price_log, ai_usage_log) get numeric ids, everything else a string id.
 * Not modelled: joins, RLS, transactions, foreign keys, cascade deletes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, any>;
type Filter = { col: string; op: "eq" | "neq" | "in" | "is" | "gt" | "gte" | "lt" | "lte" | "notnull" | "notin"; val: any };
export interface LoggedOp { table: string; op: "select" | "insert" | "update" | "delete" | "upsert"; payload?: any; filters: Filter[]; rows: number }
type UpdateHook = (before: Row, after: Row) => void;

const SERIAL_TABLES = new Set(["cost_price_log", "ai_usage_log"]);

/** Server-side defaults for the columns the tests rely on (mirrors supabase/migrations/20261024100000_invoices.sql). */
const DEFAULTS: Record<string, () => Row> = {
  invoice_lines: () => ({ fee_share_ex: 0, state: "open", decision: "none", match_state: "unmatched", line_class: "product", gst: "unknown", description: "" }),
  invoice_questions: () => ({ status: "open", options: [], answer: null, answered_by: null, answered_at: null }),
  invoice_price_changes: () => ({ status: "applied" }),
  invoice_documents: () => ({ status: "needs_review", mode: "learning", venue_check: "unknown", reconciled: false, recon_notes: [], fee_pool_ex: 0, pages: [] }),
  invoice_suppliers: () => ({ aliases: [], allocation_basis: "value", auto_apply: false, active: true }),
  invoice_item_map: () => ({ rejected: false }), // packs_per_unit is nullable with no default: null = nobody stated it
  invoice_files: () => ({ status: "received", attempts: 0 }),
};

export interface FakeSupabase {
  sb: SupabaseClient;
  db: Record<string, Row[]>;
  log: LoggedOp[];
  /** make the next matching write fail with this message (once) */
  failNext(table: string, op: LoggedOp["op"], message?: string): void;
  /** run on every update of a table, before the row is stored (a trigger) */
  onUpdate(table: string, hook: UpdateHook): void;
  /** unique keys per table: an insert or update that repeats the key fails with code 23505 */
  unique(table: string, cols: string[], applies?: (row: Row) => boolean): void;
  /** mimics cost_log_price(): a pack_price change logs a cost_price_log row, sets previous_price and last_price_update to `today` */
  installIngredientPriceTrigger(today: string): void;
  maxRows: number;
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeSupabase {
  const db: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) db[t] = rows.map((r) => ({ ...r }));
  const log: LoggedOp[] = [];
  const hooks: Record<string, UpdateHook[]> = {};
  const uniques: Record<string, { cols: string[]; applies?: (row: Row) => boolean }[]> = {};
  const failures: { table: string; op: string; message: string }[] = [];
  let counter = 0;
  const api = { maxRows: 1000 } as { maxRows: number };

  const table = (t: string): Row[] => (db[t] ??= []);
  const nextId = (t: string) => (SERIAL_TABLES.has(t) ? Math.max(0, ...table(t).map((r) => Number(r.id) || 0)) + 1 : `${t}-${++counter}`);

  function matches(row: Row, f: Filter): boolean {
    const v = row[f.col];
    switch (f.op) {
      case "eq": return v !== null && v !== undefined && v === f.val;
      case "neq": return v !== f.val;
      case "in": return (f.val as any[]).includes(v);
      case "is": return f.val === null ? v === null || v === undefined : v === f.val;
      case "gt": return v > f.val;
      case "gte": return v >= f.val;
      case "lt": return v < f.val;
      case "lte": return v <= f.val;
      case "notnull": return f.val === null ? v !== null && v !== undefined : v !== f.val;
      case "notin": return !(Array.isArray(f.val) ? f.val : String(f.val).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim())).includes(v);
    }
  }

  function dupe(t: string, candidate: Row, ignore?: Row): string | null {
    for (const { cols, applies } of uniques[t] ?? []) {
      if (cols.some((c) => candidate[c] === null || candidate[c] === undefined)) continue;
      if (applies && !applies(candidate)) continue;
      if (table(t).some((r) => r !== ignore && (!applies || applies(r)) && cols.every((c) => r[c] === candidate[c]))) return `duplicate key value violates unique constraint on ${t} (${cols.join(", ")})`;
    }
    return null;
  }

  class Builder implements PromiseLike<any> {
    private op: LoggedOp["op"] = "select";
    private filters: Filter[] = [];
    private payload: any;
    private upsertKey: string[] = ["id"];
    private wantRows = true; // a plain select returns rows; a write returns rows only after .select()
    private orderBy: { col: string; asc: boolean }[] = [];
    private lim: number | null = null;
    private rangeFrom: number | null = null;
    private rangeTo: number | null = null;
    private mode: "many" | "single" | "maybe" = "many";
    constructor(private t: string) {}

    private cols: string[] | null = null;
    select(cols?: string) { this.wantRows = true; this.cols = cols && cols.trim() !== "*" ? cols.split(",").map((c) => c.trim()) : null; return this; }
    insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; this.wantRows = false; return this; }
    update(patch: Row) { this.op = "update"; this.payload = patch; this.wantRows = false; return this; }
    delete() { this.op = "delete"; this.wantRows = false; return this; }
    upsert(rows: Row | Row[], opts?: { onConflict?: string }) { this.op = "upsert"; this.payload = rows; this.wantRows = false; if (opts?.onConflict) this.upsertKey = opts.onConflict.split(",").map((s) => s.trim()); return this; }
    eq(col: string, val: any) { this.filters.push({ col, op: "eq", val }); return this; }
    neq(col: string, val: any) { this.filters.push({ col, op: "neq", val }); return this; }
    in(col: string, val: any[]) { this.filters.push({ col, op: "in", val }); return this; }
    is(col: string, val: any) { this.filters.push({ col, op: "is", val }); return this; }
    gt(col: string, val: any) { this.filters.push({ col, op: "gt", val }); return this; }
    gte(col: string, val: any) { this.filters.push({ col, op: "gte", val }); return this; }
    lt(col: string, val: any) { this.filters.push({ col, op: "lt", val }); return this; }
    lte(col: string, val: any) { this.filters.push({ col, op: "lte", val }); return this; }
    /** `.not(col, "is", null)` and `.not(col, "in", "(a,b)")` */
    not(col: string, op: "is" | "in", val: any) { this.filters.push({ col, op: op === "is" ? "notnull" : "notin", val }); return this; }
    order(col: string, o?: { ascending?: boolean }) { this.orderBy.push({ col, asc: o?.ascending !== false }); return this; }
    limit(n: number) { this.lim = n; return this; }
    range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }

    then<R1 = any, R2 = never>(res?: ((v: any) => R1 | PromiseLike<R1>) | null, rej?: ((e: any) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
      return Promise.resolve().then(() => this.run()).then(res, rej);
    }

    private run(): { data: any; error: any } {
      const fi = failures.findIndex((f) => f.table === this.t && f.op === this.op);
      if (fi >= 0) {
        const [f] = failures.splice(fi, 1);
        log.push({ table: this.t, op: this.op, payload: this.payload, filters: this.filters, rows: 0 });
        return { data: null, error: { message: f.message, code: "XX000" } };
      }
      let affected: Row[] = [];
      if (this.op === "select") {
        affected = table(this.t).filter((r) => this.filters.every((f) => matches(r, f)));
      } else if (this.op === "insert" || this.op === "upsert") {
        const input: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const raw of input) {
          const row: Row = { ...(DEFAULTS[this.t]?.() ?? {}), ...raw };
          if (row.id === undefined) row.id = nextId(this.t);
          if (this.op === "upsert") {
            const existing = table(this.t).find((r) => this.upsertKey.every((c) => r[c] === row[c]));
            if (existing) { Object.assign(existing, raw); affected.push(existing); continue; }
          }
          const d = dupe(this.t, row);
          if (d) { log.push({ table: this.t, op: this.op, payload: this.payload, filters: this.filters, rows: 0 }); return { data: null, error: { message: d, code: "23505" } }; }
          table(this.t).push(row);
          affected.push(row);
        }
      } else if (this.op === "update") {
        for (const row of table(this.t).filter((r) => this.filters.every((f) => matches(r, f)))) {
          const after = { ...row, ...this.payload };
          for (const h of hooks[this.t] ?? []) h(row, after);
          const d = dupe(this.t, after, row);
          if (d) { log.push({ table: this.t, op: this.op, payload: this.payload, filters: this.filters, rows: 0 }); return { data: null, error: { message: d, code: "23505" } }; }
          Object.assign(row, after);
          affected.push(row);
        }
      } else {
        const gone = table(this.t).filter((r) => this.filters.every((f) => matches(r, f)));
        db[this.t] = table(this.t).filter((r) => !gone.includes(r));
        affected = gone;
      }
      log.push({ table: this.t, op: this.op, payload: this.payload, filters: this.filters, rows: affected.length });

      const project = (r: Row): Row => {
        if (!this.cols) return { ...r };
        const out: Row = {};
        for (const c of this.cols) out[c] = r[c] === undefined ? null : r[c];
        return out;
      };
      let rows = affected.map((r) => ({ ...r }));
      for (const o of [...this.orderBy].reverse()) {
        rows.sort((a, b) => {
          const x = a[o.col], y = b[o.col];
          if (x === y) return 0;
          if (x === null || x === undefined) return o.asc ? 1 : -1;
          if (y === null || y === undefined) return o.asc ? -1 : 1;
          return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
        });
      }
      if (this.op === "select") {
        const from = this.rangeFrom ?? 0;
        const to = this.rangeTo === null ? Infinity : this.rangeTo;
        rows = rows.slice(from, Math.min(to + 1, from + api.maxRows));
      }
      if (this.lim !== null) rows = rows.slice(0, this.lim);
      rows = rows.map(project); // ordering above works on the full row, like PostgREST
      if (!this.wantRows) return { data: null, error: null };
      if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
      if (this.mode === "maybe") return rows.length <= 1 ? { data: rows[0] ?? null, error: null } : { data: null, error: { message: "multiple rows returned", code: "PGRST116" } };
      return { data: rows, error: null };
    }
  }

  const sb = { from: (t: string) => new Builder(t) } as unknown as SupabaseClient;
  return Object.assign(api, {
    sb,
    db,
    log,
    failNext(t: string, op: LoggedOp["op"], message = "simulated failure") { failures.push({ table: t, op, message }); },
    onUpdate(t: string, hook: UpdateHook) { (hooks[t] ??= []).push(hook); },
    unique(t: string, cols: string[], applies?: (row: Row) => boolean) { (uniques[t] ??= []).push({ cols, applies }); },
    installIngredientPriceTrigger(today: string) {
      (hooks["cost_ingredients"] ??= []).push((before, after) => {
        if (after.pack_price !== before.pack_price) {
          const id = Math.max(0, ...table("cost_price_log").map((r) => Number(r.id) || 0)) + 1;
          table("cost_price_log").push({ id, ingredient_id: before.id, old_price: before.pack_price, new_price: after.pack_price, source: after.source ?? "app", entered_by: "system", changed_at: new Date().toISOString() });
          after.previous_price = before.pack_price;
          after.last_price_update = today;
        }
      });
    },
  }) as FakeSupabase;
}
