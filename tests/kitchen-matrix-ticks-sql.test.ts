import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { CONTAINS_IDS } from "@/lib/allergens";

/**
 * cost_kitchen_matrix, ingredient-first re-check (migration 20261010180000_kitchen_matrix_ticks.sql).
 *
 * Runs the real migration SQL against a real Postgres (PGlite, in memory) with a stub schema holding only the columns the
 * function reads. Nothing here touches the live database.
 *
 * THE SNAPSHOT FORMAT (dish_allergens.ticks, must match lib/dish-allergens.ts and the SQL exactly):
 *   "ingredient:<id>": { a: [...], r: boolean }      a = the ingredient's allergens limited to the 15 main ids, r = allergens_reviewed
 *   "prep:<id>":       { add: [...], rem: [...] }    allergen_add / allergen_remove limited to the 15 main ids
 *   "item:<dishId>":   { add: [...], rem: [...] }    the dish itself
 * Every id array is in the fixed CONTAINS_IDS order and is [] when empty; "alcohol" is never in it. jsonb equality ignores key
 * order but not array order, so the stored arrays must be in that order. The snapshots below are written out by hand.
 */

const MIGRATIONS = path.resolve(__dirname, "../supabase/migrations");
const FILES = ["20261010160000_cross_contact_setting.sql", "20261010170000_kitchen_matrix_recheck.sql", "20261010180000_kitchen_matrix_ticks.sql"];
const sql = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I = (n: number) => u(100 + n);
const P = (n: number) => u(200 + n);
const D = (n: number) => u(300 + n);
const AT = "2026-10-10T03:00:00Z";

let db: PGlite;
const rows = async (q: string, params: unknown[] = []) => (await db.query(q, params)).rows as Record<string, any>[];
const feed = async (slug = "drift") => (await rows("select cost_kitchen_matrix($1) as f", [slug]))[0].f;
const entry = async (n: number) => (await feed()).dishes.find((d: any) => d.id === D(n));
/** the sign-off time the iPad would show: present only while the sign-off is valid */
const signedAt = async (n: number) => (await entry(n)).dish_allergens?.confirmed_at ?? null;

const line = (parentType: string, parent: string, type: string, comp: string) =>
  db.query("insert into cost_recipe_lines (parent_type, parent_id, component_type, component_id) values ($1,$2,$3,$4)", [parentType, parent, type, comp]);
const setAllergens = (n: number, allergens: string[], reviewed = true) =>
  db.query("update cost_ingredients set allergens = $1, allergens_reviewed = $2 where id = $3", [allergens, reviewed, I(n)]);
const setPrep = (n: number, add: string[], rem: string[]) => db.query("update cost_preps set allergen_add = $1, allergen_remove = $2 where id = $3", [add, rem, P(n)]);
const setDish = (n: number, add: string[], rem: string[]) => db.query("update cost_menu_items set allergen_add = $1, allergen_remove = $2 where id = $3", [add, rem, D(n)]);
const setSection = (n: number, da: unknown) => db.query("update cost_menu_items set dish_allergens = $1 where id = $2", [JSON.stringify(da), D(n)]);

/** the fixture dish: ingredients 1 and 2 directly, prep 1 (ingredient 3 and prep 2 (ingredient 4)) */
const COMPONENTS = [`ingredient:${I(1)}`, `ingredient:${I(2)}`, `ingredient:${I(3)}`, `ingredient:${I(4)}`, `prep:${P(1)}`, `prep:${P(2)}`];
const TICKS = () => ({
  [`ingredient:${I(1)}`]: { a: ["gluten", "milk"], r: true }, // stored in the DB as {milk, gluten}: the snapshot is in the fixed order
  [`ingredient:${I(2)}`]: { a: [], r: true }, // the DB holds only {alcohol}: alcohol is never part of the snapshot
  [`ingredient:${I(3)}`]: { a: ["sesame", "soy"], r: true }, // stored as {soy, sesame},
  [`ingredient:${I(4)}`]: { a: [], r: true },
  [`prep:${P(1)}`]: { add: [], rem: [] },
  [`prep:${P(2)}`]: { add: ["egg"], rem: ["chilli", "onion_garlic"] },
  [`item:${D(1)}`]: { add: [], rem: [] },
});
const sign = (ticks: unknown, over: Record<string, unknown> = {}) => ({
  contains: ["gluten", "milk", "sesame", "soy", "egg"],
  without: {},
  confirmed_at: AT,
  confirmed_by: "chef@example.com",
  components: COMPONENTS,
  ticks,
  ...over,
});

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
  // apply the whole chain, then the new migration a second time: it must replace cleanly and be idempotent
  for (const f of FILES) await db.exec(sql(f));
  await db.exec(sql(FILES[2]));

  for (let k = 1; k <= 6; k++) {
    await db.query("insert into cost_ingredients (id, name, allergens_reviewed) values ($1,$2,true)", [I(k), `Ing ${k}`]);
    await db.query("insert into cost_preps (id, name) values ($1,$2)", [P(k), `Prep ${k}`]);
  }
  await db.query("update cost_ingredients set allergens = '{milk,gluten}' where id = $1", [I(1)]); // unsorted on purpose
  await db.query("update cost_ingredients set allergens = '{alcohol}' where id = $1", [I(2)]);
  await db.query("update cost_ingredients set allergens = '{soy,sesame}' where id = $1", [I(3)]);
  await db.query("update cost_preps set allergen_add = '{egg}', allergen_remove = '{onion_garlic,chilli}' where id = $1", [P(2)]);

  await line("item", D(1), "ingredient", I(1));
  await line("item", D(1), "ingredient", I(2));
  await line("item", D(1), "prep", P(1));
  await line("prep", P(1), "ingredient", I(3));
  await line("prep", P(1), "prep", P(2));
  await line("prep", P(2), "ingredient", I(4));
  await db.query("insert into cost_menu_items (id, name, venue_id, category, section, active) values ($1,'Signed Dish',1,'Food','Mains',true)", [D(1)]);
  await setSection(1, sign(TICKS()));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("cost_kitchen_matrix ingredient-first re-check (real Postgres via PGlite)", () => {
  it("the SQL's main allergen list is exactly CONTAINS_IDS, in order (the TypeScript list wins)", () => {
    const m = sql(FILES[2]).match(/array\[((?:'[a-z_]+',?\s*)+)\]\)\s+with ordinality/);
    expect(m).not.toBeNull();
    const ids = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(ids).toEqual([...CONTAINS_IDS]);
    expect(ids).not.toContain("alcohol");
  });

  it("1. valid when the components and the ticks both match (sorted, alcohol left out)", async () => {
    expect(await signedAt(1)).toBe(AT);
    const e = await entry(1);
    expect(e.dish_allergens.contains).toEqual(["gluten", "milk", "sesame", "soy", "egg"]);
  });

  it("never sends who signed, the components, the ticks or any price", async () => {
    const text = JSON.stringify(await feed());
    expect(text).not.toMatch(/chef@example|confirmed_by|components|ticks|price|surcharge/);
  });

  it("8. amounts changing does not invalidate", async () => {
    await db.query("update cost_recipe_lines set qty = 99 where parent_id = $1", [D(1)]);
    await db.query("update cost_recipe_lines set qty = 42, unit = 'ml' where parent_id = $1", [P(1)]);
    expect(await signedAt(1)).toBe(AT);
  });

  it("2. grey when an ingredient's allergens change (added, removed, then back)", async () => {
    await setAllergens(1, ["milk", "gluten", "egg"]);
    expect(await signedAt(1)).toBeNull();
    await setAllergens(1, ["milk"]);
    expect(await signedAt(1)).toBeNull();
    await setAllergens(1, ["milk", "gluten"]);
    expect(await signedAt(1)).toBe(AT); // the sign-off was never deleted: put the tick back and it is valid again
  });

  it("2b. an ingredient allergen outside the 15 main ids (alcohol) is not part of the snapshot", async () => {
    await setAllergens(2, []);
    expect(await signedAt(1)).toBe(AT);
    await setAllergens(2, ["alcohol"]);
    expect(await signedAt(1)).toBe(AT);
  });

  it("2c. a tick change deep inside a nested prep's ingredient also turns the dish grey", async () => {
    await setAllergens(4, ["lupin"]);
    expect(await signedAt(1)).toBeNull();
    await setAllergens(4, []);
    expect(await signedAt(1)).toBe(AT);
  });

  it("3. grey when an ingredient's allergens_reviewed becomes false, and a stored r:false never counts as valid", async () => {
    await setAllergens(3, ["soy", "sesame"], false);
    expect(await signedAt(1)).toBeNull();
    await setAllergens(3, ["soy", "sesame"], true);
    expect(await signedAt(1)).toBe(AT);

    // fail safe: even a snapshot that says r:false for an unreviewed ingredient and equals the live data is NOT valid
    await setAllergens(4, [], false);
    const forged = TICKS() as Record<string, any>;
    forged[`ingredient:${I(4)}`] = { a: [], r: false };
    await setSection(1, sign(forged));
    expect(await signedAt(1)).toBeNull();
    await setAllergens(4, [], true);
    await setSection(1, sign(TICKS()));
    expect(await signedAt(1)).toBe(AT);
  });

  it("4. grey when a nested prep's allergen_add or allergen_remove changes", async () => {
    await setPrep(2, ["egg", "fish"], ["onion_garlic", "chilli"]);
    expect(await signedAt(1)).toBeNull();
    await setPrep(2, ["egg"], ["onion_garlic"]);
    expect(await signedAt(1)).toBeNull();
    await setPrep(2, ["egg"], ["onion_garlic", "chilli"]);
    expect(await signedAt(1)).toBe(AT);
    // the top level prep too
    await setPrep(1, ["milk"], []);
    expect(await signedAt(1)).toBeNull();
    await setPrep(1, [], []);
    expect(await signedAt(1)).toBe(AT);
  });

  it("5. grey when the dish's own allergen_add or allergen_remove changes", async () => {
    await setDish(1, ["fish"], []);
    expect(await signedAt(1)).toBeNull();
    await setDish(1, [], ["milk"]);
    expect(await signedAt(1)).toBeNull();
    await setDish(1, ["alcohol"], []); // alcohol is not in the snapshot, so it changes nothing
    expect(await signedAt(1)).toBe(AT);
    await setDish(1, [], []);
    expect(await signedAt(1)).toBe(AT);
  });

  it("6. grey when a component is swapped, added or removed (as before)", async () => {
    await db.query("update cost_recipe_lines set component_id = $1 where parent_id = $2 and component_id = $3", [I(5), D(1), I(2)]);
    expect(await signedAt(1)).toBeNull();
    await db.query("update cost_recipe_lines set component_id = $1 where parent_id = $2 and component_id = $3", [I(2), D(1), I(5)]);
    expect(await signedAt(1)).toBe(AT);
    await line("prep", P(2), "ingredient", I(6)); // a new ingredient deep in the nesting
    expect(await signedAt(1)).toBeNull();
    await db.query("delete from cost_recipe_lines where parent_id = $1 and component_id = $2", [P(2), I(6)]);
    expect(await signedAt(1)).toBe(AT);
  });

  it("7. grey with no ticks, ticks that are not an object, or a missing ticks entry", async () => {
    const { ticks: _t, ...noTicks } = sign(TICKS());
    await setSection(1, noTicks);
    expect(await signedAt(1)).toBeNull();
    expect((await entry(1)).dish_allergens.contains).toEqual(["gluten", "milk", "sesame", "soy", "egg"]); // the lists still come through
    await setSection(1, sign("nope"));
    expect(await signedAt(1)).toBeNull();
    await setSection(1, sign([]));
    expect(await signedAt(1)).toBeNull();
    const missing = TICKS() as Record<string, any>;
    delete missing[`prep:${P(2)}`];
    await setSection(1, sign(missing));
    expect(await signedAt(1)).toBeNull();
    const extra = { ...TICKS(), [`ingredient:${I(6)}`]: { a: [], r: true } };
    await setSection(1, sign(extra));
    expect(await signedAt(1)).toBeNull();
    await setSection(1, sign(TICKS()));
    expect(await signedAt(1)).toBe(AT);
  });

  it("9. array order matters: ids stored out of the fixed order do not match (the app must write CONTAINS_IDS order)", async () => {
    const wrongOrder = TICKS() as Record<string, any>;
    wrongOrder[`ingredient:${I(1)}`] = { a: ["milk", "gluten"], r: true };
    await setSection(1, sign(wrongOrder));
    expect(await signedAt(1)).toBeNull();
    const wrongPrep = TICKS() as Record<string, any>;
    wrongPrep[`prep:${P(2)}`] = { add: ["egg"], rem: ["onion_garlic", "chilli"] };
    await setSection(1, sign(wrongPrep));
    expect(await signedAt(1)).toBeNull();
    // key order in the object is irrelevant
    const reordered = Object.fromEntries(Object.entries(TICKS()).reverse());
    await setSection(1, sign(reordered));
    expect(await signedAt(1)).toBe(AT);
    await setSection(1, sign(TICKS()));
  });

  it("a legacy sign-off (components but no ticks), a component mismatch with matching ticks, and a missing confirmed_at are all grey", async () => {
    await setSection(1, sign(TICKS(), { components: COMPONENTS.slice(1) }));
    expect(await signedAt(1)).toBeNull();
    await setSection(1, sign(TICKS(), { confirmed_at: null }));
    expect(await signedAt(1)).toBeNull();
    await setSection(1, sign(TICKS(), { components: "nope" }));
    expect(await signedAt(1)).toBeNull();
    await setSection(1, sign(TICKS()));
    expect(await signedAt(1)).toBe(AT);
  });

  it("a dish with no lines: the snapshot is just the dish itself", async () => {
    await db.query("insert into cost_menu_items (id, name, venue_id, category, section, active, dish_allergens) values ($1,'Empty Dish',1,'Food','Mains',true,$2)", [
      D(2),
      JSON.stringify({ contains: [], without: {}, confirmed_at: AT, components: [], ticks: { [`item:${D(2)}`]: { add: [], rem: [] } } }),
    ]);
    expect(await signedAt(2)).toBe(AT);
    await db.query("update cost_menu_items set allergen_add = '{milk}' where id = $1", [D(2)]);
    expect(await signedAt(2)).toBeNull();
  });

  it("keeps the rest of the feed: venue, cross_contact, unknown venue, only active Food dishes", async () => {
    expect((await feed()).venue).toEqual({ slug: "drift", name: "Drift Bar" });
    expect((await feed()).cross_contact).toBeNull();
    await db.query("insert into cost_settings (key, value, text_value) values ('cross_contact_drift', 0, '  Shared fryer.  ')");
    expect((await feed()).cross_contact).toBe("Shared fryer.");
    await db.query("insert into cost_menu_items (id, name, venue_id, category, active) values ($1,'Off',1,'Food',false), ($2,'Drink',1,'Cocktail',true)", [D(8), D(9)]);
    const names = (await feed()).dishes.map((d: any) => d.name);
    expect(names).not.toContain("Off");
    expect(names).not.toContain("Drink");
    expect((await rows("select cost_kitchen_matrix('nope') as f"))[0].f).toBeNull();
  });

  it("is replaced, not duplicated: one function, still executable by the public iPad roles", async () => {
    const fn = await rows("select count(*)::int as n from pg_proc where proname = 'cost_kitchen_matrix'");
    expect(fn[0].n).toBe(1);
    const grants = await rows(
      "select has_function_privilege('anon', 'public.cost_kitchen_matrix(text)', 'execute') as anon, has_function_privilege('authenticated', 'public.cost_kitchen_matrix(text)', 'execute') as auth",
    );
    expect(grants[0]).toEqual({ anon: true, auth: true });
  });

  it("schema.sql mirrors the new function body exactly once", () => {
    const schema = readFileSync(path.resolve(__dirname, "../supabase/schema.sql"), "utf8");
    expect(schema.match(/create or replace function public\.cost_kitchen_matrix/g)?.length).toBe(1);
    expect(schema).toContain(sql(FILES[2]));
    expect(schema).not.toContain(sql(FILES[1]));
  });
});
