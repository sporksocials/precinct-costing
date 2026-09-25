import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, pageOrder } from "@/lib/store";

/** A fake client whose ties come back in a different order on every request, like Postgres can. */
function fakeClient(rows: Record<string, unknown>[]) {
  return {
    from() {
      const orders: string[] = [];
      let lo = 0;
      let hi = 0;
      const q = {
        select: () => q,
        order: (c: string) => (orders.push(c), q),
        gte: () => q,
        range: (a: number, b: number) => ((lo = a), (hi = b), q),
        then: (res: (v: unknown) => void) => {
          const total = orders.includes("id");
          const sorted = [...rows].sort((x, y) => {
            const c = Number(x.sort) - Number(y.sort);
            if (c !== 0) return c;
            if (total) return String(x.id).localeCompare(String(y.id));
            return Math.random() - 0.5; // tied rows shuffle between pages
          });
          res({ data: sorted.slice(lo, hi + 1), error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe("fetchAll paging", () => {
  const rows = Array.from({ length: 2395 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, sort: i % 8 }));

  it("returns every row exactly once across pages when the order is total", async () => {
    const got = await fetchAll<{ id: string }>(fakeClient(rows), "cost_recipe_lines", "sort");
    expect(got).toHaveLength(2395);
    expect(new Set(got.map((r) => r.id)).size).toBe(2395);
  });

  it("adds a unique tie-breaker to every ordering", () => {
    expect(pageOrder("cost_recipe_lines", "sort")).toEqual(["sort", "id"]);
    expect(pageOrder("cost_menu_items", "name")).toEqual(["name", "id"]);
    expect(pageOrder("cost_beer_prices", "beer_id")).toEqual(["beer_id", "id"]);
    expect(pageOrder("cost_targets", "venue_id")).toEqual(["venue_id", "category"]);
    expect(pageOrder("cost_settings", "key")).toEqual(["key"]);
    expect(pageOrder("cost_portal_prices", "id")).toEqual(["id"]);
  });
});
