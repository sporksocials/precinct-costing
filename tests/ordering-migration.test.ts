import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "supabase/migrations/20261005300000_ordering_tables.sql";
const mig = readFileSync(FILE, "utf8");
const code = mig.replace(/--.*$/gm, "");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const sql = squash(code);
const schema = readFileSync("supabase/schema.sql", "utf8");
const original = squash(readFileSync("supabase/migrations/20261004240000_change_history.sql", "utf8").replace(/--.*$/gm, ""));

const TABLES = [
  "ordering_suppliers",
  "ordering_categories",
  "ordering_products",
  "ordering_count_sessions",
  "ordering_count_lines",
  "ordering_orders",
  "ordering_order_lines",
  "ordering_price_uploads",
  "ordering_price_log",
];
const tableBody = (t: string): string => {
  const m = sql.match(new RegExp(`create table if not exists public\\.${t} \\((.*?)\\); (?:create|--|alter|drop)`));
  if (!m) throw new Error(`no table ${t}`);
  return m[1];
};

describe("ordering migration: tables", () => {
  it("creates exactly the nine tables, idempotently", () => {
    expect([...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])).toEqual(TABLES);
    expect(code).not.toMatch(/create table (?!if not exists)/);
  });
  it.each(TABLES)("%s has a uuid id and a venue_id that references cost_venues", (t) => {
    const b = tableBody(t);
    expect(b).toContain("id uuid primary key default gen_random_uuid()");
    expect(b).toContain("venue_id integer not null references public.cost_venues (id)");
  });
  it("is per venue all the way down: parent links are composite (id, venue_id) foreign keys", () => {
    for (const fk of [
      "foreign key (category_id, venue_id) references public.ordering_categories (id, venue_id)",
      "foreign key (supplier_id, venue_id) references public.ordering_suppliers (id, venue_id)",
      "foreign key (session_id, venue_id) references public.ordering_count_sessions (id, venue_id) on delete cascade",
      "foreign key (product_id, venue_id) references public.ordering_products (id, venue_id)",
      "foreign key (order_id, venue_id) references public.ordering_orders (id, venue_id) on delete cascade",
    ]) expect(sql, fk).toContain(fk);
    for (const t of ["ordering_suppliers", "ordering_categories", "ordering_products", "ordering_count_sessions", "ordering_orders"]) expect(tableBody(t), t).toContain("unique (id, venue_id)");
  });
  it("suppliers: method, minimums, prices switch and a name unique per venue", () => {
    const b = tableBody("ordering_suppliers");
    expect(b).toContain("method text not null default 'email' check (method in ('email', 'website', 'app'))");
    expect(b).toContain("min_order_value numeric");
    expect(b).toContain("min_order_units numeric");
    expect(b).toContain("show_prices_on_order boolean not null default false");
    expect(b).toContain("unique (venue_id, name)");
  });
  it("categories: unique per venue, null second place means Store only", () => {
    const b = tableBody("ordering_categories");
    expect(b).toContain("second_location_label text,");
    expect(b).toContain("unit_name text not null default 'carton'");
    expect(b).toContain("unique (venue_id, name)");
  });
  it("products: names are unique per category (not per venue), pack multiple at least 1, par never negative, link to costing", () => {
    const b = tableBody("ordering_products");
    expect(b).toContain("unique (venue_id, category_id, name)");
    expect(b).not.toContain("unique (venue_id, name)");
    expect(b).toContain("unit_name text not null");
    expect(b).toContain("pack_multiple integer not null default 1 check (pack_multiple >= 1)");
    expect(b).toContain("par numeric not null default 0 check (par >= 0)");
    expect(b).toContain("ingredient_id uuid references public.cost_ingredients (id) on delete set null");
    expect(b).toContain("costing_packs_per_unit numeric");
    expect(b).toContain("supplier_id uuid,");
  });
  it("sessions: status, one in progress per venue", () => {
    expect(tableBody("ordering_count_sessions")).toContain("status text not null default 'in_progress' check (status in ('in_progress', 'finalised'))");
    expect(sql).toContain("create unique index if not exists ordering_count_sessions_one_open_idx on public.ordering_count_sessions (venue_id) where status = 'in_progress'");
  });
  it("count lines: null is not counted, zero is allowed, client_uuid is unique, one line per product per session", () => {
    const b = tableBody("ordering_count_lines");
    expect(b).toContain("store_qty numeric check (store_qty is null or store_qty >= 0)");
    expect(b).toContain("second_qty numeric check (second_qty is null or second_qty >= 0)");
    expect(b).not.toMatch(/store_qty numeric not null/);
    expect(b).toContain("constraint ordering_count_lines_client_uuid_key unique (client_uuid)");
    expect(b).toContain("unique (session_id, product_id)");
    for (const snap of ["product_name text", "par_at_count numeric", "unit_name text"]) expect(b).toContain(snap);
  });
  it("orders and lines", () => {
    const o = tableBody("ordering_orders");
    expect(o).toContain("status text not null default 'draft' check (status in ('draft', 'sent'))");
    expect(o).toContain("kind text not null default 'count' check (kind in ('count', 'top_up'))");
    expect(o).toContain("check (method is null or method in ('email', 'outlook', 'copy', 'website', 'other'))");
    expect(o).toContain("session_id uuid references public.ordering_count_sessions (id) on delete set null");
    const l = tableBody("ordering_order_lines");
    expect(l).toContain("product_id uuid references public.ordering_products (id) on delete set null");
    expect(l).toContain("ordered_qty numeric not null check (ordered_qty >= 0)");
    expect(l).toContain("product_name text not null");
  });
  it("price uploads and the price log exist (tables only)", () => {
    expect(tableBody("ordering_price_uploads")).toContain("file_name text not null");
    expect(tableBody("ordering_price_log")).toContain("upload_id uuid references public.ordering_price_uploads (id) on delete set null");
  });
  it("has venue-first indexes", () => {
    for (const idx of ["ordering_suppliers_venue_idx", "ordering_categories_venue_idx", "ordering_products_venue_idx", "ordering_count_sessions_venue_idx", "ordering_count_lines_venue_product_idx", "ordering_orders_venue_idx", "ordering_price_log_venue_idx"]) expect(sql, idx).toContain(`create index if not exists ${idx}`);
  });
});

describe("ordering migration: security", () => {
  it.each(TABLES)("%s has RLS and the same cost_allowed_all policy as every cost_ table", (t) => {
    expect(sql).toContain(`alter table public.${t} enable row level security;`);
    expect(sql).toContain(`drop policy if exists cost_allowed_all on public.${t};`);
    expect(sql).toContain(`create policy cost_allowed_all on public.${t} for all to authenticated using (public.cost_is_allowed()) with check (public.cost_is_allowed());`);
  });
  it("grants nothing to anon", () => {
    expect(code).not.toMatch(/to anon|grant /i);
  });
});

describe("ordering migration: edit stamps and history", () => {
  it.each(TABLES.filter((t) => t !== "ordering_price_log"))("%s is stamped by cost_stamp_edit", (t) => {
    expect(sql).toContain(`drop trigger if exists ${t}_stamp on public.${t};`);
    expect(sql).toContain(`create trigger ${t}_stamp before insert or update on public.${t} for each row execute function public.cost_stamp_edit();`);
    expect(tableBody(t)).toContain("updated_by text");
  });
  const tracked: [string, string][] = [
    ["ordering_suppliers", "'id'"],
    ["ordering_categories", "'id'"],
    ["ordering_products", "'id'"],
    ["ordering_count_sessions", "'id'"],
    ["ordering_count_lines", "'id', 'ordering_count_sessions', 'session_id', 'when_session_finalised'"],
    ["ordering_orders", "'id'"],
    ["ordering_price_uploads", "'id'"],
  ];
  it.each(tracked)("%s gets an idempotent AFTER row history trigger with the right arguments", (t, args) => {
    expect(sql).toContain(`drop trigger if exists ${t}_history on public.${t};`);
    expect(sql).toContain(`create trigger ${t}_history after insert or update or delete on public.${t} for each row execute function public.cost_history_log(${args});`);
  });
  it("tracks exactly those tables; order lines and the price log are left out and the file says why", () => {
    expect([...code.matchAll(/create trigger \w+_history after insert or update or delete on public\.(\w+)/g)].map((m) => m[1]).sort()).toEqual(tracked.map((x) => x[0]).sort());
    expect(mig).toContain("NOT tracked: ordering_order_lines");
    expect(mig).toContain("ordering_price_log");
  });
  it("replaces cost_history_log with the original plus exactly one additive block", () => {
    const fn = (s: string) => {
      const m = s.match(/create or replace function public\.cost_history_log\(\) (.*?) end \$\$;/);
      if (!m) throw new Error("no function");
      return m[1];
    };
    const block = "if tg_argv[3] = 'when_session_finalised' then if not exists ( select 1 from public.ordering_count_sessions s where s.id = nullif(r ->> 'session_id', '')::uuid and s.status = 'finalised' ) then return null; end if; end if;";
    const now = fn(sql);
    expect(now).toContain(block);
    expect(now.replace(block, "").replace(/\s+/g, " ")).toBe(fn(original).replace(/\s+/g, " "));
    expect(sql).toContain("revoke execute on function public.cost_history_log() from public, anon, authenticated;");
    expect(code).not.toMatch(/raise exception/i);
  });
});

describe("ordering migration: safety", () => {
  it("changes no data and drops nothing but its own triggers and policies", () => {
    expect(code).not.toMatch(/\binsert into\b(?!\s+public\.cost_change_history)|\bdelete from\b|\btruncate\b|\bdrop table\b|\bdrop column\b|\bdrop function\b/i);
    expect(code).not.toMatch(/\bupdate public\./i);
    expect(code).not.toMatch(/alter table public\.cost_/i);
    for (const m of code.matchAll(/drop (trigger|policy) if exists \S+ on public\.(\w+)/g)) expect(m[2].startsWith("ordering_"), m[0]).toBe(true);
    expect((code.match(/create trigger/g) ?? []).length).toBe((code.match(/drop trigger if exists/g) ?? []).length);
  });
  it("does not touch the existing triggers or functions", () => {
    expect(code).not.toMatch(/create or replace function public\.cost_(?!history_log)/);
    expect((code.match(/create or replace function/g) ?? []).length).toBe(1);
  });
  it("is mirrored verbatim in supabase/schema.sql, after the change history section", () => {
    expect(schema).toContain(mig.trim());
    expect(schema.indexOf("20261005300000_ordering_tables.sql")).toBeGreaterThan(schema.indexOf("20261004240000_change_history.sql"));
  });
});
