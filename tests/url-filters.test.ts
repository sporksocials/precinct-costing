import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** Filters live in the address bar so Back returns a list to the chip, search and sort it was left on (Troy, 5 Oct 2026). */
describe("list filters keep their place through Back", () => {
  const pages = ["app/(app)/menu/page.tsx", "components/preps-list.tsx", "app/(app)/ingredients/page.tsx", "app/(app)/specials/page.tsx", "app/(app)/gelato/page.tsx", "app/(app)/research-notes/page.tsx"];
  it("every list page reads its filters from the address bar", () => {
    for (const f of pages) expect(readFileSync(f, "utf8"), f).toContain("useUrlState");
  });
  it("the menu keeps the category chip, search, sort and Show Inactive in the address", () => {
    const s = readFileSync("app/(app)/menu/page.tsx", "utf8");
    for (const key of ['useUrlState("q")', 'useUrlState("cat", "all")', 'useUrlState("sort", "az")', 'useUrlFlag("inactive")']) expect(s).toContain(key);
    expect(s).not.toMatch(/useState\(params\.get\("cat"\)/);
  });
  it("the hook writes with replaceState, so no extra history entries and no server round trip", () => {
    const s = readFileSync("components/use-url-state.ts", "utf8");
    expect(s).toContain("window.history.replaceState");
    expect(s).not.toContain("router.push");
  });
});
