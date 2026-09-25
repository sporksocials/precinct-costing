"use client";

/**
 * DEMO MODE ONLY (NEXT_PUBLIC_DEMO=1): an in-memory stand-in for the Supabase client used for visual QA.
 * Data is fetched from /api/demo-data (which 404s unless demo mode is on); mutations only touch memory.
 * Implements just the query-builder surface the app uses.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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
  cost_sell_price_log: "sellPriceLog", // not in demo data: always empty
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
        return t;
      });
  }
  return tablesPromise;
}

type Filter = (r: Row) => boolean;
type Op = "select" | "insert" | "update" | "delete" | "upsert";

class DemoQuery implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private rangeFrom = 0;
  private rangeTo = Infinity;
  private op: Op = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private conflict: string[] = ["id"];

  constructor(private table: string) {}

  select(): this {
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
  in(col: string, vs: unknown[]): this {
    const s = new Set(vs);
    this.filters.push((r) => s.has(r[col]));
    return this;
  }
  gte(col: string, v: unknown): this {
    this.filters.push((r) => String(r[col] ?? "") >= String(v));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, asc: opts?.ascending !== false };
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
    const match = (r: Row) => this.filters.every((f) => f(r));
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    switch (this.op) {
      case "select": {
        let out = rows.filter(match);
        if (this.orderBy) {
          const { col, asc } = this.orderBy;
          out = [...out].sort((a, b) => {
            const x = a[col] as string | number;
            const y = b[col] as string | number;
            const c = x == null ? -1 : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0;
            return asc ? c : -c;
          });
        }
        return { data: clone(out.slice(this.rangeFrom, this.rangeTo + 1)), error: null };
      }
      case "insert": {
        const added = this.payload.map((r) => {
          const row: Row = { ...r };
          if (row.id == null) row.id = Math.max(0, ...rows.map((x) => Number(x.id) || 0)) + 1;
          if (this.table === "cost_ingredients" && rows.some((x) => String(x.name).toLowerCase() === String(row.name).toLowerCase())) {
            throw new Error(`duplicate key value violates unique constraint "cost_ingredients_name_key"`);
          }
          return row;
        });
        rows.push(...added);
        return { data: clone(added), error: null };
      }
      case "upsert": {
        for (const r of this.payload) {
          const i = rows.findIndex((x) => this.conflict.every((c) => x[c] === r[c]));
          if (i >= 0) rows[i] = { ...rows[i], ...r };
          else rows.push({ ...r });
        }
        return { data: clone(this.payload), error: null };
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
          rows[i] = next;
          out.push(next);
        }
        return { data: clone(out), error: null };
      }
      case "delete": {
        const keep = rows.filter((r) => !match(r));
        tables[this.table] = keep;
        return { data: null, error: null };
      }
    }
  }

  then<A = { data: Row[] | null; error: { message: string } | null }, B = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.run()
      .catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
      .then(onfulfilled, onrejected);
  }
}

export function createDemoClient(): SupabaseClient {
  const user = { email: "demo@precinct.local" };
  const client = {
    from: (table: string) => new DemoQuery(table),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithOtp: async () => ({ data: {}, error: null }),
    },
  };
  // make the demo user an allowed user (browser only — nothing to load during server prerender)
  if (typeof window !== "undefined")
    void loadTables().then((t) => {
    const au = (t.cost_allowed_users ??= []);
    if (!au.some((u) => u.email === user.email)) au.push({ email: user.email });
  });
  return client as unknown as SupabaseClient;
}
