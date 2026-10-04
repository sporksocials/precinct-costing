import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20261004240000_change_history.sql";
const mig = readFileSync(MIGRATION, "utf8");
const code = mig.replace(/--.*$/gm, "");
const schema = readFileSync("supabase/schema.sql", "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("change history migration: table", () => {
  it("has exactly the agreed columns", () => {
    const s = squash(code);
    for (const col of [
      "id bigint generated always as identity primary key",
      "tx_id bigint not null default txid_current()",
      "table_name text not null",
      "row_key text not null",
      "op text not null check (op in ('insert','update','delete'))",
      "old_row jsonb",
      "new_row jsonb",
      "changed_fields text[] not null default '{}'",
      "parent_table text",
      "parent_id text",
      "changed_by text",
      "changed_at timestamptz not null default now()",
    ]) expect(s, col).toContain(col);
    expect(s).toContain("create table if not exists public.cost_change_history (");
  });
  it("has the four indexes", () => {
    const s = squash(code);
    expect(s).toContain("on public.cost_change_history (table_name, row_key, changed_at desc)");
    expect(s).toContain("on public.cost_change_history (parent_table, parent_id, changed_at desc)");
    expect(s).toContain("on public.cost_change_history (changed_at desc);");
    expect(s).toContain("on public.cost_change_history (table_name, changed_at desc) where op = 'delete'");
    expect((code.match(/create index if not exists/g) ?? []).length).toBe(4);
  });
  it("is read only for signed-in allowed users: one select policy, no write policies, no write privileges", () => {
    expect(code).toContain("alter table public.cost_change_history enable row level security;");
    expect(code).toContain("create policy cost_allowed_select on public.cost_change_history for select to authenticated using (public.cost_is_allowed());");
    expect((code.match(/create policy/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/for (insert|update|delete|all)/i);
    expect(code).toContain("revoke all on public.cost_change_history from public, anon, authenticated;");
    expect(code).toContain("grant select on public.cost_change_history to authenticated;");
  });
});

describe("change history migration: trigger function", () => {
  it("is one security definer function with a fixed search path, AFTER row triggers, not callable over the API", () => {
    expect(code).toContain("create or replace function public.cost_history_log()");
    expect(code).toMatch(/returns trigger language plpgsql security definer set search_path = public as \$\$/);
    expect((code.match(/create or replace function/g) ?? []).length).toBe(1);
    expect(code).toContain("revoke execute on function public.cost_history_log() from public, anon, authenticated;");
  });
  it("ignores bookkeeping columns and writes nothing for a bookkeeping-only or empty update", () => {
    expect(code).toContain("array['updated_at', 'updated_by', 'created_at', 'sort']");
    expect(code).toContain("if cardinality(fields) = 0 then");
    expect(code).toMatch(/c <> all \(skip\)/);
    expect(code).toContain("(o -> c) is distinct from (n -> c)");
  });
  it("reads who from the JWT inside its own exception block and never fails the business write", () => {
    expect(code).toContain("who := nullif(auth.jwt() ->> 'email', '');");
    expect(code).toMatch(/exception when others then\s+who := null;/);
    expect(code).toMatch(/exception when others then\s+raise warning/);
    expect(code).toContain("return null;");
    expect(code).not.toMatch(/raise exception/i);
  });
  it("takes the key list, and the parent from the row (recipe lines) or from the arguments", () => {
    expect(code).toContain("string_to_array(coalesce(tg_argv[0], 'id'), ',')");
    expect(code).toContain("array_to_string(parts, '|')");
    expect(code).toContain("tg_table_name = 'cost_recipe_lines'");
    expect(code).toContain("when 'item' then 'cost_menu_items' when 'prep' then 'cost_preps'");
    expect(code).toContain("ptable := tg_argv[1];");
    expect(code).toContain("pid := r ->> tg_argv[2];");
  });
});

describe("change history migration: attached tables", () => {
  const attach: [string, string][] = [
    ["cost_menu_items", "'id'"],
    ["cost_preps", "'id'"],
    ["cost_recipe_lines", "'id'"],
    ["cost_ingredients", "'id'"],
    ["cost_beers", "'id'"],
    ["cost_beer_serves", "'id'"],
    ["cost_beer_prices", "'id', 'cost_beers', 'beer_id'"],
    ["cost_gelato_serves", "'id'"],
    ["cost_gelato_serve_lines", "'id', 'cost_gelato_serves', 'serve_id'"],
    ["cost_offers", "'id'"],
    ["cost_offer_lines", "'id', 'cost_offers', 'offer_id'"],
    ["cost_ingredient_deals", "'id'"],
    ["cost_suppliers", "'id'"],
    ["cost_specials", "'id'"],
    ["cost_targets", "'venue_id,category'"],
    ["cost_settings", "'key'"],
    ["cost_bar_options", "'id'"],
    ["cost_allowed_users", "'email'"],
  ];
  it.each(attach)("%s gets an idempotent AFTER row trigger with the right key arguments", (table, args) => {
    const s = squash(code);
    expect(s).toContain(`drop trigger if exists ${table}_history on public.${table};`);
    expect(s).toContain(`create trigger ${table}_history after insert or update or delete on public.${table} for each row execute function public.cost_history_log(${args});`);
  });
  it("attaches to exactly those tables and no others", () => {
    const tables = [...code.matchAll(/create trigger \w+ after insert or update or delete on public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(attach.map((a) => a[0]).sort());
  });
  it("leaves the logs, bulk imports, notes, alerts and venues alone and says why", () => {
    for (const t of ["cost_price_log", "cost_sell_price_log", "cost_audit_log", "cost_portal_prices", "cost_research_notes", "cost_ignored_alerts", "cost_venues"]) {
      expect(code, t).not.toMatch(new RegExp(`on public\\.${t}\\b`));
      expect(mig, t).toContain(t); // named in the comment that explains the exclusion
    }
    expect(code).not.toMatch(/create trigger \w+ after insert or update or delete on public\.cost_change_history/);
    expect(mig).toContain("Deliberately NOT tracked");
  });
  it("does not touch the existing triggers", () => {
    expect(code).not.toMatch(/drop trigger if exists (cost_audit|cost_\w+_audit|cost_\w+_touch|cost_item_touch|cost_prep_touch|cost_\w+_sell_price_log|cost_allowed_users_name_guard|cost_recipe_lines_stamp)/);
    expect(code).not.toMatch(/create or replace function public\.cost_(audit|stamp_edit|touch|log_price)/);
  });
});

describe("change history migration: safety", () => {
  it("changes no data and is idempotent", () => {
    expect(code).not.toMatch(/\binsert into\b(?!\s+public\.cost_change_history)/i);
    expect(code).not.toMatch(/\bdelete from\b|\btruncate\b|\bdrop table\b|\balter table public\.cost_(?!change_history)/i);
    expect(code).not.toMatch(/\bupdate public\./i);
    const creates = (code.match(/create trigger/g) ?? []).length;
    expect((code.match(/drop trigger if exists/g) ?? []).length).toBe(creates);
    expect(code).toContain("create table if not exists");
    expect(code).toContain("drop policy if exists cost_allowed_select on public.cost_change_history;");
  });
  it("is mirrored in supabase/schema.sql", () => {
    expect(schema).toContain(mig.trim());
    expect(schema.indexOf("20261004240000_change_history.sql")).toBeGreaterThan(schema.indexOf("cost_stamp_edit"));
  });
});

describe("raw inserts", () => {
  it("nothing in the app inserts straight into a table (every insert goes through insertRow/insertRows)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/demo-client/.test(p) && /\.insert\(/.test(readFileSync(p, "utf8").replace(/\/\/.*$/gm, ""))) hits.push(p);
      }
    };
    for (const d of ["lib", "components", "app"]) walk(d);
    // lib/store.tsx owns the one allowed raw insert (inside insertRow/insertRows)
    expect(hits.filter((h) => !/lib\/store\.tsx$/.test(h))).toEqual([]);
  });
});
