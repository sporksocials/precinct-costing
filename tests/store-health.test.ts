import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSnapshot } from "@/lib/store";
import { TABLES } from "@/lib/health";

type Row = Record<string, unknown>;

interface Opts {
  tables: Record<string, Row[]>;
  /** table -> how many of its first full fetches misbehave */
  dropFirst?: Record<string, number>;
  /** table -> "dup": repeat a row and drop another (same count) instead of just dropping */
  mode?: Record<string, "drop" | "dup">;
  /** table -> error returned by every select of it */
  errors?: Record<string, { code?: string; message: string }>;
  /** table -> error returned by the first N selects only */
  flaky?: Record<string, { n: number; error: { code?: string; message: string } }>;
  rpc?: "ok" | "missing" | "error";
}

/** A fake client: pages like PostgREST, can drop or repeat rows on the first fetch, fail per table, and answer the fingerprint RPC. */
function fake(o: Opts) {
  const seen: Record<string, number> = {};
  const fetches: string[] = [];
  const fingerprint = () => {
    const out: Record<string, unknown> = { generated_at: "now" };
    for (const [t, rows] of Object.entries(o.tables)) out[t] = { count: rows.length, hash: `h${rows.length}` };
    return out;
  };
  const client = {
    rpc: async () => {
      if (o.rpc === "missing") return { data: null, error: { code: "42883", message: "function public.cost_data_fingerprint does not exist" } };
      if (o.rpc === "error") throw new Error("Failed to fetch");
      return { data: fingerprint(), error: null };
    },
    from(table: string) {
      let lo = 0;
      let hi = Infinity;
      let head = false;
      const q = {
        select: (_c?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), q),
        order: () => q,
        gte: () => q,
        range: (a: number, b: number) => ((lo = a), (hi = b), q),
        then: (res: (v: unknown) => void) => {
          const err = o.errors?.[table];
          if (err) return res({ data: null, error: err, count: null });
          const fl = o.flaky?.[table];
          if (fl) {
            seen[`f${table}`] = (seen[`f${table}`] ?? 0) + 1;
            if (seen[`f${table}`] <= fl.n) return res({ data: null, error: fl.error, count: null });
          }
          const rows = o.tables[table];
          if (!rows) return res({ data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` }, count: null });
          if (head) return res({ data: null, error: null, count: rows.length });
          if (lo === 0) fetches.push(table);
          let out = rows;
          if (lo === 0) {
            seen[table] = (seen[table] ?? 0) + 1;
            if (seen[table] <= (o.dropFirst?.[table] ?? 0)) {
              out = o.mode?.[table] === "dup" ? [...rows.slice(0, rows.length - 1), rows[0]] : rows.filter((_, i) => i % 30 !== 7);
            }
          }
          res({ data: out.slice(lo, hi + 1), error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, fetches };
}

const mk = (n: number, p: string): Row[] => Array.from({ length: n }, (_, i) => ({ id: `${p}${String(i).padStart(4, "0")}`, sort: i, name: `n${i}`, key: `k${i}`, email: `e${i}`, venue_id: 1, category: `c${i}`, changed_at: "2026-09-01", created_at: "2026-09-01", beer_id: `b${i}` }));

function baseTables(): Record<string, Row[]> {
  const t: Record<string, Row[]> = {};
  for (const s of TABLES) t[s.table] = mk(s.table === "cost_recipe_lines" ? 2395 : 5, s.table.slice(5, 8));
  return t;
}

describe("loadSnapshot", () => {
  it("happy path: one load, no refetch, verified", async () => {
    const { client, fetches } = fake({ tables: baseTables() });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(snap.mismatches).toEqual([]);
    expect(snap.healed).toEqual([]);
    expect(snap.unverified).toBe(false);
    expect(snap.source).toBe("rpc");
    expect(snap.rows.cost_recipe_lines).toHaveLength(2395);
    // each table is fetched once (recipe lines take 3 pages, counted once on page 0)
    expect(fetches.filter((t) => t === "cost_recipe_lines")).toHaveLength(1);
  });

  it("heals a table whose first fetch drops rows, refetching only that table", async () => {
    const { client, fetches } = fake({ tables: baseTables(), dropFirst: { cost_recipe_lines: 1 } });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(snap.rows.cost_recipe_lines).toHaveLength(2395);
    expect(snap.mismatches).toEqual([]);
    expect(snap.healed).toEqual(["cost_recipe_lines"]);
    expect(fetches.filter((t) => t === "cost_recipe_lines")).toHaveLength(2);
    expect(fetches.filter((t) => t === "cost_menu_items")).toHaveLength(1);
  });

  it("heals a table that repeats one row and drops another (same count)", async () => {
    const { client } = fake({ tables: baseTables(), dropFirst: { cost_menu_items: 1 }, mode: { cost_menu_items: "dup" } });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(new Set(snap.rows.cost_menu_items.map((r) => (r as Row).id)).size).toBe(5);
    expect(snap.mismatches).toEqual([]);
    expect(snap.healed).toEqual(["cost_menu_items"]);
  });

  it("heals on the second attempt, and reports still-wrong tables by name after two", async () => {
    const twice = fake({ tables: baseTables(), dropFirst: { cost_recipe_lines: 2 } });
    const ok = await loadSnapshot(twice.client, "2026-06-01T00:00:00Z");
    expect(ok.mismatches).toEqual([]);
    expect(twice.fetches.filter((t) => t === "cost_recipe_lines")).toHaveLength(3);

    const never = fake({ tables: baseTables(), dropFirst: { cost_recipe_lines: 99 } });
    const bad = await loadSnapshot(never.client, "2026-06-01T00:00:00Z");
    expect(bad.mismatches).toHaveLength(1);
    expect(bad.mismatches[0]).toMatchObject({ table: "cost_recipe_lines", expected: 2395 });
    expect(["count", "duplicate"]).toContain(bad.mismatches[0].reason);
    expect(never.fetches.filter((t) => t === "cost_recipe_lines")).toHaveLength(3); // initial + 2 heal attempts
  });

  it("does NOT swallow a network / permission error on an optional table", async () => {
    const { client } = fake({ tables: baseTables(), errors: { cost_beers: { message: "TypeError: Failed to fetch" } } });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(snap.mismatches).toHaveLength(1);
    expect(snap.mismatches[0]).toMatchObject({ table: "cost_beers", reason: "error" });
    expect(snap.mismatches[0].message).toContain("Failed to fetch");

    const rls = fake({ tables: baseTables(), errors: { cost_offers: { code: "42501", message: "permission denied for table cost_offers" } } });
    const snap2 = await loadSnapshot(rls.client, "2026-06-01T00:00:00Z");
    expect(snap2.mismatches.map((m) => m.table)).toEqual(["cost_offers"]);
  });

  it("recovers when an optional table only fails once", async () => {
    const { client } = fake({ tables: baseTables(), flaky: { cost_beers: { n: 1, error: { message: "timeout" } } } });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(snap.mismatches).toEqual([]);
    expect(snap.healed).toEqual(["cost_beers"]);
    expect(snap.rows.cost_beers).toHaveLength(5);
  });

  it("DOES tolerate an optional table that does not exist (42P01)", async () => {
    const t = baseTables();
    delete t.cost_ingredient_deals;
    delete t.cost_offers;
    const { client } = fake({ tables: t });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(snap.mismatches).toEqual([]);
    expect(snap.healed).toEqual([]);
    expect(snap.rows.cost_ingredient_deals).toEqual([]);
    expect(snap.rows.cost_offers).toEqual([]);
  });

  it("fails the load when a required table errors", async () => {
    const { client } = fake({ tables: baseTables(), errors: { cost_ingredients: { message: "boom" } } });
    await expect(loadSnapshot(client, "2026-06-01T00:00:00Z")).rejects.toThrow(/cost_ingredients/);
  });

  it("falls back to per-table counts when the fingerprint function is missing", async () => {
    const { client } = fake({ tables: baseTables(), rpc: "missing", dropFirst: { cost_recipe_lines: 1 } });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(snap.source).toBe("counts");
    expect(snap.unverified).toBe(false);
    expect(snap.healed).toEqual(["cost_recipe_lines"]);
    expect(snap.rows.cost_recipe_lines).toHaveLength(2395);
  });

  it("is unverified (not silently fine) when neither the function nor the counts work", async () => {
    // rpc throws; counts (head) fail because every select errors on one table
    const { client } = fake({ tables: baseTables(), rpc: "error", errors: { cost_venues: { message: "Failed to fetch" } } });
    await expect(loadSnapshot(client, "2026-06-01T00:00:00Z")).rejects.toThrow(); // required table down: load fails outright

    const t = baseTables();
    const opt = fake({ tables: t, rpc: "error", errors: { cost_beer_prices: { message: "Failed to fetch" } } });
    const snap = await loadSnapshot(opt.client, "2026-06-01T00:00:00Z");
    expect(snap.unverified).toBe(true);
    expect(snap.source).toBe("none");
    expect(snap.mismatches.map((m) => m.table)).toEqual(["cost_beer_prices"]);
  });

  it("marks blocked when every table is empty", async () => {
    const t: Record<string, Row[]> = {};
    for (const s of TABLES) t[s.table] = [];
    const { client } = fake({ tables: t });
    const snap = await loadSnapshot(client, "2026-06-01T00:00:00Z");
    expect(snap.blocked).toBe(true);
    expect(snap.mismatches).toEqual([]);
  });
});
