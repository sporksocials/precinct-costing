import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseKitchenMatrix } from "@/lib/kitchen-matrix";
import { GUEST_GROUPS, buildRows, guestNeeds, matrixSections, cell } from "@/lib/allergy-matrix";
import { isKitchenPath, isKitchenVenue } from "@/lib/kitchen";
import { stationWorkerSource } from "@/lib/sw-source";
import { CARD_BG, MX } from "@/components/kitchen/palette";

const SYNCED = "2026-10-10T04:00:00Z";

/** a feed in the shape cost_kitchen_matrix returns */
const RAW = {
  venue: { slug: "drift", name: "Drift Bar" },
  dishes: [
    {
      id: "d-burger",
      name: "Crispy Chicken Burger",
      section: "Burgers",
      dish_allergens: { contains: ["gluten", "milk", "egg"], without: { milk: "no aioli" }, confirmed_at: "2026-10-10T03:00:00Z" },
      marks: [],
      options: {
        gfo: { note: "Check the sauce", left_out: ["Brioche Bun (700g)"], added: [{ name: "Gluten Free Bun", qty: 1, unit: "each" }, { name: "Tamari", qty: 15, unit: "ml" }] },
        dfo: { note: "", left_out: [], added: [] },
      },
    },
    { id: "d-salad", name: "Green Salad", section: "Bowls & Salads", dish_allergens: { contains: [], without: {}, confirmed_at: "2026-10-09T03:00:00Z" }, marks: ["gf", "v"], options: {} },
    { id: "d-new", name: "New Special", section: null, dish_allergens: null, marks: [], options: { vo: { note: "Hold the bacon", left_out: [], added: [] } } },
  ],
};

describe("parseKitchenMatrix", () => {
  const d = parseKitchenMatrix(RAW, SYNCED)!;
  it("normalises the database payload", () => {
    expect(d.venue).toEqual({ slug: "drift", name: "Drift Bar" });
    expect(d.syncedAt).toBe(SYNCED);
    expect(d.dishes.map((x) => x.name)).toEqual(["Crispy Chicken Burger", "Green Salad", "New Special"]);
    expect(d.dishes[0].allergens).toMatchObject({ contains: ["gluten", "egg", "milk"], without: { milk: "no aioli" }, confirmedAt: "2026-10-10T03:00:00Z" });
    expect(d.dishes[1].marks).toEqual(["gf", "v"]);
    expect(d.dishes[2].allergens).toBeNull();
    expect(d.dishes[2].section).toBeNull();
  });
  it("builds the option wording from the resolved names, with amounts and tidy names, and never a price", () => {
    expect(d.dishes[0].options.gfo).toBe("Leave out Brioche Bun. Add Gluten Free Bun 1 ea, Tamari 15 ml. Check the sauce");
    expect(d.dishes[0].options.dfo).toBe(""); // an option with no words stays an option; the cell then reads See chef
    expect(d.dishes[2].options.vo).toBe("Hold the bacon");
  });
  it("never carries who signed a dish off", () => {
    const withWho = parseKitchenMatrix({ ...RAW, dishes: [{ ...RAW.dishes[0], dish_allergens: { ...RAW.dishes[0].dish_allergens, confirmed_by: "chef@example.com" } }] }, SYNCED)!;
    expect(JSON.stringify(withWho)).not.toContain("chef@example.com");
    expect(withWho.dishes[0].allergens?.confirmedBy).toBeNull();
  });
  it("holds no price even if one reached the feed", () => {
    const dirty = parseKitchenMatrix(
      { ...RAW, dishes: [{ ...RAW.dishes[0], sell_price_inc: 24.5, cost: 7.1, gp: 0.7, options: { gfo: { note: "GF bun", surcharge_inc: 3, left_out: [], added: [{ name: "Bun", qty: 1, unit: "each", price: 1.2 }] } } }] },
      SYNCED,
    )!;
    expect(JSON.stringify(dirty)).not.toMatch(/24\.5|7\.1|surcharge|price|\bgp\b|"cost"|1\.2/);
    expect(dirty.dishes[0].options.gfo).toBe("Add Bun 1 ea. GF bun");
  });
  it("only knows the known keys: unknown marks, options, allergens and units are dropped", () => {
    const x = parseKitchenMatrix(
      { venue: { slug: "drift", name: "Drift" }, dishes: [{ id: "a", name: "A", section: "Mains", dish_allergens: { contains: ["milk", "nope", "alcohol"], without: { milk: "no cheese", egg: "x" }, confirmed_at: "bad" }, marks: ["gf", "xx"], options: { gfo: { note: "n" }, zzz: { note: "z" }, vo: "text" } }] },
      SYNCED,
    )!;
    expect(x.dishes[0].allergens).toMatchObject({ contains: ["milk"], without: { milk: "no cheese" }, confirmedAt: null });
    expect(x.dishes[0].marks).toEqual(["gf"]);
    expect(Object.keys(x.dishes[0].options)).toEqual(["gfo"]);
  });
  it("drops a malformed dish rather than failing, and returns null for a missing venue or junk", () => {
    const x = parseKitchenMatrix({ venue: { slug: "drift", name: "D" }, dishes: [null, 4, { name: "No id" }, { id: "x" }, { id: "ok", name: "Ok" }] }, SYNCED)!;
    expect(x.dishes.map((y) => y.id)).toEqual(["ok"]);
    expect(parseKitchenMatrix(null, SYNCED)).toBeNull();
    expect(parseKitchenMatrix({ dishes: [] }, SYNCED)).toBeNull();
    expect(parseKitchenMatrix("x", SYNCED)).toBeNull();
    expect(parseKitchenMatrix({ venue: { slug: "drift" }, dishes: "nope" }, SYNCED)!.dishes).toEqual([]);
  });
});

describe("the iPad answers", () => {
  const rows = buildRows(parseKitchenMatrix(RAW, SYNCED)!.dishes);
  it("reads the signed-off burger, the GF salad and the unsigned special by the same rules as the costing app", () => {
    const [burger, salad, special] = rows;
    expect(cell(burger.dish, "dairy")).toMatchObject({ state: "yellow", note: "no aioli" });
    expect(cell(burger.dish, "eggs").state).toBe("red");
    expect(cell(burger.dish, "gluten_free")).toMatchObject({ state: "yellow", note: "Leave out Brioche Bun. Add Gluten Free Bun 1 ea, Tamari 15 ml. Check the sauce" });
    expect(cell(salad.dish, "gluten_free").state).toBe("green");
    expect(cell(salad.dish, "vegetarian").state).toBe("green");
    expect(cell(special.dish, "dairy").state).toBe("grey");
    expect(cell(special.dish, "vegetarian")).toMatchObject({ state: "yellow", note: "Hold the bacon" });
  });
  it("groups a column for the Guest Needs view", () => {
    const n = guestNeeds(rows, "dairy");
    expect(n.green.map((e) => e.row.dish.name)).toEqual(["Green Salad"]);
    expect(n.yellow.map((e) => e.row.dish.name)).toEqual(["Crispy Chicken Burger"]);
    expect(n.grey.map((e) => e.row.dish.name)).toEqual(["New Special"]);
    expect(n.red).toEqual([]);
    expect(GUEST_GROUPS).toHaveLength(4);
  });
  it("lists sections in the kitchen's menu order with a dish that has none under Other", () => {
    expect(matrixSections(rows).map((s) => s.label)).toEqual(["Bowls & Salads", "Burgers", "Other"]);
  });
});

describe("the public kitchen route", () => {
  it("stays public under /kitchen and its API, and only for kitchen venues", () => {
    expect(isKitchenPath("/kitchen/drift/matrix")).toBe(true);
    expect(isKitchenPath("/api/kitchen/drift/matrix")).toBe(true);
    expect(isKitchenPath("/matrix")).toBe(false);
    expect(isKitchenVenue("drift")).toBe(true);
    expect(isKitchenVenue("elsewhere")).toBe(false);
  });
  it("the service worker saves the matrix page and its feed (both sit under the station's scope)", () => {
    const sw = stationWorkerSource({ scope: "/kitchen", cachePrefix: "kitchen", photoPrefixes: [] });
    expect(sw).toContain("isStationPage");
    expect(sw).toContain('"/api" + SCOPE + "/"');
    const kiosk = readFileSync("components/kitchen/kiosk.tsx", "utf8");
    expect(kiosk).toContain("/kitchen/${venue}/matrix");
    expect(kiosk).toContain("/api/kitchen/${venue}/matrix");
  });
  it("the Kitchen home links to the matrix", () => {
    expect(readFileSync("components/kitchen/station.tsx", "utf8")).toContain("/kitchen/${slug}/matrix");
  });
});

describe("migration 20261010140000_kitchen_matrix.sql", () => {
  const sql = readFileSync("supabase/migrations/20261010140000_kitchen_matrix.sql", "utf8");
  it("is a narrow security definer function granted to the public iPad and nobody else", () => {
    expect(sql).toMatch(/create or replace function public\.cost_kitchen_matrix\(p_venue text\)/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(/revoke all on function public\.cost_kitchen_matrix\(text\) from public/);
    expect(sql).toMatch(/grant execute on function public\.cost_kitchen_matrix\(text\) to anon, authenticated/);
  });
  it("reads active Food dishes and is not gated by kitchen_ready", () => {
    expect(sql).toMatch(/mi\.active and mi\.category = 'Food'/);
    expect(sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")).not.toMatch(/kitchen_ready/);
  });
  it("never selects a price, cost, target, supplier or who signed off", () => {
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/comment on function[^;]*;/i, "");
    expect(code).not.toMatch(/surcharge|sell_price|hh_price|pack_price|target|supplier|confirmed_by|portal|cost_price|gp\b/i);
    expect(code).toMatch(/'confirmed_at'/);
  });
  it("is mirrored in supabase/schema.sql, with the column migration before it", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("create or replace function public.cost_kitchen_matrix(p_venue text)");
    expect(schema).toContain("add column if not exists dish_allergens jsonb");
    expect(schema.indexOf("add column if not exists dish_allergens")).toBeLessThan(schema.indexOf("function public.cost_kitchen_matrix"));
    const col = readFileSync("supabase/migrations/20261010130000_dish_allergens.sql", "utf8");
    expect(col).toMatch(/add column if not exists dish_allergens jsonb;/);
    expect(Number("20261010130000")).toBeLessThan(Number("20261010140000"));
  });
});

describe("kitchen matrix colours", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it("keeps every answer's text at AA on its fill and on both stripes of a hatched fill", () => {
    for (const [name, t] of Object.entries(MX)) {
      const fills = [t.bg, "stripe" in t ? t.stripe : null].filter((c): c is string => !!c);
      for (const bg of fills) expect({ name, bg, ok: ratio(t.fg, bg) >= 4.5 }).toEqual({ name, bg, ok: true });
    }
  });
  it("keeps every outline at 3:1 against the card", () => {
    for (const [name, t] of Object.entries(MX)) expect({ name, ok: ratio(t.edge, CARD_BG) >= 3 }).toEqual({ name, ok: true });
  });
  it("uses four different fills", () => {
    expect(new Set(Object.values(MX).map((t) => t.bg)).size).toBe(4);
  });
});

describe("kitchen matrix screen text", () => {
  it("has no em or en dashes in anything a cook reads", () => {
    for (const f of ["components/kitchen/matrix.tsx", "components/matrix/matrix-page.tsx", "components/matrix/parts.tsx", "components/matrix/print-view.tsx", "components/editor/dish-allergens.tsx"]) {
      const visible = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
        .join("\n");
      expect(visible, f).not.toMatch(/[–—]/);
    }
  });
});
