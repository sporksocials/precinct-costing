import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFreshRecord, guardedUpdate } from "@/lib/fresh-record";

type Call = { table: string; op: string; eqs: [string, unknown][]; order?: string; patch?: unknown };

/** A fake client that records what was asked and answers from a script. */
function fakeClient(answers: Record<string, { data?: unknown; error?: { message: string } }>) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const call: Call = { table, op: "select", eqs: [] };
      const q = {
        select: () => q,
        update: (patch: unknown) => {
          call.op = "update";
          call.patch = patch;
          return q;
        },
        eq: (col: string, v: unknown) => {
          call.eqs.push([col, v]);
          return q;
        },
        order: (col: string) => {
          call.order = col;
          return q;
        },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
          calls.push(call);
          const a = answers[`${table}:${call.op}`] ?? { data: [] };
          return Promise.resolve({ data: a.data ?? null, error: a.error ?? null }).then(ok, bad);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("fetchFreshRecord", () => {
  it("reads the row and its lines with one request per table, filtered to this record", async () => {
    const { client, calls } = fakeClient({
      "cost_menu_items:select": { data: [{ id: "i1", name: "Mai Tai", updated_at: "T", updated_by: "brendan@x" }] },
      "cost_recipe_lines:select": { data: [{ id: "a", parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: "c", qty: "30", unit: "ml", note: null, sort: 1 }] },
    });
    const f = await fetchFreshRecord(client, "item", "i1");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ table: "cost_menu_items", eqs: [["id", "i1"]] });
    expect(calls[1]).toMatchObject({ table: "cost_recipe_lines", eqs: [["parent_type", "item"], ["parent_id", "i1"]], order: "sort" });
    expect(f.row).toMatchObject({ id: "i1", updated_by: "brendan@x" });
    expect(f.lines[0].qty).toBe(30); // numeric columns arrive as numbers
  });

  it("a prep reads cost_preps", async () => {
    const { client, calls } = fakeClient({ "cost_preps:select": { data: [{ id: "p1", name: "Sauce" }] } });
    const f = await fetchFreshRecord(client, "prep", "p1");
    expect(calls[0].table).toBe("cost_preps");
    expect(calls[1].eqs[0]).toEqual(["parent_type", "prep"]);
    expect(f.row?.id).toBe("p1");
    expect(f.lines).toEqual([]);
  });

  it("a deleted record comes back as row null", async () => {
    const { client } = fakeClient({ "cost_menu_items:select": { data: [] } });
    expect((await fetchFreshRecord(client, "item", "gone")).row).toBeNull();
  });

  it("offline: an error on either read throws, so the save is refused instead of written blind", async () => {
    const a = fakeClient({ "cost_menu_items:select": { error: { message: "Failed to fetch" } } });
    await expect(fetchFreshRecord(a.client, "item", "i1")).rejects.toThrow("Failed to fetch");
    const b = fakeClient({ "cost_menu_items:select": { data: [{ id: "i1" }] }, "cost_recipe_lines:select": { error: { message: "network down" } } });
    await expect(fetchFreshRecord(b.client, "item", "i1")).rejects.toThrow("network down");
  });

  it("before the stamps migration the row has no updated_by (and maybe no updated_at): it still reads fine", async () => {
    const { client } = fakeClient({ "cost_menu_items:select": { data: [{ id: "i1", name: "Mai Tai" }] } });
    const f = await fetchFreshRecord(client, "item", "i1");
    expect(f.row).toEqual({ id: "i1", name: "Mai Tai" });
    expect((f.row as unknown as Record<string, unknown>).updated_by).toBeUndefined();
  });
});

describe("guardedUpdate", () => {
  it("adds the updated_at condition when it has a guard", async () => {
    const { client, calls } = fakeClient({ "cost_menu_items:update": { data: [{ id: "i1", name: "New", updated_at: "T2" }] } });
    const r = await guardedUpdate(client, "item", "i1", { name: "New" }, "T1");
    expect(calls[0].eqs).toEqual([["id", "i1"], ["updated_at", "T1"]]);
    expect(calls[0].patch).toEqual({ name: "New" });
    expect(r).toMatchObject({ stale: false, row: { updated_at: "T2" } });
  });

  it("zero rows with a guard means someone saved in between: stale", async () => {
    const { client } = fakeClient({ "cost_menu_items:update": { data: [] } });
    expect(await guardedUpdate(client, "item", "i1", { name: "New" }, "T1")).toEqual({ row: null, stale: true });
  });

  it("without a guard (no updated_at column) the update has no extra condition, and zero rows is not 'stale'", async () => {
    const { client, calls } = fakeClient({ "cost_preps:update": { data: [] } });
    const r = await guardedUpdate(client, "prep", "p1", { name: "New" }, null);
    expect(calls[0].eqs).toEqual([["id", "p1"]]);
    expect(r).toEqual({ row: null, stale: false });
  });

  it("a database error throws", async () => {
    const { client } = fakeClient({ "cost_menu_items:update": { error: { message: "permission denied" } } });
    await expect(guardedUpdate(client, "item", "i1", {}, null)).rejects.toThrow("permission denied");
  });
});
