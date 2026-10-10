import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { buildIndex } from "@/lib/costing";
import { confirmAllergens, dishCheck, isSignOffValid, readDishAllergens } from "@/lib/dish-allergens";
import type { AllergenIndex } from "@/lib/allergens";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

/**
 * THE APP AND THE IPAD MUST AGREE (Troy, 10 Oct 2026, ingredient-first allergens). The app (lib/dish-allergens.ts) writes the
 * sign-off snapshot at Confirm and re-checks it live; the Kitchen Station feed (cost_kitchen_matrix, migration
 * 20261010180000) re-checks it in SQL. They were written separately, so this test runs BOTH on the same dish: it confirms in
 * TypeScript, stores exactly what the app would store in a real Postgres (PGlite), and asks the real SQL whether the iPad
 * counts it. Then it changes the data and checks both sides turn grey together, and come back together.
 */
const MIGRATIONS = path.resolve(__dirname, "../supabase/migrations");
const FILES = ["20261010160000_cross_contact_setting.sql", "20261010170000_kitchen_matrix_recheck.sql", "20261010180000_kitchen_matrix_ticks.sql"];
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I = (n: number) => u(100 + n);
const P = (n: number) => u(200 + n);
const DISH = u(301);
const NOW = "2026-10-10T03:00:00.000Z";

// the data, in the shape the database holds it (arrays unsorted on purpose, alcohol present, overrides on a nested prep and on the dish)
let ingredients: { id: string; allergens: string[]; reviewed: boolean }[];
let preps: { id: string; add: string[]; rem: string[] }[];
let dishAdd: string[];
let dishRem: string[];

const lines = (): RecipeLine[] => {
  const l = (parent: string, ptype: "item" | "prep", comp: string, ctype: "ingredient" | "prep"): RecipeLine => ({ id: `${parent}-${comp}`, parent_type: ptype, parent_id: parent, component_type: ctype, component_id: comp, qty: 1, unit: "g", note: null, sort: 0 }) as RecipeLine;
  return [l(DISH, "item", I(1), "ingredient"), l(DISH, "item", I(2), "ingredient"), l(DISH, "item", P(1), "prep"), l(P(1), "prep", I(3), "ingredient"), l(P(1), "prep", P(2), "prep"), l(P(2), "prep", I(4), "ingredient")];
};
const appIndex = (): { item: MenuItem; index: AllergenIndex } => {
  const ing = ingredients.map((i) => ({ id: i.id, name: `Ing ${i.id.slice(-3)}`, category: "Food", allergens: i.allergens, allergens_reviewed: i.reviewed, diet_flags: [], active: true }) as unknown as Ingredient);
  const pr = preps.map((p) => ({ id: p.id, name: `Prep ${p.id.slice(-3)}`, venue_id: 1, allergen_add: p.add, allergen_remove: p.rem, active: true }) as unknown as Prep);
  const item = { id: DISH, name: "Dish", venue_id: 1, category: "Food", section: "Mains", portions: 1, sell_price_inc: 20, active: true, allergen_add: dishAdd, allergen_remove: dishRem, dish_allergens: null } as unknown as MenuItem;
  return { item, index: { ...buildIndex(ing, pr, lines()), items: new Map([[DISH, item]]) } };
};

let db: PGlite;
const sync = async () => {
  for (const i of ingredients) await db.query("update cost_ingredients set allergens = $1, allergens_reviewed = $2 where id = $3", [i.allergens, i.reviewed, i.id]);
  for (const p of preps) await db.query("update cost_preps set allergen_add = $1, allergen_remove = $2 where id = $3", [p.add, p.rem, p.id]);
  await db.query("update cost_menu_items set allergen_add = $1, allergen_remove = $2 where id = $3", [dishAdd, dishRem, DISH]);
};
/** confirm in the app, store what it would store */
const confirmInApp = async () => {
  const { item, index } = appIndex();
  const c = dishCheck(item, index);
  const entry = confirmAllergens(null, "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
  await db.query("update cost_menu_items set dish_allergens = $1 where id = $2", [JSON.stringify(entry), DISH]);
  return entry;
};
const ipadSeesConfirmed = async (): Promise<boolean> => {
  const f = (await db.query("select cost_kitchen_matrix('drift') as f")).rows[0] as { f: { dishes: { id: string; dish_allergens: { confirmed_at?: string } | null }[] } };
  return !!f.f.dishes.find((d) => d.id === DISH)?.dish_allergens?.confirmed_at;
};
/** what the app says about the stored sign-off against the live data */
const appSaysValid = async (): Promise<boolean> => {
  const { item, index } = appIndex();
  const stored = (await db.query("select dish_allergens from cost_menu_items where id = $1", [DISH])).rows[0] as { dish_allergens: unknown };
  const c = dishCheck(item, index);
  return isSignOffValid(readDishAllergens(stored.dish_allergens), c.live);
};
/** both sides must give the same answer */
const agree = async (expected: boolean) => {
  await sync();
  expect(await appSaysValid(), "app").toBe(expected);
  expect(await ipadSeesConfirmed(), "ipad").toBe(expected);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create table cost_venues (id integer primary key, slug text, name text);
    create table cost_settings (key text primary key, value numeric not null);
    create table cost_ingredients (id uuid primary key, name text, allergens text[] not null default '{}', allergens_reviewed boolean not null default false);
    create table cost_preps (id uuid primary key, name text, allergen_add text[] not null default '{}', allergen_remove text[] not null default '{}');
    create table cost_menu_items (id uuid primary key, name text, venue_id integer, category text, section text, active boolean default true,
      dish_allergens jsonb, diet_options jsonb, allergen_add text[] not null default '{}', allergen_remove text[] not null default '{}');
    create table cost_recipe_lines (id uuid primary key default gen_random_uuid(), parent_type text, parent_id uuid, component_type text, component_id uuid,
      qty numeric default 1, unit text default 'g', note text, sort int default 0);
    insert into cost_venues values (1, 'drift', 'Drift Bar');
  `);
  for (const f of FILES) await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  ingredients = [
    { id: I(1), allergens: ["milk", "gluten"], reviewed: true },
    { id: I(2), allergens: ["alcohol"], reviewed: true },
    { id: I(3), allergens: ["soy", "sesame"], reviewed: true },
    { id: I(4), allergens: [], reviewed: true },
  ];
  preps = [
    { id: P(1), add: [], rem: [] },
    { id: P(2), add: ["egg"], rem: ["onion_garlic", "chilli"] },
  ];
  dishAdd = [];
  dishRem = [];
  for (const i of ingredients) await db.query("insert into cost_ingredients (id, name) values ($1,'x')", [i.id]);
  for (const p of preps) await db.query("insert into cost_preps (id, name) values ($1,'x')", [p.id]);
  await db.query("insert into cost_menu_items (id, name, venue_id, category, section, active) values ($1,'Dish',1,'Food','Mains',true)", [DISH]);
  for (const l of lines()) await db.query("insert into cost_recipe_lines (parent_type, parent_id, component_type, component_id) values ($1,$2,$3,$4)", [l.parent_type, l.parent_id, l.component_type, l.component_id]);
  await sync();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the app's sign-off and the iPad's SQL agree, on the same dish", () => {
  it("what the app stores at Confirm is what the iPad counts as confirmed", async () => {
    const entry = await confirmInApp();
    // sorted, alcohol left out, the nested prep's override counted
    expect(entry.contains).toEqual(["gluten", "egg", "milk", "sesame", "soy"]);
    await agree(true);
  });

  it("an ingredient tick changes: both turn grey, and both come back when it is put back", async () => {
    ingredients[0].allergens = ["milk", "gluten", "egg"];
    await agree(false);
    ingredients[0].allergens = ["milk", "gluten"];
    await agree(true);
  });

  it("alcohol is ignored by both", async () => {
    ingredients[1].allergens = [];
    await agree(true);
    ingredients[1].allergens = ["alcohol"];
    await agree(true);
  });

  it("an ingredient becomes unreviewed: both grey", async () => {
    ingredients[2].reviewed = false;
    await agree(false);
    ingredients[2].reviewed = true;
    await agree(true);
  });

  it("a nested prep's override changes: both grey", async () => {
    preps[1].rem = ["onion_garlic"];
    await agree(false);
    preps[1].rem = ["onion_garlic", "chilli"];
    await agree(true);
  });

  it("the dish's own override changes: both grey", async () => {
    dishAdd = ["lupin"];
    await agree(false);
    dishAdd = [];
    await agree(true);
  });

  it("a sign-off with no ticks is grey on both sides", async () => {
    const row = (await db.query("select dish_allergens from cost_menu_items where id = $1", [DISH])).rows[0] as { dish_allergens: Record<string, unknown> };
    const { ticks: _t, ...rest } = row.dish_allergens;
    void _t;
    await db.query("update cost_menu_items set dish_allergens = $1 where id = $2", [JSON.stringify(rest), DISH]);
    await agree(false);
    await confirmInApp();
    await agree(true);
  });
});
