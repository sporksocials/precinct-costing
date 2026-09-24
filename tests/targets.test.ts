import { describe, expect, it } from "vitest";
import { GUIDE_GP, targetGrid } from "@/lib/targets";
import { MENU_CATEGORIES, type MenuItem, type Target } from "@/lib/types";

const item = (id: string, venue_id: number, category: string): Pick<MenuItem, "id" | "venue_id" | "category"> => ({
  id,
  venue_id,
  category,
});
const tgt = (venue_id: number, category: string, target_gp: number): Target =>
  ({ venue_id, category, target_gp }) as Target;
const costs = (entries: Record<string, boolean>) =>
  new Map(Object.entries(entries).map(([id, underTarget]) => [id, { underTarget }]));

describe("targetGrid shape", () => {
  it("has one row per category and one column per venue, in the order given", () => {
    const grid = targetGrid([3, 1, 2], ["Wine", "Food"], [], [], new Map());
    expect(grid).toHaveLength(2);
    expect(grid.map((row) => row[0].category)).toEqual(["Wine", "Food"]);
    for (const row of grid) {
      expect(row.map((c) => c.venueId)).toEqual([3, 1, 2]);
      expect(row.every((c) => c.category === row[0].category)).toBe(true);
    }
  });
});

describe("targetGrid targets", () => {
  it("uses the stored target and falls back to null", () => {
    const grid = targetGrid([1, 2], ["Food", "Wine"], [tgt(1, "Food", 0.7), tgt(2, "Wine", "0.8" as unknown as number)], [], new Map());
    expect(grid[0][0].target).toBe(0.7);
    expect(grid[0][1].target).toBeNull();
    expect(grid[1][0].target).toBeNull();
    expect(grid[1][1].target).toBe(0.8);
  });
});

describe("targetGrid counts", () => {
  const items = [
    item("a", 1, "Food"),
    item("b", 1, "Food"),
    item("c", 1, "Food"),
    item("d", 2, "Food"),
    item("e", 1, "Wine"),
  ];
  const grid = targetGrid([1, 2], ["Food", "Wine"], [], items, costs({ a: true, b: false, c: true, d: true, e: false }));

  it("counts items and under-target items per venue and category", () => {
    expect(grid[0][0]).toMatchObject({ items: 3, under: 2 });
    expect(grid[0][1]).toMatchObject({ items: 1, under: 1 });
    expect(grid[1][0]).toMatchObject({ items: 1, under: 0 });
    expect(grid[1][1]).toMatchObject({ items: 0, under: 0 });
  });

  it("counts items in a venue/category that has no target", () => {
    expect(grid[0][0].target).toBeNull();
    expect(grid[0][0].items).toBe(3);
  });

  it("ignores items outside the requested venues and categories", () => {
    const g = targetGrid([1], ["Food"], [], [item("x", 9, "Food"), item("y", 1, "Spirits")], costs({ x: true, y: true }));
    expect(g[0][0]).toMatchObject({ items: 0, under: 0 });
  });

  it("counts items with a missing itemCosts entry as not under", () => {
    const g = targetGrid([1], ["Food"], [], [item("p", 1, "Food"), item("q", 1, "Food")], costs({ p: true }));
    expect(g[0][0]).toMatchObject({ items: 2, under: 1 });
  });
});

describe("GUIDE_GP", () => {
  it("has a value for every menu category", () => {
    for (const category of MENU_CATEGORIES) {
      expect(typeof GUIDE_GP[category]).toBe("number");
      expect(GUIDE_GP[category]).toBeGreaterThan(0);
      expect(GUIDE_GP[category]).toBeLessThan(1);
    }
  });
});
