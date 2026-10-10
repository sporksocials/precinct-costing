import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_CROSS_CONTACT,
  GUEST_GROUPS,
  buildRows,
  combineStates,
  compareDishes,
  compareSections,
  crossContactFromSettings,
  crossContactLine,
  crossContactSettingKey,
  guestHeading,
  guestNeeds,
  guestNeedsMulti,
  matrixSections,
  type MatrixDish,
  type MatrixState,
} from "@/lib/allergy-matrix";
import { parseKitchenMatrix } from "@/lib/kitchen-matrix";
import { COMPONENT_DEPTH } from "@/lib/dish-allergens";

const NOW = "2026-10-10T03:00:00.000Z";
const read = (p: string) => readFileSync(p, "utf8");

function dish(id: string, name: string, over: { contains?: string[]; without?: Record<string, string>; signed?: boolean; marks?: string[]; options?: Record<string, string>; section?: string | null } = {}): MatrixDish {
  const { contains = [], without = {}, signed = true, marks = [], options = {}, section = "Mains" } = over;
  return { id, name, section, allergens: { contains: contains as never, without: without as never, confirmedAt: signed ? NOW : null, confirmedBy: null, components: null, needsSignoff: false }, signOff: signed ? "valid" : "never", marks: marks as never, options: options as never };
}

describe("multi-select Guest Needs on the kitchen iPad", () => {
  it("combines states: red beats grey, grey beats yellow, yellow beats green", () => {
    const c = (...s: MatrixState[]) => combineStates(s);
    expect(c("green", "green")).toBe("green");
    expect(c("green", "yellow")).toBe("yellow");
    expect(c("yellow", "yellow")).toBe("yellow");
    expect(c("green", "red")).toBe("red");
    expect(c("yellow", "red")).toBe("red"); // any pick red is red
    expect(c("grey", "red")).toBe("red"); // grey and none red is grey; with a red it is red
    expect(c("grey", "green")).toBe("grey");
    expect(c("grey", "yellow")).toBe("grey"); // fail safe: nothing can be promised for a dish that is not checked
    expect(c("green")).toBe("green");
  });
  const rows = buildRows([
    dish("g", "Green Bowl"), // dairy green, gluten green, nuts green
    dish("y", "Yellow Pasta", { contains: ["milk"], without: { milk: "no parmesan" } }), // dairy yellow
    dish("yy", "Both Yellow", { contains: ["milk", "gluten"], without: { milk: "no cheese", gluten: "GF pasta" } }), // dairy yellow, gluten yellow
    dish("r", "Red Burger", { contains: ["milk"] }), // dairy red
    dish("gr", "Gluten Red", { contains: ["gluten"] }), // gluten red, dairy green
    dish("u", "Unchecked Soup", { signed: false }), // everything grey
  ]);
  it("shows only the dishes that suit ALL the picks", () => {
    const n = guestNeedsMulti(rows, ["dairy", "gluten_free"]);
    expect(n.green.map((e) => e.row.dish.name)).toEqual(["Green Bowl"]);
    expect(n.yellow.map((e) => e.row.dish.name)).toEqual(["Yellow Pasta", "Both Yellow"]); // matrix order is kept
    expect(n.red.map((e) => e.row.dish.name)).toEqual(["Red Burger", "Gluten Red"]);
    expect(n.grey.map((e) => e.row.dish.name)).toEqual(["Unchecked Soup"]);
    const total = n.green.length + n.yellow.length + n.red.length + n.grey.length;
    expect(total).toBe(rows.length);
  });
  it("a yellow dish lists which pick needs which note", () => {
    const n = guestNeedsMulti(rows, ["dairy", "gluten_free"]);
    const both = n.yellow.find((e) => e.row.dish.name === "Both Yellow")!;
    expect(both.notes).toEqual([
      { label: "Dairy", note: "no cheese" },
      { label: "Gluten Free", note: "GF pasta" },
    ]);
    const one = n.yellow.find((e) => e.row.dish.name === "Yellow Pasta")!;
    expect(one.notes).toEqual([{ label: "Dairy", note: "no parmesan" }]);
  });
  it("picks keep the order they were made in, and a repeated pick counts once", () => {
    const n = guestNeedsMulti(rows, ["gluten_free", "dairy", "dairy"]);
    expect(n.columns.map((c) => c.id)).toEqual(["gluten_free", "dairy"]);
    expect(n.yellow.find((e) => e.row.dish.name === "Both Yellow")!.notes.map((x) => x.label)).toEqual(["Gluten Free", "Dairy"]);
  });
  it("one pick gives exactly the old single-column answer", () => {
    const one = guestNeeds(rows, "dairy");
    const multi = guestNeedsMulti(rows, ["dairy"]);
    for (const g of GUEST_GROUPS) expect(multi[g.key].map((e) => e.row.dish.id)).toEqual(one[g.key].map((e) => e.row.dish.id));
  });
  it("no picks puts every dish in Can Eat (nothing to rule out); the screen never shows this because Clear All returns to the grid", () => {
    expect(guestNeedsMulti(rows, []).green).toHaveLength(rows.length);
  });
  it("the heading names the picks", () => {
    expect(guestHeading(guestNeedsMulti(rows, ["dairy"]).columns)).toBe("Dairy Guest");
    expect(guestHeading(guestNeedsMulti(rows, ["dairy", "gluten_free"]).columns)).toBe("Dairy And Gluten Free Guest");
    expect(guestHeading(guestNeedsMulti(rows, ["dairy", "gluten_free", "eggs"]).columns)).toBe("Dairy, Gluten Free And Eggs Guest");
  });
  it("the screen has multi-select headings, a visible count, Clear All, and a 56px+ target on every control", () => {
    const src = read("components/kitchen/matrix.tsx");
    expect(src).toMatch(/aria-pressed=\{picks\.includes\(c\.id\)\}/);
    expect(src).toContain("needs picked");
    expect(src).toContain("Clear All");
    expect(src).toContain("See Guest Needs");
    expect(src.match(/min-h-\[56px\]/g)!.length).toBeGreaterThanOrEqual(4); // the picks, Clear All, the Large Text switch: gloves and an iPad across the pass
  });
});

describe("Large Text on the kitchen iPad", () => {
  const src = read("components/kitchen/matrix.tsx");
  it("is a visible switch in the footer of every screen, remembered per device with a safe fallback", () => {
    expect(src).toMatch(/role="switch"/);
    expect(src).toContain("Large Text");
    expect(src).toContain('const LARGE_KEY = "kitchen-matrix-large-text"');
    expect(src).toMatch(/try \{\s*setLarge\(window\.localStorage\.getItem\(LARGE_KEY\) === "1"\);\s*\} catch/);
    expect(src).toMatch(/try \{\s*window\.localStorage\.setItem\(LARGE_KEY, v \? "1" : "0"\);\s*\} catch/);
  });
  it("raises everything about 25 percent on the grid, Guest Needs and the dish card", () => {
    expect(src).toContain("export const LARGE_ZOOM = 1.25");
    // all three views are drawn through the one screen() wrapper that applies the zoom
    expect(src.match(/return screen\(/g)).toHaveLength(3);
    expect(src).toMatch(/zoom: LARGE_ZOOM/);
  });
});

describe("cross-contact line", () => {
  it("falls back to the standing default when a venue has none", () => {
    expect(DEFAULT_CROSS_CONTACT).toBe("Shared fryer and grill: cross-contact is possible. Ask the head chef if unsure.");
    expect(crossContactLine(null)).toBe(DEFAULT_CROSS_CONTACT);
    expect(crossContactLine("   ")).toBe(DEFAULT_CROSS_CONTACT);
    expect(crossContactLine("  Separate  fryer   for gluten free. ")).toBe("Separate fryer for gluten free.");
  });
  it("is stored per venue slug in cost_settings.text_value", () => {
    expect(crossContactSettingKey("drift")).toBe("cross_contact_drift");
    const rows = [{ key: "gst_rate" }, { key: "cross_contact_drift", text_value: " No nuts. " }, { key: "cross_contact_chiobu", text_value: "" }];
    expect(crossContactFromSettings(rows, "drift")).toBe("No nuts.");
    expect(crossContactFromSettings(rows, "chiobu")).toBeNull();
    expect(crossContactFromSettings(rows, "greedy")).toBeNull();
  });
  it("the kitchen feed carries it, and the parser falls back to the default", () => {
    const base = { venue: { slug: "drift", name: "Drift" }, dishes: [] };
    expect(parseKitchenMatrix({ ...base, cross_contact: "Own line." }, NOW)?.crossContact).toBe("Own line.");
    expect(parseKitchenMatrix(base, NOW)?.crossContact).toBe(DEFAULT_CROSS_CONTACT);
    expect(parseKitchenMatrix({ ...base, cross_contact: 5 }, NOW)?.crossContact).toBe(DEFAULT_CROSS_CONTACT);
  });
  it("appears in the footer of every iPad screen, the printed sheet, and Settings (through the normal save)", () => {
    expect(read("components/kitchen/matrix.tsx")).toMatch(/<Footer text=\{crossContact\}/);
    expect(read("components/matrix/print-view.tsx")).toContain('className="am-cross"');
    const settings = read("app/(app)/settings/page.tsx");
    expect(settings).toContain("updateTextSetting(crossContactSettingKey(v.slug), t)");
    expect(settings).toContain("maxLength={CROSS_CONTACT_MAX}");
    expect(read("lib/store.tsx")).toMatch(/upsertAll\(sb, "cost_settings", \[\{ key, value: 0, text_value:/);
  });
  it("the Change Log words a cross-contact change", () => {
    expect(read("lib/change-log.ts")).toContain("Cross-contact line");
  });
});

describe("alphabetical order everywhere", () => {
  it("sections A to Z with Other last; dishes A to Z, ignoring case", () => {
    const rows = buildRows([dish("1", "zeta", { section: "Mains" }), dish("2", "Alpha", { section: "Mains" }), dish("3", "beta", { section: "Mains" }), dish("4", "x", { section: "Snacks" }), dish("5", "y", { section: null }), dish("6", "z", { section: "bowls" })]);
    const s = matrixSections(rows);
    expect(s.map((x) => x.label)).toEqual(["bowls", "Mains", "Snacks", "Other"]);
    expect(s[1].rows.map((r) => r.dish.name)).toEqual(["Alpha", "beta", "zeta"]);
    expect(compareSections("Other", "Zebra")).toBeGreaterThan(0);
    expect(compareSections("Apple", "Other")).toBeLessThan(0);
    expect(compareDishes({ name: "b" }, { name: "A" })).toBeGreaterThan(0);
  });
  it("the kitchen iPad, the costing app page and the print all sort through matrixSections", () => {
    for (const f of ["components/kitchen/matrix.tsx", "components/matrix/matrix-page.tsx", "components/matrix/print-view.tsx"]) expect(read(f), f).toContain("matrixSections(");
    expect(read("lib/allergy-matrix.ts")).not.toContain("SECTION_ORDER");
  });
});

describe("the kitchen feed never carries a price, a surcharge or who signed", () => {
  it("the parser output has no sign-off name, components or lock marker", () => {
    const d = parseKitchenMatrix(
      { venue: { slug: "drift", name: "Drift" }, dishes: [{ id: "a", name: "A", section: "Mains", dish_allergens: { contains: ["milk"], without: {}, confirmed_at: NOW, confirmed_by: "chef@example.com", components: ["ingredient:i1"], needs_signoff: true }, marks: [], options: {} }] },
      NOW,
    )!;
    expect(JSON.stringify(d)).not.toMatch(/chef@example|ingredient:i1/);
    expect(d.dishes[0].allergens).toMatchObject({ confirmedBy: null, components: null, needsSignoff: false });
    expect(d.dishes[0].allergens?.confirmedAt).toBe(NOW);
    expect(d.dishes[0].signOff).toBe("valid");
  });
  it("a dish the feed sent without confirmed_at (ingredients changed) reads Not checked on the iPad", () => {
    const d = parseKitchenMatrix({ venue: { slug: "drift", name: "Drift" }, dishes: [{ id: "a", name: "A", section: "Mains", dish_allergens: { contains: ["milk"], without: {}, confirmed_at: null }, marks: [], options: {} }] }, NOW)!;
    expect(d.dishes[0].signOff).toBe("never");
    expect(buildRows(d.dishes)[0].cells.dairy.state).toBe("grey");
  });
});

describe("ingredients stay a prompt in round two too", () => {
  it("review mode and the To Do hub never work a cell out from the roll-up: the pure modules do not call it, the page uses it for the proposal only", () => {
    for (const f of ["lib/matrix-review.ts", "lib/matrix-todo.ts", "lib/matrix-prints.ts", "lib/allergy-recheck.ts", "lib/finish-setup.ts"]) expect(read(f), f).not.toMatch(/\brollup\(|suggestAllergens|ingredientAllergenState/);
    const page = read("components/matrix/review-page.tsx");
    expect(page.match(/rollup\(/g)).toHaveLength(2); // the initial proposal and the hints
    expect(page).toMatch(/initialReviewDraft\(item, rollup\(/);
    expect(read("lib/matrix-review.ts")).toMatch(/proposeContains\(rollup\)/);
  });
});

describe("migrations", () => {
  const prints = read("supabase/migrations/20261010150000_matrix_prints.sql");
  const cross = read("supabase/migrations/20261010160000_cross_contact_setting.sql");
  const feed = read("supabase/migrations/20261010170000_kitchen_matrix_recheck.sql");
  const schema = read("supabase/schema.sql");
  it("the print log is insert and select only, tied to cost_is_allowed(), and not tracked by the history trigger", () => {
    expect(prints).toMatch(/create table if not exists public\.cost_matrix_prints/);
    expect(prints).toMatch(/for select to authenticated using \(public\.cost_is_allowed\(\)\)/);
    expect(prints).toMatch(/for insert to authenticated with check \(public\.cost_is_allowed\(\)\)/);
    expect(prints).not.toMatch(/create policy[^;]*for (update|delete|all)/);
    expect(prints).not.toMatch(/cost_history_log/);
    expect(prints).toMatch(/unique \(venue_id, section, version\)/);
  });
  it("the cross-contact setting needs one nullable text column and nothing else", () => {
    expect(cross).toMatch(/alter table public\.cost_settings add column if not exists text_value text;/);
  });
  it("the feed applies the same depth cap as the app, compares as sets, and sends no components or who signed", () => {
    expect(COMPONENT_DEPTH).toBe(8);
    expect(feed).toMatch(/w\.depth < 8/);
    expect(feed).toMatch(/with recursive/);
    expect(feed).toMatch(/s\.keys @> coalesce\(c\.keys/);
    expect(feed).toMatch(/coalesce\(c\.keys, '\{\}'::text\[\]\) @> s\.keys/);
    expect(feed).not.toMatch(/'components'\s*,\s*d\./);
    expect(feed).not.toMatch(/confirmed_by'\s*,\s*d\./);
    expect(feed).not.toMatch(/surcharge_inc|sell_price|pack_price/);
    expect(feed).toMatch(/'confirmed_at', case when sg\.valid then/);
    expect(feed).toMatch(/cost_settings where key = 'cross_contact_' \|\| p_venue/);
    expect(feed).toMatch(/grant execute on function public\.cost_kitchen_matrix\(text\) to anon, authenticated/);
  });
  it("schema.sql mirrors all three", () => {
    expect(schema).toContain("create table if not exists public.cost_matrix_prints");
    expect(schema).toContain("add column if not exists text_value text");
    expect(schema).toContain("w.depth < 8");
    expect(schema.match(/create or replace function public\.cost_kitchen_matrix/g)).toHaveLength(1);
  });
});

describe("creation flows and the editor", () => {
  const editor = read("components/editor/recipe-editor.tsx");
  it("New Menu Item, Duplicate and What If all go through newDishPatch, and the form says so for Food", () => {
    expect(read("components/new-recipe.tsx")).toMatch(/\.\.\.newDishPatch\(category, null, /);
    expect(read("components/new-recipe.tsx")).toContain("NEW_DISH_NOTE");
    expect(editor).toMatch(/newDishPatch\(rest\.category, rest\.dish_allergens, hasDishAllergens\)/);
    expect(read("components/editor/what-if.tsx")).toMatch(/newDishPatch\(rest\.category, rest\.dish_allergens, "dish_allergens" in item\)/);
  });
  it("every insert of a menu item goes through one of those three places, so no path can create an active unchecked food dish", () => {
    const callers = ["components/new-recipe.tsx", "components/editor/recipe-editor.tsx", "components/editor/what-if.tsx"];
    for (const f of callers) expect(read(f), f).toContain("newDishPatch");
    const users = ["app", "components", "lib"].flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("lib/store.tsx") && /\.insertItem\(/.test(read(f)));
    expect(users.sort()).toEqual(callers.map((c) => c).sort());
  });
  it("the Active switch is locked with the plain reason, and Daily Specials (offers) never create dishes", () => {
    expect(editor).toMatch(/lockedReason=\{activeLock\}/);
    expect(read("components/active-parts.tsx")).toContain("lockedReason");
    expect(read("lib/store.tsx").match(/cost_menu_items/g)?.length).toBeGreaterThan(0);
    expect(read("components/offer-builder.tsx")).not.toMatch(/insertItem/);
  });
  it("a food dish has ONE allergen section: the shared card, with the roll-up collapsed beneath it as the only collapsed thing", () => {
    expect(editor).toMatch(/isFood \? null : <RecipeAllergens/);
    const card = read("components/editor/dish-allergens.tsx");
    expect(card).toContain("What The Ingredients Say");
    expect(card.match(/<Disclosure/g)).toHaveLength(1);
    const card2 = read("components/editor/safety-card.tsx");
    expect(card2).toContain("Allergens And Dietary");
    expect(card2).not.toMatch(/Disclosure|<details/);
  });
  it("the card sits right under Ingredients, before the Kitchen sections", () => {
    const iCards = editor.indexOf("<AllergensDietaryCard");
    expect(iCards).toBeGreaterThan(editor.indexOf('id="setup-ingredients"'));
    expect(iCards).toBeLessThan(editor.indexOf("<KitchenDisplayFields"));
    expect(iCards).toBeLessThan(editor.indexOf("<PricePicker"));
  });
});

function walk(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir).flatMap((n: string) => {
    const p = `${dir}/${n}`;
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
