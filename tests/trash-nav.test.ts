import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Trash navigation", () => {
  it("is in the More section of the sidebar", () => {
    expect(read("components/app-shell.tsx")).toMatch(/href: "\/trash", label: "Trash"/);
  });
  it("is on the More page", () => {
    expect(read("app/(app)/more/page.tsx")).toMatch(/href="\/trash" title="Trash"/);
  });
  it("is linked at the top of the Change Log's Deleted filter", () => {
    const src = read("app/(app)/change-log/page.tsx");
    expect(src).toMatch(/filter === "deleted"/);
    expect(src).toMatch(/href="\/trash"/);
    expect(src).toMatch(/Open Trash/);
  });
  it("the page is titled Trash with the empty state wording", () => {
    const src = read("app/(app)/trash/page.tsx");
    expect(src).toContain('title="Trash"');
    expect(src).toContain('title="Trash Is Empty"');
    expect(src).toContain("Deleted items appear here and can be restored.");
  });
});

describe("restore and history code never insert directly", () => {
  const files = ["lib/trash.ts", "lib/undo-change.ts", "app/(app)/trash/page.tsx", "components/restore-sheet.tsx", "components/editor/record-history.tsx"];
  const exists = (p: string) => {
    try {
      return statSync(join(process.cwd(), p)).isFile();
    } catch {
      return false;
    }
  };
  it("no raw .insert( outside lib/store.tsx's insertRow/insertRows", () => {
    for (const f of files.filter(exists)) expect(read(f), f).not.toMatch(/\.insert\(/);
  });
  it("restoreFromPlan writes only through insertRow / insertRows", () => {
    const src = read("lib/store.tsx");
    const body = src.slice(src.indexOf("export async function restoreFromPlan"), src.indexOf("True when the error just means the cost_ignored_alerts"));
    expect(body).toContain("insertRow(sb, plan.parentTable");
    expect(body).toContain("insertRows(sb, table");
    expect(body).not.toMatch(/\.insert\(/);
  });
  it("no app source reads like a raw insert beyond the two helpers", () => {
    const walk = (d: string): string[] => readdirSync(join(process.cwd(), d)).flatMap((n) => (statSync(join(process.cwd(), d, n)).isDirectory() ? (n === "node_modules" ? [] : walk(`${d}/${n}`)) : [`${d}/${n}`]));
    const offenders = [...walk("app"), ...walk("components")].filter((f) => /\.tsx?$/.test(f) && /\bsb\.from\([^)]*\)\.insert\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
