import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hidesTabBar, isActive, PHONE_TABS, phoneTab } from "@/lib/nav";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Navigation (Troy, 10 Oct 2026: as easy and simple as possible). The phone tab bar is Home, Menu, Ingredients, Ordering, More:
 * Ordering is the daily stock count and is used on phones, so it is a tab; Search lives on the More page (⌘K on desktop).
 */
describe("phone tab bar", () => {
  it("is Home, Menu, Ingredients, Ordering, More, in that order", () => {
    expect(PHONE_TABS.map((t) => t.label)).toEqual(["Home", "Menu", "Ingredients", "Ordering", "More"]);
    expect(PHONE_TABS.map((t) => t.href)).toEqual(["/", "/menu", "/ingredients", "/ordering", "/more"]);
  });
  it("has no Search tab", () => {
    expect(PHONE_TABS.some((t) => /search/i.test(t.label) || (t.href as string) === "/search")).toBe(false);
  });

  const cases: [string, string | null][] = [
    ["/", "home"],
    ["/alerts", "home"],
    ["/menu", "menu"],
    ["/items/abc", "menu"],
    ["/beers", "menu"],
    ["/beers/abc", "menu"],
    ["/gelato", "menu"],
    ["/gelato/serves", "menu"],
    ["/gelato/dietary", "menu"],
    ["/ingredients", "ingredients"],
    ["/ingredients/abc", "ingredients"],
    ["/preps/abc", "ingredients"],
    ["/allergens/review", "ingredients"],
    ["/ordering", "ordering"],
    ["/ordering/drift", "ordering"],
    ["/ordering/drift/count", "ordering"],
    ["/ordering/drift/orders", "ordering"],
    ["/ordering/drift/orders/xyz", "ordering"],
    ["/ordering/drift/setup/products", "ordering"],
    ["/ordering/drift/history/counts/1", "ordering"],
    ["/more", "more"],
    ["/search", "more"],
    ["/specials", "more"],
    ["/specials/abc", "more"],
    ["/matrix", "more"],
    ["/matrix/todo", "more"],
    ["/matrix/review", "more"],
    ["/matrix/print", "more"],
    ["/allergens", "more"],
    ["/research-notes", "more"],
    ["/portal-prices", "more"],
    ["/data-health", "more"],
    ["/change-log", "more"],
    ["/trash", "more"],
    ["/settings", "more"],
    ["/print", null],
  ];
  it.each(cases)("%s highlights %s", (path, tab) => {
    expect(phoneTab(path)).toBe(tab);
  });
  it("never highlights two tabs for one page", () => {
    for (const [path] of cases) {
      const on = PHONE_TABS.filter((t) => phoneTab(path) === t.id);
      expect(on.length, path).toBeLessThanOrEqual(1);
    }
  });
  it("Ordering is not also under More", () => {
    expect(phoneTab("/ordering/greedy/count")).not.toBe("more");
  });
});

describe("the tab bar hides where a page brings its own bottom bar", () => {
  it("record pages and the two review modes", () => {
    for (const p of ["/items/abc", "/preps/abc", "/matrix/review", "/allergens/review"]) expect(hidesTabBar(p), p).toBe(true);
    for (const p of ["/", "/menu", "/ordering/drift/count", "/more", "/search", "/beers/abc"]) expect(hidesTabBar(p), p).toBe(false);
  });
});

describe("the desktop sidebar is unchanged", () => {
  it("still lists the work areas and keeps Ordering as a row", () => {
    const src = read("components/app-shell.tsx");
    for (const label of ["Home", "Menu", "Ingredients", "Allergens", "Specials", "Ordering"]) expect(src).toContain(`label: "${label}"`);
    expect(src).toContain("openSearch");
    expect(src).toContain("⌘K");
  });
  it("sidebar highlight rules are the shared ones", () => {
    expect(isActive("/ordering/drift/count", "/ordering")).toBe(true);
    expect(isActive("/matrix/todo", "/matrix")).toBe(true);
    expect(isActive("/allergens/review", "/ingredients")).toBe(true);
    expect(isActive("/allergens/review", "/matrix")).toBe(false);
  });
});

describe("More page", () => {
  const src = read("app/(app)/more/page.tsx");
  it("opens with Search, with its sub line", () => {
    const rows = [...src.matchAll(/<Row\s+href="([^"]+)"/g)].map((m) => m[1]);
    expect(rows[0]).toBe("/search");
    expect(src).toContain('title="Search" sub="Find a dish, ingredient or prep"');
  });
  it("no longer lists Ordering (it is a tab)", () => {
    expect(src).not.toMatch(/href="\/ordering"/);
  });
  it("keeps Specials, Allergens and the rest", () => {
    for (const h of ["/specials", "/matrix", "/research-notes", "/portal-prices", "/data-health", "/change-log", "/trash", "/settings"]) expect(src).toContain(`href="${h}"`);
  });
});

describe("the CFP App name", () => {
  it("the browser tab, install name and Home Screen name all say CFP App", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('title: "CFP App"');
    expect(layout).toContain('applicationName: "CFP App"');
    expect(layout).toMatch(/appleWebApp: \{ capable: true, title: "CFP App"/);
    expect(read("app/manifest.webmanifest/route.ts")).toContain('name: "CFP App"');
    expect(read("app/manifest.webmanifest/route.ts")).toContain('short_name: "CFP App"');
  });
  it("no screen still calls itself Precinct Costing", () => {
    for (const f of ["app/layout.tsx", "app/manifest.webmanifest/route.ts", "components/bar/station.tsx", "components/bar/premix.tsx"]) expect(read(f), f).not.toContain("Precinct Costing");
  });
});
