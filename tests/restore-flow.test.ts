import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HistoryRow } from "@/lib/change-history";
import { RestoreError, restoreFromPlan } from "@/lib/store";
import { buildTrash, planRestore, type LiveView, type Row } from "@/lib/trash";

let seq = 0;
function del(table: string, key: string, old: Row, parent?: [string, string], tx = ++seq): HistoryRow {
  seq += 1;
  return { id: seq, tx_id: tx, table_name: table, row_key: key, op: "delete", old_row: old, new_row: null, changed_fields: [], parent_table: parent?.[0] ?? null, parent_id: parent?.[1] ?? null, changed_by: "matt@example.com", changed_at: new Date(Date.parse("2026-10-05T01:00:00Z") + seq).toISOString() };
}

/** A fake client recording every insert, with optional failures per table / id. */
function fake(opts: { failParent?: { code?: string; message: string }; failRows?: Set<string>; failBatch?: boolean } = {}) {
  const calls: { table: string; payload: Row | Row[] }[] = [];
  const sb = {
    from(table: string) {
      return {
        insert(payload: Row | Row[]) {
          calls.push({ table, payload });
          const rows = Array.isArray(payload) ? payload : [payload];
          let error: { code?: string; message: string } | null = null;
          if (table === "cost_menu_items" && opts.failParent) error = opts.failParent;
          else if (Array.isArray(payload) && opts.failBatch) error = { message: "batch refused" };
          else if (rows.some((r) => opts.failRows?.has(String(r.id)))) error = { message: `row ${rows.find((r) => opts.failRows?.has(String(r.id)))?.id} refused` };
          return Promise.resolve({ data: null, error });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const lv = (t: Record<string, Row[]>): LiveView => ({ has: (tb, k) => (t[tb] ?? []).some((r) => String(r.id) === k), rows: (tb) => t[tb] ?? [] });
const lk = { venueName: () => "Drift", nameOf: (tb: string, k: string): string | undefined => (tb === "cost_ingredients" ? `Ingredient ${k}` : undefined) };

function plan(live: Record<string, Row[]>) {
  const rows = [
    del("cost_recipe_lines", "l1", { id: "l1", parent_type: "item", parent_id: "d1", component_type: "ingredient", component_id: "i1", qty: 30, unit: "ml", note: null, sort: 1 }, ["cost_menu_items", "d1"], 900),
    del("cost_recipe_lines", "l2", { id: "l2", parent_type: "item", parent_id: "d1", component_type: "ingredient", component_id: "i2", qty: 15, unit: "ml", note: "fresh", sort: 2 }, ["cost_menu_items", "d1"], 900),
    del("cost_menu_items", "d1", { id: "d1", name: "Margarita", venue_id: 1, category: "Cocktail", section: null, sell_price_inc: 18, glass: "Coupe Glass" }, undefined, 901),
  ];
  const e = buildTrash(rows, () => false)[0];
  return planRestore(e, lv(live), lk);
}

describe("restoreFromPlan", () => {
  it("inserts the parent first, then its lines, with ORIGINAL ids and null keys stripped", async () => {
    const f = fake();
    const r = await restoreFromPlan(f.sb, plan({ cost_ingredients: [{ id: "i1" }, { id: "i2" }] }));
    expect(r).toEqual({ restored: 2, failed: [] });
    expect(f.calls.map((c) => c.table)).toEqual(["cost_menu_items", "cost_recipe_lines"]);
    const parent = f.calls[0].payload as Row;
    expect(parent.id).toBe("d1");
    expect(parent).not.toHaveProperty("section"); // null stripped so a column default applies
    const lines = f.calls[1].payload as Row[];
    expect(lines.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(lines[0]).not.toHaveProperty("note");
    expect(lines[1].note).toBe("fresh");
  });

  it("a name clash writes nothing and says why", async () => {
    const f = fake();
    const p = plan({ cost_ingredients: [{ id: "i1" }, { id: "i2" }], cost_menu_items: [{ id: "x", name: "Margarita", venue_id: 1 }] });
    await expect(restoreFromPlan(f.sb, p)).rejects.toThrow("A drink with this name already exists at Drift. Rename or remove it first, then restore.");
    expect(f.calls).toEqual([]);
  });

  it("a database unique refusal on the parent maps to the clash message and writes no lines", async () => {
    const f = fake({ failParent: { code: "23505", message: 'duplicate key value violates unique constraint "cost_menu_items_name_venue_id_key"' } });
    await expect(restoreFromPlan(f.sb, plan({ cost_ingredients: [{ id: "i1" }, { id: "i2" }] }))).rejects.toThrow(/already exists/);
    expect(f.calls.map((c) => c.table)).toEqual(["cost_menu_items"]);
  });

  it("any other parent failure writes no lines", async () => {
    const f = fake({ failParent: { message: "permission denied" } });
    const err = await restoreFromPlan(f.sb, plan({ cost_ingredients: [{ id: "i1" }, { id: "i2" }] })).catch((e) => e);
    expect(err).toBeInstanceOf(RestoreError);
    expect(err.message).toMatch(/permission denied.*Nothing was changed/);
    expect(f.calls.map((c) => c.table)).toEqual(["cost_menu_items"]);
  });

  it("lines that cannot be restored are left out of the write and reported in the plan", async () => {
    const f = fake();
    const p = plan({ cost_ingredients: [{ id: "i2" }] });
    expect(p.skipped.map((s) => s.row.id)).toEqual(["l1"]);
    const r = await restoreFromPlan(f.sb, p);
    expect(r.restored).toBe(1);
    expect((f.calls[1].payload as Row[]).map((l) => l.id)).toEqual(["l2"]);
  });

  it("a refused batch is retried row by row and the failures are named", async () => {
    const f = fake({ failBatch: true, failRows: new Set(["l2"]) });
    const r = await restoreFromPlan(f.sb, plan({ cost_ingredients: [{ id: "i1" }, { id: "i2" }] }));
    expect(r.restored).toBe(1);
    expect(r.failed).toEqual([{ label: "Ingredient i2 15 ml", reason: "row l2 refused" }]);
  });
});
