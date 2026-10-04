import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20261004230000_edit_stamps.sql";
const mig = readFileSync(MIGRATION, "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("edit stamps migration", () => {
  it("adds a nullable updated_by to dishes and preps and makes sure updated_at is there", () => {
    expect(mig).toContain("alter table public.cost_menu_items add column if not exists updated_by text;");
    expect(mig).toContain("alter table public.cost_preps add column if not exists updated_by text;");
    expect(mig).toContain("alter table public.cost_menu_items add column if not exists updated_at timestamptz default now();");
    expect(mig).toContain("alter table public.cost_preps add column if not exists updated_at timestamptz default now();");
    expect(mig).not.toMatch(/updated_by text not null/i);
  });

  it("stamps updated_at and the signed-in email before every update, and never fails without a JWT", () => {
    expect(mig).toContain("create or replace function public.cost_stamp_edit()");
    expect(mig).toContain("new.updated_at := now();");
    expect(mig).toContain("auth.jwt() ->> 'email'");
    expect(mig).toContain("exception when others then");
    expect(mig).toContain("create trigger cost_item_touch before update on public.cost_menu_items");
    expect(mig).toContain("create trigger cost_prep_touch before update on public.cost_preps");
    // the old triggers are replaced, not stacked
    expect(mig).toContain("drop trigger if exists cost_item_touch on public.cost_menu_items;");
    expect(mig).toContain("drop trigger if exists cost_prep_touch on public.cost_preps;");
  });

  it("recipe line changes stamp the parent with statement level triggers (one parent update per statement, not per line)", () => {
    for (const ev of ["insert", "update", "delete"]) {
      expect(mig).toContain(`create trigger cost_recipe_lines_stamp_${ev} after ${ev} on public.cost_recipe_lines`);
    }
    expect(mig).toContain("referencing new table as new_rows for each statement");
    expect(mig).toContain("referencing old table as old_rows new table as new_rows for each statement");
    expect(mig).toContain("referencing old table as old_rows for each statement");
    expect(mig).not.toMatch(/for each row execute function public\.cost_recipe_lines_stamp/);
    // it stamps both parent tables by parent_type
    expect(mig).toContain("parent_type = 'item'");
    expect(mig).toContain("parent_type = 'prep'");
  });

  it("has no side effects: no inserts, no writes to recipe lines (no recursion), no sell price log or audit rows, no data changes", () => {
    const code = mig.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/insert into/i);
    expect(code).not.toMatch(/update public\.cost_recipe_lines/i);
    expect(code).not.toMatch(/cost_sell_price_log|cost_audit_log/);
    expect(code).not.toMatch(/\bdelete from\b|\btruncate\b|\bdrop table\b/i);
    // the only updates are the parent stamps
    const updates = code.match(/update public\.\w+/gi) ?? [];
    expect(new Set(updates.map((u) => u.toLowerCase()))).toEqual(new Set(["update public.cost_menu_items", "update public.cost_preps"]));
  });

  it("the trigger functions are not callable over the API and the line stamps run with definer rights", () => {
    for (const fn of ["cost_stamp_edit", "cost_recipe_lines_stamp_insert", "cost_recipe_lines_stamp_update", "cost_recipe_lines_stamp_delete"]) {
      expect(mig).toContain(`revoke execute on function public.${fn}() from public, anon, authenticated;`);
    }
    expect(mig.match(/security definer set search_path = public/g)?.length).toBe(3);
  });

  it("schema.sql mirrors the migration exactly", () => {
    expect(squash(schema)).toContain(squash(mig));
    expect(schema).toContain("mirrors supabase/migrations/20261004230000_edit_stamps.sql");
  });

  it("is the newest migration, so it applies after the ones it builds on", () => {
    const names = readdirSync("supabase/migrations").sort();
    expect(names[names.length - 1]).toBe("20261004230000_edit_stamps.sql");
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === ".next") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("the editor never writes without the check", () => {
  const editor = readFileSync("components/editor/recipe-editor.tsx", "utf8");

  it("saves through checkedSave, with a fresh read and a guarded commit", () => {
    expect(editor).toContain("checkedSave<Rec>(");
    expect(editor).toContain("s.fetchFresh(kind, id)");
    expect(editor).toContain("s.commitRecord(kind, id, a)");
  });

  it("has no direct field or line writes of its own (Duplicate writes a brand new record's lines, which cannot clash)", () => {
    expect(editor).not.toMatch(/\.updateItem\(|\.updatePrep\(/);
    const saveLinesCalls = editor.match(/\.saveLines\(/g) ?? [];
    expect(saveLinesCalls).toHaveLength(1);
    expect(editor).toContain('store.saveLines("prep", nid,');
  });

  it("Save And Leave and Research Notes both save through the same function, and neither opens a second path", () => {
    expect(editor).toContain("useUnsavedGuard(dirty, { save,");
    expect(editor).toContain("saveRaw({ quiet: true })");
    expect(editor).toContain("throw new SaveConflictError()");
  });

  it("Research Notes on a page with no editor refuses to write over a recipe that moved on", () => {
    const rn = readFileSync("components/editor/research-notes.tsx", "utf8");
    expect(rn).toContain('s.fetchFresh("item", itemId)');
    expect(rn).toContain("theirChangesOf(");
    expect(rn).toContain("{ existing: fresh.lines }");
  });

  it("every insert still goes through insertRow / insertRows (no raw .insert( anywhere else)", () => {
    const offenders = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => {
      if (f === "lib/store.tsx") return false; // the two helpers live here
      if (f === "lib/supabase/demo-client.ts") return false; // the in-memory stand-in implements insert()
      return /\.insert\(/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    });
    expect(offenders).toEqual([]);
    const store = readFileSync("lib/store.tsx", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect((store.match(/\.insert\(/g) ?? []).length).toBe(2);
  });

  it("the outside-edit hook exists only in the demo client", () => {
    const hits = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => readFileSync(f, "utf8").includes("__demoOutside"));
    expect(hits).toEqual(["lib/supabase/demo-client.ts"]);
  });

  it("nothing a person can read mentions an AI product", () => {
    for (const f of ["components/editor/conflict-sheet.tsx", "lib/conflict-view.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/claude|anthropic|\bAI\b|assistant/i);
    }
  });
});
