import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Every record page and the table its History group reads. Settings, targets, sign-in and glass/rim lists stay on the Change Log. */
const PAGES: { file: string; table: string; undo: boolean }[] = [
  { file: "components/editor/recipe-editor.tsx", table: "RECORD_TABLE[kind]", undo: true }, // dishes, drinks, preps, gelato flavours
  { file: "app/(app)/ingredients/[id]/page.tsx", table: "cost_ingredients", undo: false },
  { file: "app/(app)/beers/[id]/page.tsx", table: "cost_beers", undo: false },
  { file: "app/(app)/gelato/serves/page.tsx", table: "cost_gelato_serves", undo: false },
  { file: "components/offer-builder.tsx", table: "cost_offers", undo: false },
  { file: "components/deal-editor.tsx", table: "cost_ingredient_deals", undo: false },
];

describe("every record page has the shared History group", () => {
  for (const p of PAGES) {
    it(`${p.file} renders RecordHistory for ${p.table}`, () => {
      const src = read(p.file);
      expect(src).toContain(p.file.startsWith("components/editor/") ? 'from "./record-history"' : 'from "@/components/editor/record-history"');
      expect(src).toMatch(/<RecordHistory\b/);
      expect(src).toContain(p.table.includes("[") ? `table={${p.table}}` : `table="${p.table}"`);
    });
  }
  it("Undo This Change is offered only through the editor's `undo` option", () => {
    for (const p of PAGES) {
      const src = read(p.file);
      expect(/\bundo=\{\{/.test(src), p.file).toBe(p.undo);
    }
    const comp = read("components/editor/record-history.tsx");
    expect(comp).toContain("undo && e.canUndo");
  });
  it("the component takes (table, rowKey, label) and no longer a record kind", () => {
    const comp = read("components/editor/record-history.tsx");
    expect(comp).toMatch(/table,\s*rowKey,\s*label = "record"/);
    expect(comp).toContain("History");
    expect(comp).toContain("No changes recorded yet.");
    expect(comp).toContain("Show More");
    expect(comp).toContain("Show Fewer");
  });
  it("the Created line is built by the shared helper and shown first", () => {
    const comp = read("components/editor/record-history.tsx");
    expect(comp).toContain("recordStatusLines");
    expect(comp.indexOf("status.created")).toBeLessThan(comp.indexOf("events.length === 0"));
  });
  it("no raw .insert( in the history code, and no wording that names the tooling", () => {
    for (const f of ["components/editor/record-history.tsx", "lib/record-created.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\.insert\(/);
      expect(src, f).not.toMatch(/claude|anthropic|\bAI\b/i);
    }
  });
});
