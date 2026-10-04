import { describe, expect, it } from "vitest";
import { buildConflictView, choiceImpact, conflictIntro, formatWhen, keptChangeList, mergedToast, staleNotice, whoLabel, type ViewCtx } from "@/lib/conflict-view";
import { threeWay } from "@/lib/edit-conflict";
import type { MenuItem, RecipeLine } from "@/lib/types";

const ctx: ViewCtx = {
  componentName: (l) => ({ "c-a": "Tequila Blanco", "c-b": "Lime Juice", "c-z": "Triple Sec" })[l.component_id] ?? "Ingredient",
  venueName: (id) => (id === 1 ? "Drift" : id === 2 ? "Chiobu" : "Shared"),
};

const item = (o: Partial<MenuItem> = {}): MenuItem => ({ id: "i1", name: "Mai Tai", venue_id: 1, category: "Cocktail", section: null, portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...o });
const line = (id: string, o: Partial<RecipeLine> = {}): RecipeLine => ({ id, parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: `c-${id}`, qty: 30, unit: "ml", note: null, sort: 1, ...o });

function conflicts(mine: Partial<MenuItem>, theirs: Partial<MenuItem>, mineLines?: RecipeLine[], theirsLines?: RecipeLine[]) {
  const base = item({ method: ["Shake", "Strain"], garnish: ["Lime"] });
  const bl = [line("a"), line("b", { qty: 15 })];
  return threeWay({ base, mine: { ...base, ...mine }, theirs: { ...base, ...theirs }, baseLines: bl, mineLines: mineLines ?? bl, theirsLines: theirsLines ?? bl });
}

describe("buildConflictView", () => {
  it("a price clash shows both prices as money", () => {
    const [v] = buildConflictView(conflicts({ sell_price_inc: 21 }, { sell_price_inc: 22.5 }).conflicts, ctx);
    expect(v).toMatchObject({ heading: "Price", mine: ["$21.00"], theirs: ["$22.50"] });
  });

  it("method steps read as numbered steps, one per line", () => {
    const [v] = buildConflictView(conflicts({ method: ["Shake hard", "Strain"] }, { method: ["Shake", "Strain", "Top"] }).conflicts, ctx);
    expect(v.heading).toBe("Method");
    expect(v.mine).toEqual(["1. Shake hard", "2. Strain"]);
    expect(v.theirs).toEqual(["1. Shake", "2. Strain", "3. Top"]);
  });

  it("garnish reads as one comma list; an emptied list says None", () => {
    const [v] = buildConflictView(conflicts({ garnish: ["Mint", "Lime"] }, { garnish: [] }).conflicts, ctx);
    expect(v.mine).toEqual(["Mint, Lime"]);
    expect(v.theirs).toEqual(["None"]);
  });

  it("venue shows the venue name and notes show as typed", () => {
    const vs = buildConflictView(conflicts({ venue_id: 2, notes: "x" }, { venue_id: 3, notes: "y" }).conflicts, ctx);
    const by = Object.fromEntries(vs.map((v) => [v.heading, v]));
    expect(by.Venue).toMatchObject({ mine: ["Chiobu"], theirs: ["Shared"] });
    expect(by.Notes).toMatchObject({ mine: ["x"], theirs: ["y"] });
  });

  it("a line clash names the ingredient and uses the app's quantity format", () => {
    const [v] = buildConflictView(conflicts({}, {}, [line("a", { qty: 45 }), line("b", { qty: 15 })], [line("a", { qty: 0.06, unit: "L" }), line("b", { qty: 15 })]).conflicts, ctx);
    expect(v).toMatchObject({ heading: "Tequila Blanco", note: "You both changed this ingredient.", mine: ["45 ml"], theirs: ["60 ml"] });
  });

  it("a removed-versus-edited line says Removed on the removing side", () => {
    const [v] = buildConflictView(conflicts({}, {}, [line("a")], [line("a"), line("b", { qty: 99 })]).conflicts, ctx);
    expect(v).toMatchObject({ heading: "Lime Juice", mine: ["Removed"], theirs: ["99 ml"], note: "You removed this ingredient and they changed it." });
    const [w] = buildConflictView(conflicts({}, {}, [line("a"), line("b", { qty: 99 })], [line("a")]).conflicts, ctx);
    expect(w).toMatchObject({ mine: ["99 ml"], theirs: ["Removed"], note: "They removed this ingredient and you changed it." });
  });

  it("a swapped ingredient shows the new ingredient with its amount; a note is appended", () => {
    const [v] = buildConflictView(conflicts({}, {}, [line("a", { component_id: "c-z", note: "fresh" })], [line("a", { qty: 99 }), line("b", { qty: 15 })]).conflicts, ctx);
    expect(v.mine).toEqual(["Triple Sec, 30 ml · fresh"]);
    expect(v.theirs).toEqual(["Tequila Blanco, 99 ml"]);
  });

  it("Batch Yield shows amount and unit together", () => {
    const base = { id: "p1", name: "Sauce", yield_qty: 2, yield_unit: "kg" };
    const r = threeWay({ base, mine: { ...base, yield_qty: 3 }, theirs: { ...base, yield_qty: 4, yield_unit: "L" }, baseLines: [], mineLines: [], theirsLines: [] });
    const [v] = buildConflictView(r.conflicts, ctx);
    expect(v).toMatchObject({ heading: "Batch Yield", mine: ["3 kg"], theirs: ["4 L"] });
  });
});

describe("choiceImpact: what each button does, before it is tapped", () => {
  it("says how many clashes and what else is kept", () => {
    expect(choiceImpact(1, { count: 1 })).toEqual({
      keepMine: "Your version wins the clash.",
      useTheirs: "Their version wins the clash. Your other changes are still saved.",
      cancel: "Nothing is saved. Your edits stay on the page.",
    });
    expect(choiceImpact(2, { count: 4 }).keepMine).toBe("Your version wins all 2 clashes. Everything else they changed is kept.");
  });
  it("uses no em dashes", () => {
    const c = choiceImpact(3, { count: 5 });
    expect(Object.values(c).join(" ")).not.toContain("—");
  });
});

describe("keptChangeList", () => {
  const labels = ["Price", "Method", "1 Ingredient Added", "1 Ingredient Changed"];
  it("leaves out fields that clash and keeps the rest", () => {
    const c = conflicts({ sell_price_inc: 21 }, { sell_price_inc: 22 }).conflicts;
    expect(keptChangeList(labels, c)).toBe("Method · 1 Ingredient Added · 1 Ingredient Changed");
  });
  it("leaves out ingredient counts when ingredients clash too", () => {
    const c = conflicts({}, {}, [line("a", { qty: 45 }), line("b", { qty: 15 })], [line("a", { qty: 99 }), line("b", { qty: 15 })]).conflicts;
    expect(keptChangeList(labels, c)).toBe("Price · Method");
  });
});

describe("who and when (Brisbane time)", () => {
  const now = new Date("2026-10-04T05:00:00Z"); // 3:00pm Sun 4 Oct in Brisbane
  it("same day: just the time", () => {
    expect(formatWhen("2026-10-04T03:38:00Z", now)).toBe("1:38pm");
  });
  it("another day: day, date and time; Brisbane day boundaries, not UTC", () => {
    expect(formatWhen("2026-10-03T03:38:00Z", now)).toBe("Sat 3 Oct, 1:38pm");
    expect(formatWhen("2026-10-03T15:30:00Z", now)).toBe("1:30am"); // 1:30am Sun 4 Oct in Brisbane is still today there, though it is 3 Oct in UTC
  });
  it("empty for a missing or bad stamp", () => {
    expect(formatWhen(null)).toBe("");
    expect(formatWhen("not a date")).toBe("");
  });
  it("names: first name, Someone when unknown, You in another window for this login", () => {
    expect(whoLabel("Brendan")).toBe("Brendan");
    expect(whoLabel(null)).toBe("Someone");
    expect(whoLabel("  ")).toBe("Someone");
    expect(whoLabel("Troy", { isMe: true })).toBe("You in another window");
  });
  it("the messages", () => {
    expect(mergedToast("Brendan", "2026-10-04T03:38:00Z", now)).toBe("Saved. Also kept changes made by Brendan at 1:38pm");
    expect(mergedToast("Someone", null, now)).toBe("Saved. Also kept changes made by Someone");
    expect(staleNotice("Brendan", "2026-10-04T03:38:00Z", now)).toBe("Brendan saved changes to this at 1:38pm. You can keep editing; you will be asked to review when you save.");
    expect(conflictIntro("Someone", "2026-10-04T03:38:00Z", now)).toContain("Someone changed this at 1:38pm");
    for (const m of [mergedToast("A", null), staleNotice("A", null), conflictIntro("A", null)]) expect(m).not.toContain("—");
  });
});
