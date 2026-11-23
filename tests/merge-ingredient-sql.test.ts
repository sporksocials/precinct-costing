import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { SNAPSHOT_ALLERGEN_IDS } from "@/lib/allergens";
import { buildIndex } from "@/lib/costing";
import { confirmAllergens, dishCheck, isSignOffValid, readDishAllergens } from "@/lib/dish-allergens";
import { carrySignOff, planMerge, scaledPacks } from "@/lib/merge-ingredient";
import type { AllergenIndex } from "@/lib/allergens";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

/**
 * cost_merge_ingredient (migration 20261123100000_merge_ingredient.sql), the one atomic write behind Merge Into Another Ingredient.
 *
 * Runs the real migration SQL against a real Postgres (PGlite, in memory) with a stub schema holding only the columns the function
 * reads and writes. Nothing here touches the live database. The allergen sign-off cases ask BOTH judges whether a dish still counts
 * after the merge: the Kitchen iPad's real SQL (cost_kitchen_matrix) and the app's own rule (lib/dish-allergens.ts), and check the
 * app's plan (planMerge) said the same thing beforehand.
 */
const MIGRATIONS = path.resolve(__dirname, "../supabase/migrations");
const MATRIX = ["20261010160000_cross_contact_setting.sql", "20261010170000_kitchen_matrix_recheck.sql", "20261010180000_kitchen_matrix_ticks.sql", "20261107100000_allergen_onion_garlic_split.sql"];
const MERGE = "20261123100000_merge_ingredient.sql";
const sql = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I = (n: number) => u(100 + n);
const P = (n: number) => u(200 + n);
const D = (n: number) => u(300 + n);
const X = (n: number) => u(900 + n);
const NOW = "2026-11-23T03:00:00.000Z";
/** the two ingredients of most cases: the one merged away and the one kept */
const S = I(1);
const T = I(2);

let db: PGlite;
const rows = async (q: string, params: unknown[] = []) => (await db.query(q, params)).rows as Record<string, any>[];
const one = async (q: string, params: unknown[] = []) => (await rows(q, params))[0];
const merge = async (s = S, t = T) => (await one("select cost_merge_ingredient($1, $2) as r", [s, t])).r as Record<string, any>;
const refusal = async (s: string, t: string): Promise<string> => {
  try {
    await merge(s, t);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};
const ing = (id: string, name: string, over: { size?: number; unit?: string; allergens?: string[]; reviewed?: boolean; active?: boolean; price?: number } = {}) =>
  db.query("insert into cost_ingredients (id, name, pack_size, pack_unit, pack_price, active, allergens, allergens_reviewed) values ($1,$2,$3,$4,$5,$6,$7,$8)", [
    id,
    name,
    over.size ?? 1,
    over.unit ?? "L",
    over.price ?? 8.75,
    over.active ?? true,
    over.allergens ?? ["sulphites"],
    over.reviewed ?? true,
  ]);
const line = (parentType: "item" | "prep", parent: string, type: "ingredient" | "prep", comp: string, unit = "ml") =>
  db.query("insert into cost_recipe_lines (parent_type, parent_id, component_type, component_id, unit) values ($1,$2,$3,$4,$5)", [parentType, parent, type, comp, unit]);
const dish = (n: number, name: string) => db.query("insert into cost_menu_items (id, name, venue_id, category, section, active) values ($1,$2,1,'Food','Mains',true)", [D(n), name]);

/** the database as the app would hold it */
async function appData(): Promise<{ ingredients: Ingredient[]; preps: Prep[]; items: MenuItem[]; lines: RecipeLine[] }> {
  const ingredients = (await rows("select * from cost_ingredients")).map((r) => ({ ...r, pack_size: Number(r.pack_size), pack_price: Number(r.pack_price), category: "Food", rebate: 0, yield_pct: 1, gst_free: false, price_inc_gst: false, diet_flags: [] }) as unknown as Ingredient);
  const preps = (await rows("select * from cost_preps")).map((r) => ({ ...r, venue_id: 1, active: true }) as unknown as Prep);
  const items = (await rows("select * from cost_menu_items")).map((r) => ({ ...r, portions: 1, sell_price_inc: 20 }) as unknown as MenuItem);
  const lines = (await rows("select * from cost_recipe_lines")).map((r) => ({ ...r, qty: Number(r.qty) }) as unknown as RecipeLine);
  return { ingredients, preps, items, lines };
}
const indexOf = (d: Awaited<ReturnType<typeof appData>>): AllergenIndex => ({ ...buildIndex(d.ingredients, d.preps, d.lines), items: new Map(d.items.map((i) => [i.id, i])) });
/** confirm a dish in the app and store exactly what the app would store */
async function confirmInApp(n: number) {
  const d = await appData();
  const item = d.items.find((i) => i.id === D(n))!;
  const c = dishCheck(item, indexOf(d));
  expect(c.blocked, "the fixture dish must be confirmable").toBe(false);
  const entry = confirmAllergens(item.dish_allergens, "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
  await db.query("update cost_menu_items set dish_allergens = $1 where id = $2", [JSON.stringify(entry), D(n)]);
  return entry;
}
const ipadSeesConfirmed = async (n: number): Promise<boolean> => {
  const f = (await one("select cost_kitchen_matrix('drift') as f")).f as { dishes: { id: string; dish_allergens: { confirmed_at?: string } | null }[] };
  return !!f.dishes.find((x) => x.id === D(n))?.dish_allergens?.confirmed_at;
};
const appSaysValid = async (n: number): Promise<boolean> => {
  const d = await appData();
  const item = d.items.find((i) => i.id === D(n))!;
  return isSignOffValid(readDishAllergens(item.dish_allergens), dishCheck(item, indexOf(d)).live);
};
/** both judges, which must agree */
const confirmed = async (n: number): Promise<boolean> => {
  const [app, ipad] = [await appSaysValid(n), await ipadSeesConfirmed(n)];
  expect(app, "the app and the iPad must agree").toBe(ipad);
  return app;
};
const planFor = async (s = S, t = T) => {
  const d = await appData();
  return planMerge(d.ingredients.find((i) => i.id === s)!, d.ingredients.find((i) => i.id === t)!, { ...d, gst: 0.1, orderProducts: [], venues: [{ id: 1, name: "Drift" }] });
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create table cost_venues (id integer primary key, slug text, name text);
    create table cost_settings (key text primary key, value numeric not null);
    create table cost_ingredients (id uuid primary key, name text not null unique, pack_size numeric not null default 1, pack_unit text not null default 'kg',
      pack_price numeric not null default 0, active boolean not null default true, supplier_id integer, allergens text[] not null default '{}',
      allergens_reviewed boolean not null default false, diet_flags text[] not null default '{}');
    create table cost_preps (id uuid primary key, name text, allergen_add text[] not null default '{}', allergen_remove text[] not null default '{}');
    create table cost_menu_items (id uuid primary key, name text, venue_id integer, category text, section text, active boolean default true,
      dish_allergens jsonb, diet_options jsonb, allergen_add text[] not null default '{}', allergen_remove text[] not null default '{}');
    create table cost_recipe_lines (id uuid primary key default gen_random_uuid(), parent_type text, parent_id uuid, component_type text, component_id uuid,
      qty numeric default 1, unit text default 'g', note text, sort int default 0);
    create table cost_gelato_serve_lines (id uuid primary key default gen_random_uuid(), serve_id uuid, ingredient_id uuid not null, qty numeric default 1, unit text not null default 'each');
    create table cost_beers (id uuid primary key default gen_random_uuid(), name text, ingredient_id uuid);
    create table cost_ingredient_deals (id uuid primary key default gen_random_uuid(), ingredient_id uuid not null, kind text);
    create table ordering_products (id uuid primary key default gen_random_uuid(), venue_id integer not null, name text, active boolean not null default true,
      ingredient_id uuid, costing_packs_per_unit numeric check (costing_packs_per_unit is null or costing_packs_per_unit > 0));
    create table invoice_item_map (id uuid primary key default gen_random_uuid(), supplier_id uuid not null, venue_id integer, item_code text, desc_key text,
      ingredient_id uuid, product_id uuid, packs_per_unit numeric(14, 4) check (packs_per_unit is null or packs_per_unit > 0), rejected boolean not null default false);
    create unique index invoice_item_map_key
      on invoice_item_map (supplier_id, coalesce(venue_id, 0), coalesce(item_code, ''), coalesce(desc_key, ''),
        coalesce(ingredient_id, '00000000-0000-0000-0000-000000000000'), coalesce(product_id, '00000000-0000-0000-0000-000000000000'));
    create table invoice_documents (id uuid primary key default gen_random_uuid(), status text not null default 'needs_review', analysis_version integer not null default 0);
    create table invoice_lines (id uuid primary key default gen_random_uuid(), document_id uuid, ingredient_id uuid, map_id uuid, state text not null default 'open');
    create table invoice_questions (id uuid primary key default gen_random_uuid(), status text not null default 'open', options jsonb not null default '[]'::jsonb);
    create table cost_research_notes (id uuid primary key default gen_random_uuid(), status text not null default 'open', changes jsonb not null default '[]'::jsonb);
    insert into cost_venues values (1, 'drift', 'Drift Bar'), (2, 'chiobu', 'Chiobu');
  `);
  for (const f of MATRIX) await db.exec(sql(f));
  // the migration twice: it must replace cleanly
  await db.exec(sql(MERGE));
  await db.exec(sql(MERGE));
}, 60_000);

beforeEach(async () => {
  await db.exec(`truncate cost_ingredients, cost_preps, cost_menu_items, cost_recipe_lines, cost_gelato_serve_lines, cost_beers, cost_ingredient_deals,
    ordering_products, invoice_item_map, invoice_documents, invoice_lines, invoice_questions, cost_research_notes;`);
  // the same product entered twice, in different pack sizes, with the same allergen ticks
  await ing(S, "Lime Juice (L)", { size: 1 });
  await ing(T, "Lime Juice (2L)", { size: 2, price: 17.5 });
  await ing(I(3), "Flour", { unit: "kg", allergens: ["gluten"] });
  await ing(I(4), "Butter", { unit: "kg", allergens: ["milk"] });
  await db.query("insert into cost_preps (id, name) values ($1,'Lime Dressing')", [P(1)]);
  // dish 1 uses the source directly; dish 2 uses it inside a prep; dish 3 does not use it
  await dish(1, "Fish Tacos");
  await dish(2, "Green Salad");
  await dish(3, "Shortbread");
  await line("item", D(1), "ingredient", S);
  await line("item", D(1), "ingredient", I(3), "g");
  await line("item", D(2), "prep", P(1), "g");
  await line("prep", P(1), "ingredient", S, "L");
  await line("item", D(3), "ingredient", I(3), "g");
  await line("item", D(3), "ingredient", I(4), "g");
});

afterAll(async () => {
  await db?.close();
});

describe("the migration itself", () => {
  const text = sql(MERGE);
  it("the snapshot id list is exactly SNAPSHOT_ALLERGEN_IDS, in order, and the same list cost_kitchen_matrix uses", () => {
    const m = text.match(/snap_ids constant text\[\] := array\[((?:'[a-z_]+',?\s*)+)\];/);
    expect(m).not.toBeNull();
    const ids = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(ids).toEqual([...SNAPSHOT_ALLERGEN_IDS]);
    const k = sql(MATRIX[3]).match(/array\[((?:'[a-z_]+',?\s*)+)\]\)\s+with ordinality/);
    expect([...k![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual(ids);
  });
  it("is one SECURITY INVOKER function with a fixed search path, granted to signed-in people only", () => {
    expect(text.match(/create or replace function/g)?.length).toBe(1);
    expect(text).toMatch(/security invoker/);
    expect(text).not.toMatch(/security definer/);
    expect(text).toMatch(/set search_path = public/);
    expect(text).toMatch(/revoke all on function public\.cost_merge_ingredient\(uuid, uuid\) from public, anon;/);
    expect(text).toMatch(/grant execute on function public\.cost_merge_ingredient\(uuid, uuid\) to authenticated;/);
  });
  it("never deletes a row and never writes a price", () => {
    const body = text.slice(text.indexOf("as $$"), text.lastIndexOf("$$;"));
    const code = body.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\bdrop\b/i);
    expect(code).not.toMatch(/\b(pack_price|previous_price|price_inc_gst|sell_price_inc|allergens\s*=|diet_flags\s*=|allergens_reviewed\s*=)/i);
    // the only thing written to an ingredient is the source's name and active flag
    expect(code.match(/update cost_ingredients[^;]*;/g)).toEqual(["update cost_ingredients set active = false, name = new_name where id = p_source;"]);
  });
  it("is mirrored at the end of supabase/schema.sql", () => {
    const schema = readFileSync(path.resolve(__dirname, "../supabase/schema.sql"), "utf8");
    const fn = text.slice(text.indexOf("create or replace function public.cost_merge_ingredient"));
    expect(schema.trimEnd().endsWith(fn.trimEnd())).toBe(true);
  });
});

describe("cost_merge_ingredient moves everything that points at the source (real Postgres via PGlite)", () => {
  it("recipe lines in dishes and preps move, the source is renamed and made inactive, and no price or target field changes", async () => {
    const before = await one("select * from cost_ingredients where id = $1", [T]);
    const r = await merge();
    expect(r.lines).toBe(2);
    expect(r.recipes).toBe(2);
    expect(await rows("select 1 from cost_recipe_lines where component_id = $1", [S])).toHaveLength(0);
    expect(await rows("select 1 from cost_recipe_lines where component_type = 'ingredient' and component_id = $1", [T])).toHaveLength(2);
    // other lines are untouched
    expect(Number((await one("select count(*) as n from cost_recipe_lines")).n)).toBe(6);
    const src = await one("select * from cost_ingredients where id = $1", [S]);
    expect(src.name).toBe("Lime Juice (L) (merged)");
    expect(r.merged_name).toBe("Lime Juice (L) (merged)");
    expect(src.active).toBe(false);
    expect(Number(src.pack_price)).toBe(8.75);
    expect(await one("select * from cost_ingredients where id = $1", [T])).toEqual(before);
  });

  it("gelato serve lines and tap beer kegs move too", async () => {
    await ing(I(10), "Cup Old", { unit: "each" });
    await ing(I(11), "Cup", { unit: "each" });
    await db.query("insert into cost_gelato_serve_lines (serve_id, ingredient_id, unit) values ($1,$2,'each')", [X(1), I(10)]);
    await db.query("insert into cost_beers (name, ingredient_id) values ('Tap A',$1), ('Tap B',$2)", [I(10), I(11)]);
    const r = await merge(I(10), I(11));
    expect(r.serve_lines).toBe(1);
    expect(r.beers).toBe(1);
    expect(await rows("select 1 from cost_gelato_serve_lines where ingredient_id = $1", [I(11)])).toHaveLength(1);
    expect(await rows("select 1 from cost_beers where ingredient_id = $1", [I(11)])).toHaveLength(2);
  });

  it("is safe when nothing points at the source", async () => {
    await ing(I(20), "Spare Juice");
    const r = await merge(I(20), T);
    expect(r).toMatchObject({ lines: 0, recipes: 0, order_items: 0, deals: 0, invoice_maps: 0, signoffs_carried: 0, signoffs_left: 0 });
    expect((await one("select name, active from cost_ingredients where id = $1", [I(20)]))).toEqual({ name: "Spare Juice (merged)", active: false });
  });

  it("the merged name stays unique", async () => {
    await ing(I(21), "Lime Juice (L) (merged)", { active: false });
    const r = await merge();
    expect(r.merged_name).toBe("Lime Juice (L) (merged 2)");
    // an ingredient that was already merged once keeps its name when it is merged again
    await db.query("update cost_ingredients set active = true where id = $1", [I(21)]);
    expect((await merge(I(21), T)).merged_name).toBe("Lime Juice (L) (merged)");
  });
});

describe("refusals: nothing is written", () => {
  const untouched = async () => {
    expect(await rows("select 1 from cost_recipe_lines where component_id = $1", [S])).toHaveLength(2);
    expect((await one("select name, active from cost_ingredients where id = $1", [S]))).toEqual({ name: "Lime Juice (L)", active: true });
  };
  it("source = target", async () => {
    expect(await refusal(S, S)).toMatch(/cannot be merged into itself/);
    await untouched();
  });
  it("either one missing", async () => {
    expect(await refusal(X(50), T)).toMatch(/ingredient to merge was not found/);
    expect(await refusal(S, X(50))).toMatch(/ingredient to keep was not found/);
    await untouched();
  });
  it("an inactive target", async () => {
    await db.query("update cost_ingredients set active = false where id = $1", [T]);
    expect(await refusal(S, T)).toMatch(/Lime Juice \(2L\) is inactive/);
    await untouched();
  });
  it("different kinds of unit (never kg to L), and the plan refuses the same merge", async () => {
    expect(await refusal(S, I(3))).toMatch(/priced per L and Flour per kg\. They are different kinds of unit/);
    await untouched();
    const plan = await planFor(S, I(3));
    expect(plan.canMerge).toBe(false);
    expect(plan.blockers[0]).toMatch(/different kinds of unit/);
  });
  it("a recipe line in a unit the target cannot be costed in, and the plan refuses the same merge", async () => {
    await line("item", D(3), "ingredient", S, "g");
    expect(await refusal(S, T)).toMatch(/1 recipe line\(s\) use a unit Lime Juice \(2L\) cannot be costed in/);
    expect(await rows("select 1 from cost_recipe_lines where component_id = $1", [S])).toHaveLength(3);
    const plan = await planFor();
    expect(plan.canMerge).toBe(false);
    expect(plan.unitsCompatible).toBe(false);
    expect(plan.blockers.join(" ")).toMatch(/1 recipe line uses a unit Lime Juice \(2L\) cannot be costed in \(Shortbread\)/);
  });
});

describe("allergen sign-offs", () => {
  it("identical ticks: every sign-off is carried, and the iPad's own SQL still counts the dishes as confirmed", async () => {
    await confirmInApp(1);
    await confirmInApp(2);
    await confirmInApp(3);
    expect(await confirmed(1)).toBe(true);
    expect(await confirmed(2)).toBe(true);
    const plan = await planFor();
    expect(plan.sameAllergens).toBe(true);
    expect(plan.kept.map((k) => k.name)).toEqual(["Fish Tacos", "Green Salad"]);
    expect(plan.recheck).toEqual([]);
    const stored = (await one("select dish_allergens from cost_menu_items where id = $1", [D(1)])).dish_allergens;

    const r = await merge();
    expect(r.same_allergens).toBe(true);
    expect(r.signoffs_carried).toBe(2);
    expect(r.signoffs_left).toBe(0);
    expect(await confirmed(1)).toBe(true);
    expect(await confirmed(2)).toBe(true);
    expect(await confirmed(3)).toBe(true);
    // the SQL rewrite is the same rewrite as the app's carrySignOff
    const after = (await one("select dish_allergens from cost_menu_items where id = $1", [D(1)])).dish_allergens;
    expect(after).toEqual(carrySignOff(stored, S, T));
    expect(after.components).toContain(`ingredient:${T}`);
    expect(after.components).not.toContain(`ingredient:${S}`);
    expect(after.ticks[`ingredient:${T}`]).toEqual({ a: ["sulphites"], r: true });
    expect(after.ticks[`ingredient:${S}`]).toBeUndefined();
    expect(after.confirmed_by).toBe("chef@example.com");
    expect(after.confirmed_at).toBe(NOW);
  });

  it("a dish that used BOTH ingredients: the source's entry is dropped and the sign-off stays valid", async () => {
    await line("item", D(1), "ingredient", T);
    await confirmInApp(1);
    expect(await confirmed(1)).toBe(true);
    await merge();
    expect(await confirmed(1)).toBe(true);
    const after = (await one("select dish_allergens from cost_menu_items where id = $1", [D(1)])).dish_allergens;
    expect(after.components.filter((c: string) => c === `ingredient:${T}`)).toHaveLength(1);
    expect(Object.keys(after.ticks).filter((k) => k.startsWith("ingredient:")).sort()).toEqual([`ingredient:${I(3)}`, `ingredient:${T}`].sort());
  });

  it("different ticks: stored sign-offs are left exactly as they were, and those dishes need a re-check on both sides", async () => {
    await db.query("update cost_ingredients set allergens = '{sulphites,milk}' where id = $1", [T]);
    await confirmInApp(1);
    await confirmInApp(3);
    const stored = (await one("select dish_allergens from cost_menu_items where id = $1", [D(1)])).dish_allergens;
    const plan = await planFor();
    expect(plan.sameAllergens).toBe(false);
    expect(plan.recheck.map((k) => k.name)).toEqual(["Fish Tacos"]);
    expect(plan.kept).toEqual([]);
    expect(plan.signOffText.join(" ")).toMatch(/do not have the same allergen ticks, so 1 confirmed dish will need its allergens re-checked: Fish Tacos\./);

    const r = await merge();
    expect(r.same_allergens).toBe(false);
    expect(r.signoffs_carried).toBe(0);
    expect(r.signoffs_left).toBe(1);
    expect((await one("select dish_allergens from cost_menu_items where id = $1", [D(1)])).dish_allergens).toEqual(stored);
    expect(await confirmed(1)).toBe(false);
    // a dish that never used it is unaffected
    expect(await confirmed(3)).toBe(true);
    // the target's own ticks were not changed by the merge
    expect((await one("select allergens, allergens_reviewed from cost_ingredients where id = $1", [T]))).toEqual({ allergens: ["sulphites", "milk"], allergens_reviewed: true });
  });

  it("a different reviewed flag counts as different", async () => {
    await confirmInApp(1);
    await db.query("update cost_ingredients set allergens_reviewed = false where id = $1", [T]);
    const r = await merge();
    expect(r.same_allergens).toBe(false);
    expect(await confirmed(1)).toBe(false);
  });

  it("allergens outside the snapshot (alcohol) and the stored order do not count as a difference", async () => {
    await db.query("update cost_ingredients set allergens = '{sulphites,gluten}' where id = $1", [S]);
    await db.query("update cost_ingredients set allergens = '{alcohol,gluten,sulphites}' where id = $1", [T]);
    await confirmInApp(1);
    const r = await merge();
    expect(r.same_allergens).toBe(true);
    expect(await confirmed(1)).toBe(true);
  });

  it("lines that were already moved by hand (the four dishes that read Not checked): the merge puts the sign-off back", async () => {
    await confirmInApp(1);
    // somebody repoints the recipe line in SQL without touching the sign-off
    await db.query("update cost_recipe_lines set component_id = $1 where parent_id = $2 and component_id = $3", [T, D(1), S]);
    expect(await confirmed(1)).toBe(false);
    const plan = await planFor();
    expect(plan.restored.map((k) => k.name)).toEqual(["Fish Tacos"]);
    await merge();
    expect(await confirmed(1)).toBe(true);
  });

  it("a sign-off that was stale for another reason is not made valid by the merge", async () => {
    await confirmInApp(1);
    await db.query("update cost_ingredients set allergens = '{gluten,egg}' where id = $1", [I(3)]);
    expect(await confirmed(1)).toBe(false);
    const plan = await planFor();
    expect(plan.kept).toEqual([]);
    expect(plan.restored).toEqual([]);
    await merge();
    expect(await confirmed(1)).toBe(false);
  });
});

describe("order lists, deals, invoices and ids held in jsonb", () => {
  it("order list items move; where the target already has an active item at that venue the source's is moved and stopped", async () => {
    await db.query("insert into ordering_products (id, venue_id, name, ingredient_id, costing_packs_per_unit) values ($1,1,'Lime Juice (L)',$2,12), ($3,1,'Lime Juice (2L)',$4,6), ($5,2,'Lime Juice (L)',$2,1), ($6,2,'Lime Old',$2,null)", [X(1), S, X(2), T, X(3), X(4)]);
    await db.query("update ordering_products set active = false where id = $1", [X(4)]);
    const r = await merge();
    expect(r.order_items).toBe(3);
    expect(r.order_items_stopped).toBe(1);
    const p = async (id: string) => one("select ingredient_id, active, costing_packs_per_unit from ordering_products where id = $1", [id]);
    // Drift already orders the 2 L: the 1 L item is moved, stopped and restated (12 one litre packs are 6 two litre packs)
    expect(await p(X(1))).toEqual({ ingredient_id: T, active: false, costing_packs_per_unit: "6.0000" });
    expect(await p(X(2))).toEqual({ ingredient_id: T, active: true, costing_packs_per_unit: "6" });
    // Chiobu has no item for the target: the source's stays on its list; 1 x 1 L over a 2 L pack is exactly 0.5
    expect(await p(X(3))).toEqual({ ingredient_id: T, active: true, costing_packs_per_unit: "0.5000" });
    // an item that was already stopped stays stopped
    expect(await p(X(4))).toEqual({ ingredient_id: T, active: false, costing_packs_per_unit: null });
  });

  it("a pack count that cannot be restated exactly becomes null (nobody has said), in SQL and in the app's rule alike", async () => {
    await ing(I(30), "Gin (700ml)", { size: 0.7 });
    await ing(I(31), "Gin (L)", { size: 1 });
    await ing(I(32), "Gin (3L)", { size: 3 });
    await db.query("insert into ordering_products (id, venue_id, name, ingredient_id, costing_packs_per_unit) values ($1,1,'Gin',$2,6)", [X(1), I(30)]);
    await merge(I(30), I(31));
    // 6 x 0.7 L = 4.2 one litre packs: exact
    expect((await one("select costing_packs_per_unit from ordering_products where id = $1", [X(1)])).costing_packs_per_unit).toBe("4.2000");
    expect(scaledPacks(6, 0.7, 1)).toBe(4.2);
    await merge(I(31), I(32));
    // 4.2 / 3 = 1.4: exact
    expect((await one("select costing_packs_per_unit from ordering_products where id = $1", [X(1)])).costing_packs_per_unit).toBe("1.4000");
    expect(scaledPacks(4.2, 1, 3)).toBe(1.4);
    await ing(I(33), "Gin (7L)", { size: 7 });
    await merge(I(32), I(33));
    // 1.4 x 3 / 7 = 0.6: exact; then one more that is not
    expect((await one("select costing_packs_per_unit from ordering_products where id = $1", [X(1)])).costing_packs_per_unit).toBe("0.6000");
    await ing(I(34), "Gin (0.9L)", { size: 0.9 });
    await merge(I(33), I(34));
    expect((await one("select costing_packs_per_unit from ordering_products where id = $1", [X(1)])).costing_packs_per_unit).toBeNull();
    expect(scaledPacks(0.6, 7, 0.9)).toBeNull();
    expect(scaledPacks(12, 1, 2)).toBe(6);
    expect(scaledPacks(12, 2, 2)).toBe(12);
    expect(scaledPacks(null, 1, 2)).toBeNull();
  });

  it("supplier deals move only onto a target with none of its own and the same pack", async () => {
    // different pack sizes: the deal stays on the source
    await db.query("insert into cost_ingredient_deals (ingredient_id, kind) values ($1,'percent_off')", [S]);
    let r = await merge();
    expect(r).toMatchObject({ deals: 0, deals_left: 1 });
    expect(await rows("select 1 from cost_ingredient_deals where ingredient_id = $1", [S])).toHaveLength(1);
    // same pack, target has none: it moves
    await ing(I(40), "Keg A", { size: 49.5 });
    await ing(I(41), "Keg B", { size: 49.5 });
    await db.query("insert into cost_ingredient_deals (ingredient_id, kind) values ($1,'buy_x_get_y')", [I(40)]);
    r = await merge(I(40), I(41));
    expect(r).toMatchObject({ deals: 1, deals_left: 0 });
    expect(await rows("select 1 from cost_ingredient_deals where ingredient_id = $1", [I(41)])).toHaveLength(1);
    // same pack, but the target has its own: the target's wins
    await ing(I(42), "Keg C", { size: 49.5 });
    await db.query("insert into cost_ingredient_deals (ingredient_id, kind) values ($1,'special_price')", [I(42)]);
    r = await merge(I(42), I(41));
    expect(r).toMatchObject({ deals: 0, deals_left: 1 });
    expect(await rows("select 1 from cost_ingredient_deals where ingredient_id = $1", [I(41)])).toHaveLength(1);
  });

  it("invoice matches teach the target; a match the target already has wins and the source's is rejected, never deleted", async () => {
    const SUP = X(60);
    await db.query(
      "insert into invoice_item_map (id, supplier_id, item_code, ingredient_id, packs_per_unit) values ($1,$5,'LJ1',$6,12), ($2,$5,'LJ2',$6,6), ($3,$5,'LJ2',$7,3), ($4,$5,'OTHER',$8,1)",
      [X(1), X(2), X(3), X(4), SUP, S, T, I(3)],
    );
    await db.query("insert into invoice_documents (id, status, analysis_version) values ($1,'needs_review',3), ($2,'applied',3), ($3,'needs_review',3)", [X(10), X(11), X(12)]);
    await db.query("insert into invoice_lines (id, document_id, ingredient_id, map_id, state) values ($1,$4,$7,$8,'open'), ($2,$5,$7,$9,'applied'), ($3,$6,$10,null,'open')", [X(20), X(21), X(22), X(10), X(11), X(12), S, X(1), X(2), I(3)]);
    const r = await merge();
    expect(r.invoice_maps).toBe(1);
    expect(r.invoice_maps_kept).toBe(1);
    expect(r.invoice_lines).toBe(2);
    const m = async (id: string) => one("select ingredient_id, packs_per_unit, rejected from invoice_item_map where id = $1", [id]);
    // moved, and 12 one litre packs restated as 6 two litre packs
    expect(await m(X(1))).toEqual({ ingredient_id: T, packs_per_unit: "6.0000", rejected: false });
    // the target already had LJ2: its row is untouched, the source's row stays put and is rejected
    expect(await m(X(2))).toEqual({ ingredient_id: S, packs_per_unit: "6.0000", rejected: true });
    expect(await m(X(3))).toEqual({ ingredient_id: T, packs_per_unit: "3.0000", rejected: false });
    expect(await m(X(4))).toEqual({ ingredient_id: I(3), packs_per_unit: "1.0000", rejected: false });
    expect(Number((await one("select count(*) as n from invoice_item_map")).n)).toBe(4);
    // lines follow the kept ingredient, and a line that used the rejected row now points at the target's row
    expect(await one("select ingredient_id, map_id from invoice_lines where id = $1", [X(20)])).toEqual({ ingredient_id: T, map_id: X(1) });
    expect(await one("select ingredient_id, map_id from invoice_lines where id = $1", [X(21)])).toEqual({ ingredient_id: T, map_id: X(3) });
    // only an invoice that is not applied and had an open line for the source is marked for the free re-check
    expect((await rows("select id, analysis_version from invoice_documents order by id")).map((d) => d.analysis_version)).toEqual([0, 3, 3]);
  });

  it("ids inside jsonb: menu option additions, open research notes and open invoice questions point at the target", async () => {
    const lineId = (await one("select id from cost_recipe_lines where parent_id = $1 and component_id = $2", [D(1), I(3)])).id as string;
    const options = { gfo: { note: "Swap", removed: [lineId], added: [{ component_type: "ingredient", component_id: S, qty: 15, unit: "ml" }, { component_type: "prep", component_id: P(1), qty: 10, unit: "g" }] }, gf: {} };
    await db.query("update cost_menu_items set diet_options = $1 where id = $2", [JSON.stringify(options), D(1)]);
    await db.query("insert into cost_research_notes (id, status, changes) values ($1,'open',$3), ($2,'approved',$3)", [X(1), X(2), JSON.stringify([{ ingredient_id: S, qty: 10, unit: "ml" }])]);
    await db.query("insert into invoice_questions (id, status, options) values ($1,'open',$3), ($2,'answered',$3)", [X(3), X(4), JSON.stringify([{ id: `suggest:${S}`, label: "Lime Juice (L)", ingredient_id: S }])]);
    const r = await merge();
    expect(r).toMatchObject({ option_dishes: 1, research_notes: 1, questions: 1 });
    const d = (await one("select diet_options from cost_menu_items where id = $1", [D(1)])).diet_options;
    expect(d.gfo.added).toEqual([{ component_type: "ingredient", component_id: T, qty: 15, unit: "ml" }, { component_type: "prep", component_id: P(1), qty: 10, unit: "g" }]);
    expect(d.gfo.removed).toEqual([lineId]);
    expect(d.gfo.note).toBe("Swap");
    expect((await one("select changes from cost_research_notes where id = $1", [X(1)])).changes[0].ingredient_id).toBe(T);
    expect((await one("select changes from cost_research_notes where id = $1", [X(2)])).changes[0].ingredient_id).toBe(S);
    expect((await one("select options from invoice_questions where id = $1", [X(3)])).options[0]).toMatchObject({ id: `suggest:${T}`, ingredient_id: T });
    expect((await one("select options from invoice_questions where id = $1", [X(4)])).options[0].ingredient_id).toBe(S);
  });
});
