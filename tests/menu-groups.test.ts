import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseBarMenu } from "@/lib/bar";
import { describeChanges, fieldLabel } from "@/lib/draft-changes";
import {
  cleanGroupName,
  drinksInView,
  flavourCount,
  goBack,
  goHome,
  groupKey,
  groupNamesAt,
  hasGroupColumn,
  matchesSearch,
  NAV_START,
  openDrink,
  openGroup,
  resolveScreen,
  sameNav,
  stationCards,
  type StationNav,
} from "@/lib/menu-groups";

interface D {
  id: string;
  name: string;
  category: string;
  menuGroup: string | null;
}
const d = (id: string, name: string, menuGroup: string | null = null, category = "Cold Drink"): D => ({ id, name, category, menuGroup });

const MILKSHAKES = [d("m1", "Kids Caramel Milkshake", "Kids Milkshakes"), d("m2", "Kids Chocolate Milkshake", "Kids Milkshakes"), d("m3", "Kids Strawberry Milkshake", "kids milkshakes "), d("m4", "Kids Vanilla Milkshake", "Kids Milkshakes")];
const SPIDERS = [d("s1", "Coke Spider", "Spiders"), d("s2", "Lemonade Spider", "Spiders"), d("s3", "Raspberry Lemonade Spider", "Spiders")];
const MENU: D[] = [d("a", "Affogato Shake", null, "Cold Drink"), ...MILKSHAKES, ...SPIDERS, d("c1", "Mojito", null, "Cocktail"), d("c2", "Negroni", null, "Cocktail"), d("k1", "Passionfruit Mocktail", null, "Mocktail")].sort((x, y) => x.name.localeCompare(y.name));

describe("group names", () => {
  it("compares names without caring about capitals or spacing", () => {
    expect(groupKey("  Kids   Milkshakes ")).toBe("kids milkshakes");
    expect(groupKey("kids milkshakes")).toBe(groupKey("Kids Milkshakes"));
    expect(groupKey(null)).toBe("");
    expect(groupKey("   ")).toBe("");
  });
  it("tidies a typed name and treats empty as no group", () => {
    expect(cleanGroupName("  kids   milkshakes ")).toBe("Kids Milkshakes");
    expect(cleanGroupName("")).toBeNull();
    expect(cleanGroupName("   ")).toBeNull();
    expect(cleanGroupName(null)).toBeNull();
  });
  it("lists the names already used at one venue, once each, for the editor chips", () => {
    const items = [
      { id: "1", venue_id: 1, menu_group: "Spiders" },
      { id: "2", venue_id: 1, menu_group: "spiders" },
      { id: "3", venue_id: 1, menu_group: "Spiders" },
      { id: "4", venue_id: 1, menu_group: "Kids Milkshakes" },
      { id: "5", venue_id: 2, menu_group: "Chiobu Only" },
      { id: "6", venue_id: 1, menu_group: null },
      { id: "7", venue_id: 1 },
    ];
    expect(groupNamesAt(items, 1)).toEqual(["Kids Milkshakes", "Spiders"]);
    expect(groupNamesAt(items, 2)).toEqual(["Chiobu Only"]);
    // the record being edited does not vouch for its own (unsaved) group
    expect(groupNamesAt(items, 1, "4")).toEqual(["Spiders"]);
  });
  it("only offers the field when the database has the column", () => {
    expect(hasGroupColumn([{ id: "1" }, { id: "2" }])).toBe(false);
    expect(hasGroupColumn([{ id: "1" }, { id: "2", menu_group: null }])).toBe(true);
    expect(hasGroupColumn([])).toBe(false);
  });
  it("reads as a plain field change in the editor and history", () => {
    expect(fieldLabel("menu_group")).toBe("Menu Group");
    const base: { name: string; menu_group: string | null } = { name: "Coke Spider", menu_group: null };
    const draft = { name: "Coke Spider", menu_group: "Spiders" };
    expect(describeChanges(base, draft, [], []).labels).toEqual(["Menu Group"]);
    // an older row without the column and a draft that still has none is not a change
    expect(describeChanges({ name: "x" }, { name: "x" }, [], []).dirty).toBe(false);
  });
});

describe("flavourCount", () => {
  it("counts in words", () => {
    expect(flavourCount(4)).toBe("4 flavours");
    expect(flavourCount(2)).toBe("2 flavours");
    expect(flavourCount(1)).toBe("1 flavour");
  });
});

describe("stationCards: folding flavours into group cards", () => {
  it("makes one card per group with two or more items in view and keeps every other drink as its own card", () => {
    const cards = stationCards(MENU);
    const groups = cards.filter((c) => c.kind === "group");
    expect(groups.map((g) => (g.kind === "group" ? g.name : ""))).toEqual(["Kids Milkshakes", "Spiders"]);
    const milk = groups[0];
    expect(milk.kind === "group" && milk.members.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    // every drink appears exactly once: inside its group or on its own
    const seen = cards.flatMap((c) => (c.kind === "group" ? c.members.map((m) => m.id) : [c.item.id]));
    expect(seen.sort()).toEqual(MENU.map((m) => m.id).sort());
    expect(cards.filter((c) => c.kind === "item").map((c) => c.key)).not.toContain("m1");
  });
  it("matches group names ignoring capitals and spacing, and names the group the way most members spell it", () => {
    const cards = stationCards(MILKSHAKES);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind === "group" && cards[0].name).toBe("Kids Milkshakes");
  });
  it("shows a lone item of a group as an ordinary card", () => {
    const cards = stationCards([d("1", "Coke Spider", "Spiders"), d("2", "Mojito", null, "Cocktail")]);
    expect(cards.map((c) => c.kind)).toEqual(["item", "item"]);
  });
  it("leaves a menu with no groups exactly as it came", () => {
    const flat = [d("1", "Zebra"), d("2", "Apple"), d("3", "mango")];
    expect(stationCards(flat).map((c) => c.key)).toEqual(["1", "2", "3"]);
    // an older payload with no menuGroup at all
    expect(stationCards([{ id: "1", name: "A" }, { id: "2", name: "B" }]).map((c) => c.kind)).toEqual(["item", "item"]);
  });
  it("sits a group card among the other drinks by its name, without reordering them", () => {
    const cards = stationCards(MENU);
    const labels = cards.map((c) => (c.kind === "group" ? c.name : c.item.name));
    expect(labels).toEqual(["Affogato Shake", "Kids Milkshakes", "Mojito", "Negroni", "Passionfruit Mocktail", "Spiders"]);
  });
  it("puts a group that sorts last at the end", () => {
    const labels = stationCards([d("1", "Apple Juice"), ...SPIDERS]).map((c) => (c.kind === "group" ? c.name : c.item.name));
    expect(labels).toEqual(["Apple Juice", "Spiders"]);
  });
  it("two groups with different names stay apart", () => {
    const cards = stationCards([d("1", "A", "One"), d("2", "B", "One"), d("3", "C", "Two"), d("4", "D", "Two")]);
    expect(cards.map((c) => c.kind)).toEqual(["group", "group"]);
  });
});

describe("stationCards: chips and search", () => {
  it("a chip filters members first: a group keeps its card only while two members are in view", () => {
    const mixed = [d("1", "Berry Smoothie", "Berry", "Cold Drink"), d("2", "Berry Mocktail", "Berry", "Mocktail"), d("3", "Berry Cocktail", "Berry", "Cocktail")];
    // All: three flavours in one card
    expect(stationCards(drinksInView(mixed, { query: "", category: null }))[0].kind).toBe("group");
    // Mocktails chip: only one member left, so it is an ordinary card
    const m = stationCards(drinksInView(mixed, { query: "", category: "Mocktail" }));
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe("item");
    // Cold Drinks chip on the real menu: the milkshakes and spiders both still group
    const cold = stationCards(drinksInView(MENU, { query: "", category: "Cold Drink" }));
    expect(cold.filter((c) => c.kind === "group")).toHaveLength(2);
    // Cocktails chip: no group at all
    expect(stationCards(drinksInView(MENU, { query: "", category: "Cocktail" })).every((c) => c.kind === "item")).toBe(true);
  });
  it("a search lists matching drinks flat, never a group card", () => {
    const view = drinksInView(MENU, { query: "milkshake", category: null });
    expect(view.map((v) => v.id).sort()).toEqual(["m1", "m2", "m3", "m4"]);
    const cards = stationCards(view, { searching: true });
    expect(cards.every((c) => c.kind === "item")).toBe(true);
    expect(cards).toHaveLength(4);
  });
  it("a search matches the group name too, and a search ignores the chip", () => {
    expect(drinksInView(MENU, { query: "spiders", category: null }).map((v) => v.id).sort()).toEqual(["s1", "s2", "s3"]);
    // searching covers every category even if a chip is picked
    expect(drinksInView(MENU, { query: "mojito", category: "Cold Drink" }).map((v) => v.id)).toEqual(["c1"]);
    expect(matchesSearch(d("1", "Coke Spider", "Spiders"), "SPIDER")).toBe(true);
    expect(matchesSearch(d("1", "Coke Spider", "Spiders"), "mojito")).toBe(false);
    expect(matchesSearch(d("1", "Coke Spider"), "  ")).toBe(true);
  });
});

describe("station navigation", () => {
  const cards = stationCards(MENU);
  const open = (nav: StationNav) => resolveScreen(nav, MENU, cards);
  it("starts on the grid", () => {
    expect(open(NAV_START).screen).toBe("grid");
  });
  it("a group card opens its flavour list, a flavour opens its recipe", () => {
    const list = open(openGroup(NAV_START, "spiders"));
    expect(list.screen).toBe("group");
    expect(list.group?.members.map((m) => m.id)).toEqual(["s1", "s2", "s3"]);
    const recipe = open(openDrink(openGroup(NAV_START, "spiders"), "s2"));
    expect(recipe.screen).toBe("detail");
    expect(recipe.item?.id).toBe("s2");
    expect(recipe.group?.key).toBe("spiders");
  });
  it("Back from a recipe returns to the flavour list, Back from the list returns to the grid", () => {
    const inRecipe = openDrink(openGroup(NAV_START, "spiders"), "s2");
    const back1 = goBack(inRecipe);
    expect(open(back1).screen).toBe("group");
    const back2 = goBack(back1);
    expect(open(back2).screen).toBe("grid");
    expect(back2).toEqual(NAV_START);
  });
  it("a recipe opened from the main grid or a search goes back to the grid", () => {
    const inRecipe = openDrink(NAV_START, "c1");
    expect(open(inRecipe).screen).toBe("detail");
    expect(open(goBack(inRecipe)).screen).toBe("grid");
  });
  it("the idle return goes all the way to the main grid", () => {
    expect(goHome()).toEqual(NAV_START);
  });
  it("a refresh that removes the open recipe drops to its flavour list, or the grid when it came from the grid", () => {
    const nav = openDrink(openGroup(NAV_START, "spiders"), "s2");
    const without = MENU.filter((m) => m.id !== "s2");
    const r1 = resolveScreen(nav, without, stationCards(without));
    expect(r1.screen).toBe("group");
    expect(r1.nav).toEqual({ group: "spiders", selectedId: null });
    const r2 = resolveScreen(openDrink(NAV_START, "c1"), without.filter((m) => m.id !== "c1"), stationCards(without.filter((m) => m.id !== "c1")));
    expect(r2.screen).toBe("grid");
    expect(r2.nav).toEqual(NAV_START);
  });
  it("a refresh that leaves a group with fewer than two flavours drops to the grid, even from inside a recipe", () => {
    const left = MENU.filter((m) => m.id !== "s2" && m.id !== "s3");
    const inList = resolveScreen(openGroup(NAV_START, "spiders"), left, stationCards(left));
    expect(inList.screen).toBe("grid");
    expect(inList.nav).toEqual(NAV_START);
    // the recipe that is still there stays open, now with no flavour list behind it
    const inRecipe = resolveScreen(openDrink(openGroup(NAV_START, "spiders"), "s1"), left, stationCards(left));
    expect(inRecipe.screen).toBe("detail");
    expect(inRecipe.nav).toEqual({ group: null, selectedId: "s1" });
    expect(open(goBack(inRecipe.nav)).screen).toBe("grid");
  });
  it("sameNav says whether a refresh moved anything", () => {
    expect(sameNav(NAV_START, { group: null, selectedId: null })).toBe(true);
    expect(sameNav(NAV_START, openGroup(NAV_START, "x"))).toBe(false);
  });
});

describe("the station payload", () => {
  const payload = (extra: Record<string, unknown>) => parseBarMenu({ venue: { slug: "drift", name: "Drift" }, items: [{ id: "a", name: "Coke Spider", category: "Cold Drink", glass: "Tall", method: ["Pour"], ...extra }] }, "2026-10-10T00:00:00Z");
  it("reads menu_group, tidying spacing", () => {
    expect(payload({ menu_group: "Spiders" })?.items[0].menuGroup).toBe("Spiders");
    expect(payload({ menu_group: "  Kids   Milkshakes " })?.items[0].menuGroup).toBe("Kids Milkshakes");
  });
  it("an absent, empty or odd menu_group is no group, so an older payload shows everything flat", () => {
    expect(payload({})?.items[0].menuGroup).toBeNull();
    expect(payload({ menu_group: null })?.items[0].menuGroup).toBeNull();
    expect(payload({ menu_group: "  " })?.items[0].menuGroup).toBeNull();
    expect(payload({ menu_group: 7 })?.items[0].menuGroup).toBeNull();
  });
});

describe("display only", () => {
  it("costing, alerts, the dashboard and the POS list never read the group", () => {
    for (const f of ["lib/costing.ts", "lib/insights.ts", "lib/dashboard.ts", "lib/pos-list.ts", "lib/pos-list-xlsx.ts", "lib/print-recipe.ts", "lib/kitchen.ts", "lib/gelato.ts", "lib/beer.ts"]) {
      // (lib/pos-list.ts has its own unrelated menuGroup() for the till's "Menu Group" column: it reads the section and category)
      expect(readFileSync(f, "utf8"), f).not.toMatch(/menu_group|\.menuGroup\b|menu-groups/);
    }
  });
  it("the costing Menu page stays flat", () => {
    expect(readFileSync("app/(app)/menu/page.tsx", "utf8")).not.toMatch(/menu_group|menu-groups/);
  });
  it("the station function and schema.sql carry the group; the group column comes first", () => {
    const col = readFileSync("supabase/migrations/20261010100000_menu_item_groups.sql", "utf8");
    const fn = readFileSync("supabase/migrations/20261010110000_bar_menu_group.sql", "utf8");
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(col).toContain("add column if not exists menu_group text");
    expect(schema).toContain("add column if not exists menu_group text");
    for (const sql of [fn, schema]) expect(sql).toContain("'menu_group', mi.menu_group");
    // the rest of the function is the previous one unchanged: same filters, still no prices or notes
    for (const sql of [fn]) {
      expect(sql).toContain("btrim(coalesce(mi.glass, '')) <> ''");
      expect(sql).toContain("mi.category in ('Cocktail', 'Mocktail', 'Cold Drink')");
      expect(sql).not.toMatch(/mi\.(sell_price|notes|hh_price|target)/);
    }
  });
  it("the station function differs from the cold drinks version by the one menu_group key", () => {
    const fn = (s: string) => {
      const start = s.lastIndexOf("create or replace function public.cost_bar_menu");
      return s.slice(start, s.indexOf("$$;", s.indexOf("as $$", start))).replace(/\s+/g, " ");
    };
    const prev = fn(readFileSync("supabase/migrations/20261005200000_bar_menu_cold_drinks.sql", "utf8").slice(0, readFileSync("supabase/migrations/20261005200000_bar_menu_cold_drinks.sql", "utf8").indexOf("cost_bar_premix")));
    const next = fn(readFileSync("supabase/migrations/20261010110000_bar_menu_group.sql", "utf8"));
    expect(next.replace("'menu_group', mi.menu_group, ", "")).toBe(prev);
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(fn(schema)).toBe(next);
  });
  it("the recipe editor only offers and writes the field when the database has the column", () => {
    const src = readFileSync("components/editor/recipe-editor.tsx", "utf8");
    expect(src).toContain("hasGroupColumn(store.items)");
    expect(src).toMatch(/showGroup = !!item && groupColumn/);
  });
});
