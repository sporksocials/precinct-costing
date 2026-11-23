import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Thin order items (migration 20261123130000_thin_order_items.sql): one card per product.
 *
 * Runs the REAL migration text against a real Postgres (PGlite, in memory). Nothing here touches the live database. Before
 * it, the real 20261029200000_one_supplier_list.sql and 20261123090000_ingredient_carton_qty.sql run over a stub of only the
 * tables they and this migration touch (same columns, defaults and constraints as the ordering tables migration), with the
 * REAL change history function (cost_history_log, lifted out of 20261005300000_ordering_tables.sql) on ordering_products and
 * cost_ingredients and an edit stamp trigger, so "safe with the history and stamp triggers" is tested, not assumed.
 *
 * The data is laid out BEFORE the migration the way the live data was: order items with their own short names, their own
 * item codes and their own prices.
 */

const MIG = path.resolve(__dirname, "../supabase/migrations");
const read = (f: string) => readFileSync(path.join(MIG, f), "utf8");
const THIN = read("20261123130000_thin_order_items.sql");
const HISTORY_FN = (() => {
  const all = read("20261005300000_ordering_tables.sql");
  const a = all.indexOf("create or replace function public.cost_history_log()");
  const b = all.indexOf("end $$;", a);
  if (a < 0 || b < 0) throw new Error("cost_history_log not found in the ordering tables migration");
  return all.slice(a, b + "end $$;".length);
})();

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ING = (n: number) => u(100 + n);
const CAT = (venue: number, n: number) => u(venue * 1000 + n);
const PRD = (n: number) => u(5000 + n);
const DRIFT = 1;
const CHIOBU = 2;

let db: PGlite;
const notices: string[] = [];
const rows = async (q: string, params: unknown[] = []) => (await db.query(q, params)).rows as Record<string, any>[];
const one = async (q: string, params: unknown[] = []) => (await rows(q, params))[0];
const product = (n: number) => one("select p.*, s.name as supplier_name from ordering_products p left join ordering_suppliers s on s.id = p.supplier_id where p.id = $1", [PRD(n)]);
const ingredient = (n: number) => one("select * from cost_ingredients where id = $1", [ING(n)]);
async function fails(q: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(q, params);
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error(`expected this to fail: ${q}`);
}

const STUB = `
create table cost_venues (id integer primary key, name text not null);
create table cost_suppliers (id serial primary key, name text not null);
create table cost_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  supplier_id integer references cost_suppliers (id),
  supplier_code text,
  pack_price numeric not null default 0,
  updated_at timestamptz default now()
);
create table invoice_suppliers (id uuid primary key default gen_random_uuid(), name text not null, cost_supplier_id integer, active boolean not null default true);
create table ordering_suppliers (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references cost_venues (id),
  name text not null,
  method text not null default 'email',
  email_to text, login_url text, rep_name text, rep_phone text, account_no text,
  min_order_value numeric, min_order_units numeric,
  show_prices_on_order boolean not null default false,
  notes text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint ordering_suppliers_venue_name_key unique (venue_id, name),
  constraint ordering_suppliers_id_venue_key unique (id, venue_id)
);
create table ordering_categories (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references cost_venues (id),
  name text not null,
  constraint ordering_categories_id_venue_key unique (id, venue_id)
);
create table ordering_products (
  id uuid primary key default gen_random_uuid(),
  venue_id integer not null references cost_venues (id),
  category_id uuid not null,
  sort integer not null default 0,
  name text not null check (btrim(name) <> ''),
  unit_name text not null,
  supplier_id uuid,
  supplier_item_code text,
  pack_multiple integer not null default 1 check (pack_multiple >= 1),
  price_inc_gst numeric check (price_inc_gst is null or price_inc_gst >= 0),
  ingredient_id uuid references cost_ingredients (id) on delete set null,
  costing_packs_per_unit numeric,
  par numeric not null default 0 check (par >= 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint ordering_products_venue_category_name_key unique (venue_id, category_id, name),
  constraint ordering_products_id_venue_key unique (id, venue_id),
  constraint ordering_products_category_fk foreign key (category_id, venue_id) references ordering_categories (id, venue_id),
  constraint ordering_products_supplier_fk foreign key (supplier_id, venue_id) references ordering_suppliers (id, venue_id)
);
create table cost_change_history (
  id bigint generated always as identity primary key,
  tx_id bigint not null default txid_current(),
  table_name text not null, row_key text not null, op text not null,
  old_row jsonb, new_row jsonb, changed_fields text[] not null default '{}',
  parent_table text, parent_id text, changed_by text, changed_at timestamptz not null default now()
);
-- the edit stamp, as live but with no JWT to read
create function cost_stamp_edit() returns trigger language plpgsql as $$ begin new.updated_at := now(); new.updated_by := null; return new; end $$;
`;

const TRIGGERS = `
create trigger ordering_products_stamp before insert or update on ordering_products for each row execute function cost_stamp_edit();
create trigger ordering_products_history after insert or update or delete on ordering_products for each row execute function cost_history_log('id');
create trigger cost_ingredients_history after insert or update or delete on cost_ingredients for each row execute function cost_history_log('id');
`;

const ing = (n: number, name: string, supplier: number | null, code: string | null = null) =>
  db.query("insert into cost_ingredients (id, name, supplier_id, supplier_code) values ($1,$2,$3,$4)", [ING(n), name, supplier, code]);
const prd = (n: number, venue: number, cat: number, name: string, over: { ingredient?: number | null; code?: string | null; active?: boolean; unit?: string; price?: number | null; par?: number } = {}) =>
  db.query(
    "insert into ordering_products (id, venue_id, category_id, name, unit_name, supplier_item_code, ingredient_id, active, price_inc_gst, par, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + ($11 || ' seconds')::interval)",
    [PRD(n), venue, CAT(venue, cat), name, over.unit ?? "bottle", over.code ?? null, over.ingredient == null ? null : ING(over.ingredient), over.active ?? true, over.price ?? null, over.par ?? 0, String(n)],
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(HISTORY_FN);
  await db.exec(read("20261029200000_one_supplier_list.sql"));
  await db.exec(read("20261123090000_ingredient_carton_qty.sql"));
  await db.exec(TRIGGERS);
  await db.exec(`
    insert into cost_venues (id, name) values (${DRIFT}, 'Drift Bar'), (${CHIOBU}, 'Chiobu');
    insert into cost_suppliers (id, name) values (1, 'Star Liquor'), (2, 'Paramount Liquor');
    select setval('cost_suppliers_id_seq', 10);
    insert into ordering_categories (id, venue_id, name) values
      ('${CAT(DRIFT, 1)}', ${DRIFT}, 'Spirits'), ('${CAT(DRIFT, 2)}', ${DRIFT}, 'Juice'),
      ('${CAT(CHIOBU, 1)}', ${CHIOBU}, 'Spirits'), ('${CAT(CHIOBU, 2)}', ${CHIOBU}, 'Juice');
  `);

  // 1 Bombay: a short order item name at both venues, the same code on both, none on the ingredient -> the code is copied up
  await ing(1, "Bombay Sapphire London Dry Gin (700ml)", 1);
  await prd(1, DRIFT, 1, "Bombay Sapphire", { ingredient: 1, code: "150012", price: 49.5, par: 6 });
  await prd(2, CHIOBU, 1, "Bombay", { ingredient: 1, code: " 150012 ", price: 51 });
  // 2 Jack: the ingredient already has a code; the order item's different code is replaced by it
  await ing(2, "Jack Daniel's (700ml)", 1, "130031");
  await prd(3, DRIFT, 1, "Jack Daniels", { ingredient: 2, code: "999" });
  // 3 Toki: the two venues' active items disagree -> the ingredient's code stays empty and the items' codes are cleared
  await ing(3, "Suntory Toki (700ml)", 1);
  await prd(4, DRIFT, 1, "Toki", { ingredient: 3, code: "A1" });
  await prd(5, CHIOBU, 1, "Toki Whisky", { ingredient: 3, code: "B2" });
  // 4 Orange juice: one ACTIVE and one INACTIVE item for the same ingredient in the same Drift category
  await ing(4, "Orange Juice (2L)", 2);
  await prd(6, DRIFT, 2, "Orange Juice", { ingredient: 4, code: "OJ1", unit: "carton" });
  await prd(7, DRIFT, 2, "Js Squash", { ingredient: 4, code: "OLD9", active: false });
  // 5 a swap that is only in the way for a moment: item 8 is called what item 9 is about to be called
  await ing(5, "Vok Triple Sec (500ml)", 1);
  await ing(6, "De Kuyper Triple Sec (700ml)", 1);
  await prd(8, DRIFT, 1, "De Kuyper Triple Sec (700ml)", { ingredient: 5 });
  await prd(9, DRIFT, 1, "De Triple", { ingredient: 6 });
  // 6 an INACTIVE item with no ingredient already holds the full name an active item is about to take
  await ing(7, "Aperol (700ml)", 1);
  await prd(10, DRIFT, 1, "Aperol", { ingredient: 7 });
  await prd(11, DRIFT, 1, "Aperol (700ml)", { active: false });
  // 7 an ACTIVE item with no ingredient: left completely alone
  await prd(12, DRIFT, 1, "Paper Straws", { code: "STRAW1", price: 12, unit: "carton" });
  // 8 only an inactive item has a code (no active item has one) -> it decides
  await ing(8, "Chambord (500ml)", 1);
  await prd(13, DRIFT, 1, "Chambord", { ingredient: 8 });
  await prd(14, CHIOBU, 1, "Chambord Old", { ingredient: 8, code: "CH77", active: false });

  await db.exec("delete from cost_change_history");
  await db.exec(THIN, { onNotice: (n) => notices.push(String(n.message ?? "")) });
});

afterAll(async () => {
  await db.close();
});

describe("thin order items: the backfill", () => {
  it("every active order item takes its ingredient's FULL name", async () => {
    expect((await product(1)).name).toBe("Bombay Sapphire London Dry Gin (700ml)");
    expect((await product(2)).name).toBe("Bombay Sapphire London Dry Gin (700ml)");
    expect((await product(3)).name).toBe("Jack Daniel's (700ml)");
    expect((await product(6)).name).toBe("Orange Juice (2L)");
  });
  it("a code is copied UP to an ingredient that had none when the active order items agree", async () => {
    expect((await ingredient(1)).supplier_code).toBe("150012");
    expect((await product(1)).supplier_item_code).toBe("150012");
    expect((await product(2)).supplier_item_code).toBe("150012"); // the spaces around it are gone
  });
  it("an ingredient that already has a code keeps it, and the order item takes it", async () => {
    expect((await ingredient(2)).supplier_code).toBe("130031");
    expect((await product(3)).supplier_item_code).toBe("130031");
    expect(notices.join("\n")).toMatch(/"Jack Daniel's \(700ml\)" keeps its supplier code 130031/);
  });
  it("order items that DISAGREE leave the ingredient's code empty, clear their own, and are named in a notice", async () => {
    expect((await ingredient(3)).supplier_code).toBeNull();
    expect((await product(4)).supplier_item_code).toBeNull();
    expect((await product(5)).supplier_item_code).toBeNull();
    expect(notices.join("\n")).toMatch(/"Suntory Toki \(700ml\)" has no supplier code and its order items disagree \(A1, B2\)/);
  });
  it("when no active item has a code, the inactive ones decide", async () => {
    expect((await ingredient(8)).supplier_code).toBe("CH77");
    expect((await product(13)).supplier_item_code).toBe("CH77");
  });
  it("an active item's code beats an inactive item's different code", async () => {
    expect((await ingredient(4)).supplier_code).toBe("OJ1");
  });
  it("an INACTIVE item that would collide gets (old) appended, and keeps its ingredient", async () => {
    const old = await product(7);
    expect(old.name).toBe("Orange Juice (2L) (old)");
    expect(old.active).toBe(false);
    expect(old.ingredient_id).toBe(ING(4));
    expect(old.supplier_item_code).toBe("OJ1");
  });
  it("an inactive item with no ingredient that held the name steps aside too", async () => {
    expect((await product(10)).name).toBe("Aperol (700ml)");
    expect((await product(11)).name).toBe("Aperol (700ml) (old)");
    expect((await product(11)).ingredient_id).toBeNull();
  });
  it("a name that was only in the way for a moment is not a collision", async () => {
    expect((await product(8)).name).toBe("Vok Triple Sec (500ml)");
    expect((await product(9)).name).toBe("De Kuyper Triple Sec (700ml)");
  });
  it("an inactive item whose name is free takes the ingredient's name", async () => {
    expect((await product(14)).name).toBe("Chambord (500ml)");
  });
  it("an order item with no ingredient is left exactly as it was", async () => {
    const p = await product(12);
    expect(p).toMatchObject({ name: "Paper Straws", supplier_item_code: "STRAW1", supplier_id: null, active: true });
    expect(Number(p.price_inc_gst)).toBe(12);
  });
  it("no column was dropped and the stored prices, pars and units are untouched", async () => {
    const p = await product(1);
    expect(Number(p.price_inc_gst)).toBe(49.5);
    expect(Number(p.par)).toBe(6);
    expect(p.unit_name).toBe("bottle");
    const cols = (await rows("select column_name from information_schema.columns where table_name = 'ordering_products'")).map((r) => r.column_name);
    for (const c of ["price_inc_gst", "costing_packs_per_unit", "supplier_item_code", "name", "pack_multiple"]) expect(cols).toContain(c);
  });
  it("the supplier still comes from the ingredient", async () => {
    expect((await product(1)).supplier_name).toBe("Star Liquor");
    expect((await product(6)).supplier_name).toBe("Paramount Liquor");
  });
  it("the history trigger recorded each rename once, with the old name kept", async () => {
    const h = await rows("select old_row ->> 'name' as old, new_row ->> 'name' as new, changed_fields from cost_change_history where table_name = 'ordering_products' and row_key = $1", [PRD(1)]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ old: "Bombay Sapphire", new: "Bombay Sapphire London Dry Gin (700ml)" });
    expect(h[0].changed_fields).toContain("name");
  });
});

describe("thin order items: running the file twice is harmless", () => {
  it("changes nothing and writes no history the second time", async () => {
    const snap = () => rows("select id, name, supplier_item_code, supplier_id, active, ingredient_id from ordering_products order by id");
    const before = await snap();
    const codes = await rows("select id, supplier_code from cost_ingredients order by id");
    const history = Number((await one("select count(*)::int n from cost_change_history")).n);
    await db.exec(THIN);
    expect(await snap()).toEqual(before);
    expect(await rows("select id, supplier_code from cost_ingredients order by id")).toEqual(codes);
    expect(Number((await one("select count(*)::int n from cost_change_history")).n)).toBe(history);
  });
});

describe("thin order items: afterwards, the ingredient is the one card", () => {
  it("a rename flows to both venues, and an inactive item keeps stepping aside", async () => {
    await db.query("update cost_ingredients set name = $1 where id = $2", ["Bombay Sapphire Gin (1L)", ING(1)]);
    expect((await product(1)).name).toBe("Bombay Sapphire Gin (1L)");
    expect((await product(2)).name).toBe("Bombay Sapphire Gin (1L)");
    await db.query("update cost_ingredients set name = $1 where id = $2", ["Orange Juice Fresh (2L)", ING(4)]);
    expect((await product(6)).name).toBe("Orange Juice Fresh (2L)");
    expect((await product(7)).name).toBe("Orange Juice Fresh (2L) (old)");
  });
  it("a supplier code change flows to both venues, and clearing it clears them", async () => {
    await db.query("update cost_ingredients set supplier_code = $1 where id = $2", ["150099", ING(1)]);
    expect((await product(1)).supplier_item_code).toBe("150099");
    expect((await product(2)).supplier_item_code).toBe("150099");
    await db.query("update cost_ingredients set supplier_code = '  ' where id = $1", [ING(1)]);
    expect((await product(1)).supplier_item_code).toBeNull();
    await db.query("update cost_ingredients set supplier_code = $1 where id = $2", ["150012", ING(1)]);
  });
  it("a supplier change still flows (and makes the venue's terms row)", async () => {
    await db.query("update cost_ingredients set supplier_id = 2 where id = $1", [ING(1)]);
    expect((await product(1)).supplier_name).toBe("Paramount Liquor");
    expect((await product(2)).supplier_name).toBe("Paramount Liquor");
  });
  it("one ingredient change is one ordering_products history row per venue, in the ingredient's own transaction", async () => {
    await db.exec("delete from cost_change_history");
    await db.query("update cost_ingredients set name = $1 where id = $2", ["Jack Daniel's Old No. 7 (700ml)", ING(2)]);
    const h = await rows("select table_name, tx_id, changed_fields from cost_change_history order by id");
    expect(h.map((r) => r.table_name).sort()).toEqual(["cost_ingredients", "ordering_products"]);
    expect(new Set(h.map((r) => String(r.tx_id))).size).toBe(1);
    expect(h.find((r) => r.table_name === "ordering_products")?.changed_fields).toEqual(["name"]);
  });
  it("a name or code typed on a linked order item is put straight back", async () => {
    await db.query("update ordering_products set name = 'Hann Super Dry', supplier_item_code = 'X' where id = $1", [PRD(3)]);
    expect(await product(3)).toMatchObject({ name: "Jack Daniel's Old No. 7 (700ml)", supplier_item_code: "130031" });
  });
  it("a new order item sent with any name gets the ingredient's name, code and supplier", async () => {
    await prd(20, CHIOBU, 1, "whatever was typed", { ingredient: 2 });
    expect(await product(20)).toMatchObject({ name: "Jack Daniel's Old No. 7 (700ml)", supplier_item_code: "130031", supplier_name: "Star Liquor" });
  });
  it("the unique index refuses a second ACTIVE order item for one ingredient at one venue, in any category", async () => {
    const msg = await fails("insert into ordering_products (venue_id, category_id, name, unit_name, ingredient_id) values ($1,$2,'x','bottle',$3)", [CHIOBU, CAT(CHIOBU, 2), ING(2)]);
    expect(msg).toMatch(/ordering_products_one_active_per_ingredient/);
    // an inactive one is fine, and so is switching the old one off and the other on
    await db.query("insert into ordering_products (id, venue_id, category_id, name, unit_name, ingredient_id, active) values ($1,$2,$3,'Jack spare','bottle',$4,false)", [PRD(21), CHIOBU, CAT(CHIOBU, 2), ING(2)]);
    expect(await fails("update ordering_products set active = true where id = $1", [PRD(21)])).toMatch(/ordering_products_one_active_per_ingredient/);
  });
  it("switching an item back on gives it the ingredient's name again, and the one it replaces steps aside", async () => {
    await db.query("update ordering_products set active = false where id = $1", [PRD(6)]);
    await db.query("update ordering_products set active = true where id = $1", [PRD(7)]);
    expect((await product(7)).name).toBe("Orange Juice Fresh (2L)");
    // "(old)" was still item 7's own name at the moment item 6 stepped aside, so item 6 takes the next free one
    expect((await product(6)).name).toBe("Orange Juice Fresh (2L) (old 2)");
    expect((await product(6)).active).toBe(false);
  });
  it("a rename onto a name another ACTIVE item of a different product already has is refused by the database", async () => {
    await prd(22, DRIFT, 1, "Bar Mats", {});
    const msg = await fails("update cost_ingredients set name = 'Bar Mats' where id = $1", [ING(7)]);
    expect(msg).toMatch(/ordering_products_venue_category_name_key/);
    expect((await ingredient(7)).name).toBe("Aperol (700ml)"); // nothing was half saved
    expect((await product(10)).name).toBe("Aperol (700ml)");
  });
  it("Build To, Counted By, the pack multiple, notes and sort are never touched by the triggers", async () => {
    await db.query("update ordering_products set par = 9, unit_name = 'carton', pack_multiple = 6, notes = 'top shelf', sort = 4 where id = $1", [PRD(1)]);
    await db.query("update cost_ingredients set name = 'Bombay Sapphire (700ml)' where id = $1", [ING(1)]);
    const p = await product(1);
    expect(p).toMatchObject({ name: "Bombay Sapphire (700ml)", unit_name: "carton", pack_multiple: 6, notes: "top shelf", sort: 4 });
    expect(Number(p.par)).toBe(9);
  });
  it("an update that only moves an order item's sort writes no history and does not fire the copy", async () => {
    await db.exec("delete from cost_change_history");
    await db.query("update ordering_products set sort = 7 where id = $1", [PRD(1)]);
    expect(Number((await one("select count(*)::int n from cost_change_history")).n)).toBe(0);
  });
});

describe("thin order items: the checks that stop the migration", () => {
  it("names the rows when an ingredient has two ACTIVE order items at one venue", async () => {
    const d2 = new PGlite();
    await d2.exec(STUB);
    await d2.exec(read("20261029200000_one_supplier_list.sql"));
    await d2.exec(`
      insert into cost_venues (id, name) values (1, 'Drift Bar');
      insert into ordering_categories (id, venue_id, name) values ('${CAT(1, 1)}', 1, 'Spirits'), ('${CAT(1, 2)}', 1, 'Juice');
      insert into cost_ingredients (id, name) values ('${ING(1)}', 'Orange Juice (2L)');
      insert into ordering_products (venue_id, category_id, name, unit_name, ingredient_id) values (1, '${CAT(1, 1)}', 'OJ', 'bottle', '${ING(1)}'), (1, '${CAT(1, 2)}', 'Orange', 'bottle', '${ING(1)}');
    `);
    await expect(d2.exec(THIN)).rejects.toThrow(/more than one ACTIVE order item at one venue.*Orange Juice \(2L\) at venue 1 \(OJ, Orange\)/);
    // nothing was changed
    expect(((await d2.query("select name from ordering_products order by name")).rows as { name: string }[]).map((r) => r.name)).toEqual(["OJ", "Orange"]);
    await d2.close();
  });
  it("names the rows when an active item with no ingredient already holds a name an active item is about to take", async () => {
    const d3 = new PGlite();
    await d3.exec(STUB);
    await d3.exec(read("20261029200000_one_supplier_list.sql"));
    await d3.exec(`
      insert into cost_venues (id, name) values (1, 'Drift Bar');
      insert into ordering_categories (id, venue_id, name) values ('${CAT(1, 1)}', 1, 'Spirits');
      insert into cost_ingredients (id, name) values ('${ING(1)}', 'Aperol (700ml)');
      insert into ordering_products (venue_id, category_id, name, unit_name, ingredient_id) values (1, '${CAT(1, 1)}', 'Aperol', 'bottle', '${ING(1)}'), (1, '${CAT(1, 1)}', 'Aperol (700ml)', 'bottle', null);
    `);
    await expect(d3.exec(THIN)).rejects.toThrow(/two ACTIVE order items would have the same name in one category.*"Aperol \(700ml\)" at venue 1/);
    await d3.close();
  });
});

describe("thin order items: the file itself", () => {
  const code = THIN.replace(/--.*$/gm, "");
  it("drops no column and no table, and deletes nothing", () => {
    expect(code).not.toMatch(/drop column|drop table|delete from|truncate/i);
  });
  it("is mirrored at the end of supabase/schema.sql", () => {
    const schema = readFileSync(path.resolve(__dirname, "../supabase/schema.sql"), "utf8");
    expect(schema.endsWith(THIN)).toBe(true);
  });
  it("extends the one trigger on each table instead of adding a second", () => {
    expect([...code.matchAll(/create trigger (\w+)/g)].map((m) => m[1])).toEqual(["ordering_products_follow_ingredient_trg", "cost_ingredients_supplier_moved_trg"]);
    expect(code).toMatch(/before insert or update of ingredient_id, supplier_id, name, supplier_item_code, active, category_id on ordering_products/);
    expect(code).toMatch(/after update of supplier_id, name, supplier_code on cost_ingredients/);
  });
  it("adds the partial unique index", () => {
    expect(code.replace(/\s+/g, " ")).toContain("create unique index if not exists ordering_products_one_active_per_ingredient on ordering_products (venue_id, ingredient_id) where active and ingredient_id is not null");
  });
});
