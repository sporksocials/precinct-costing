import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildIndex, type CostingIndex } from "@/lib/costing";
import { flavourName } from "@/lib/gelato";
import {
  buildDietarySheet,
  cleanGelatoLabels,
  DIETARY_SHEET,
  deriveGelatoLabels,
  GELATO_LABEL_IDS,
  GELATO_LABELS,
  gelatoLabelsFor,
  gelatoLabelsForPrep,
  gelatoLabelText,
  ingredientGelatoFacts,
  isSorbetName,
  isVeganGelatoName,
  differenceNote,
  labelList,
  sameLabels,
  shortNames,
  toggleGelatoLabel,
  type GelatoLabelId,
} from "@/lib/gelato-labels";
import { FLAVOUR_FIXTURE, SHEET, SHEET_ALIASES, SHEET_ONLY, WHITE_BASE, WHITE_BASE_LINES } from "./fixtures/gelato-flavours";
import type { Ingredient, Prep, RecipeLine } from "@/lib/types";

/* ------------------------------------------------------------------ small builders */

const mkIng = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient => ({ id, name, category: "Gelato Supplies", allergens: [], allergens_reviewed: false, ...over }) as Ingredient;
const mkPrep = (id: string, name: string, over: Partial<Prep> = {}): Prep => ({ id, name, venue_id: 4, prep_type: "Gelato flavour mix", active: true, ...over }) as Prep;
let n = 0;
const ingLine = (parent: string, ingId: string): RecipeLine => ({ id: `l${n++}`, parent_type: "prep", parent_id: parent, component_type: "ingredient", component_id: ingId, qty: 1, unit: "g", note: null, sort: n }) as RecipeLine;
const prepLine = (parent: string, prepId: string): RecipeLine => ({ id: `l${n++}`, parent_type: "prep", parent_id: parent, component_type: "prep", component_id: prepId, qty: 1, unit: "g", note: null, sort: n }) as RecipeLine;

/** One flavour made from the named ingredients. */
function oneFlavour(names: string[], over: Partial<Ingredient> = {}) {
  const ings = names.map((nm, i) => mkIng(`i${i}`, nm, over));
  const p = mkPrep("p", "Test Gelato Mix");
  const ls = ings.map((i) => ingLine("p", i.id));
  const index = buildIndex(ings, [p], ls);
  return { p, ls, index, derive: () => deriveGelatoLabels(ls, index, "p") };
}

/* ------------------------------------------------------------------ the real flavours */

interface Real {
  index: CostingIndex;
  flavours: { name: string; prep: Prep; labels: GelatoLabelId[] }[];
}
function buildReal(): Real {
  const ingredients = new Map<string, Ingredient>();
  const ing = (name: string): Ingredient => {
    let i = ingredients.get(name);
    if (!i) {
      i = mkIng(`ing-${ingredients.size}`, name);
      ingredients.set(name, i);
    }
    return i;
  };
  const preps: Prep[] = [];
  const lines: RecipeLine[] = [];
  const add = (name: string, ls: string[], type = "Gelato flavour mix") => {
    const p = mkPrep(`prep-${preps.length}`, name, { prep_type: type });
    preps.push(p);
    ls.forEach((nm, i) => {
      const nested = nm.startsWith("@");
      const comp = nested ? preps.find((x) => x.name === nm.slice(1))! : ing(nm);
      lines.push({ id: `${p.id}-${i}`, parent_type: "prep", parent_id: p.id, component_type: nested ? "prep" : "ingredient", component_id: comp.id, qty: 1, unit: "g", note: null, sort: i } as RecipeLine);
    });
  };
  add(WHITE_BASE, WHITE_BASE_LINES, "Gelato base");
  for (const [name, ls] of Object.entries(FLAVOUR_FIXTURE)) add(name, ls);
  const index = buildIndex([...ingredients.values()], preps, lines);
  const flavours = preps
    .filter((p) => p.prep_type === "Gelato flavour mix")
    .map((p) => ({ name: flavourName(p), prep: p, labels: gelatoLabelsForPrep(p, index).labels }));
  return { index, flavours };
}

/** What the sheet says, flavour by flavour (the sheet's spelling resolved to the app's flavour name). */
function sheetLabels(): Map<string, Set<GelatoLabelId>> {
  const out = new Map<string, Set<GelatoLabelId>>();
  for (const id of GELATO_LABEL_IDS) {
    for (const raw of SHEET[id]) {
      const name = SHEET_ALIASES[raw] ?? raw;
      if (SHEET_ONLY.includes(raw)) continue;
      if (!out.has(name)) out.set(name, new Set());
      out.get(name)!.add(id);
    }
  }
  return out;
}

describe("derivation against the laminated sheet (the sheet is the master)", () => {
  const real = buildReal();
  const sheet = sheetLabels();
  const derived = new Map(real.flavours.map((f) => [f.name, new Set(f.labels)]));

  // sorbets and vegan gelatos are dairy free and vegan by the sheet's own rule: that rule is the truth for them
  const ruleLabels = (name: string): GelatoLabelId[] => (isSorbetName(name) || isVeganGelatoName(name) ? ["dairy_free", "vegan"] : []);
  const truth = (name: string): Set<GelatoLabelId> => {
    const s = new Set<GelatoLabelId>([...(sheet.get(name) ?? [])]);
    for (const l of ruleLabels(name)) s.add(l);
    return s;
  };
  /** on the sheet: named in a list, or covered by a rule line */
  const onSheet = real.flavours.filter((f) => sheet.has(f.name) || ruleLabels(f.name).length).map((f) => f.name);
  const silent = real.flavours.filter((f) => !onSheet.includes(f.name)).map((f) => f.name);

  it("covers every flavour in the app, and every sheet name resolves to a flavour or is sheet-only", () => {
    expect(real.flavours).toHaveLength(38);
    expect(onSheet).toHaveLength(22); // 21 named flavours plus superlemon sorbet by the sorbet rule
    expect(silent).toHaveLength(16);
    for (const id of GELATO_LABEL_IDS) for (const raw of SHEET[id]) {
      const name = SHEET_ALIASES[raw] ?? raw;
      expect(derived.has(name) || SHEET_ONLY.includes(raw), `${raw} on the sheet`).toBe(true);
    }
  });

  const score = (id: GelatoLabelId, names: string[]) => {
    let agree = 0;
    const missed: string[] = [];
    const extra: string[] = [];
    for (const name of names) {
      const want = truth(name).has(id);
      const got = derived.get(name)!.has(id);
      if (want === got) agree += 1;
      else if (want) missed.push(name);
      else extra.push(name);
    }
    return { agree, total: names.length, missed, extra };
  };

  it("Dairy Free and Vegan match the sheet's rules for all 38 flavours", () => {
    const all = real.flavours.map((f) => f.name);
    expect(score("dairy_free", all)).toMatchObject({ agree: 38, total: 38, missed: [], extra: [] });
    expect(score("vegan", all)).toMatchObject({ agree: 38, total: 38, missed: [], extra: [] });
  });

  it("Contains Egg, Soy, Nuts, Gluten, over the 22 flavours the sheet speaks about (exact agreement)", () => {
    // sheet says yes, derivation does not ("missed": the safe direction is the other one, so these are the ones to watch)
    expect(score("egg", onSheet)).toEqual({ agree: 17, total: 22, missed: ["Cookies & Cream", "Gingerbread", "Rum & Raisin", "Salted Caramel", "Tim Tam"], extra: [] });
    expect(score("soy", onSheet)).toEqual({ agree: 21, total: 22, missed: ["Gingerbread"], extra: [] });
    expect(score("nuts", onSheet)).toEqual({ agree: 21, total: 22, missed: ["Gingerbread"], extra: [] });
    expect(score("gluten", onSheet)).toEqual({ agree: 18, total: 22, missed: ["Cheesecake", "Gingerbread", "Toblerone"], extra: ["Caramel Macadamia"] });
  });


  it("overall: 121 of the 132 cells on the sheet agree (91.7%): 10 labels the sheet has and the ingredients do not, 1 the other way", () => {
    let agree = 0;
    let total = 0;
    let missed = 0;
    let extra = 0;
    for (const id of GELATO_LABEL_IDS) {
      const s = score(id, onSheet);
      agree += s.agree;
      total += s.total;
      missed += s.missed.length;
      extra += s.extra.length;
    }
    expect({ agree, total, missed, extra }).toEqual({ agree: 121, total: 132, missed: 10, extra: 1 });
  });

  it("where the sheet is silent, the ingredients say this (for Troy to look at; nothing is stored)", () => {
    const got = Object.fromEntries(silent.map((name) => [name, [...derived.get(name)!].sort()] as const).filter(([, l]) => l.length));
    expect(got).toEqual({
      Banana: ["gluten"], // the Edlyn cookies and cream topping in its recipe
      "Caramelised Fig Mascarpone": ["gluten"], // Mascargel (Cheese Cake) paste
      Chocolate: ["soy"], // Lindt couverture
      "Mars Bar": ["gluten"], // Choc-O-Malt and the cookies topping
      "Vanilla Bean": ["gluten"], // the cookies topping
    });
  });
});

/* ------------------------------------------------------------------ the rules, one at a time */

describe("labels, ids and cleaning", () => {
  it("six labels, in the sheet's order, with the sheet's words", () => {
    expect(GELATO_LABEL_IDS).toEqual(["dairy_free", "vegan", "egg", "soy", "nuts", "gluten"]);
    expect(GELATO_LABELS.map((l) => l.label)).toEqual(["Dairy Free", "Vegan", "Contains Egg", "Contains Soy", "Contains Nuts", "Contains Gluten"]);
    expect(gelatoLabelText("nuts")).toBe("Contains Nuts");
  });
  it("cleans to valid ids in the fixed order, no duplicates", () => {
    expect(cleanGelatoLabels(["gluten", "vegan", "gluten", "milk", 3, null])).toEqual(["vegan", "gluten"]);
    expect(cleanGelatoLabels(null)).toEqual([]);
    expect(cleanGelatoLabels("vegan" as unknown as string[])).toEqual([]);
    expect(sameLabels(["vegan"], ["vegan"])).toBe(true);
    expect(sameLabels(["vegan"], ["egg"])).toBe(false);
  });
});

describe("deriveGelatoLabels", () => {
  it("dairy is milk, cream, cheese, milk powder, milk or white chocolate and latte bases", () => {
    for (const name of ["Norco Full Cream 2lt", "Skim Milk Powder", "Cheese Mascarpone (Fresco) [2470]", "Cheese Philadelphia Original Spreadable", "Chocolate Buttons MILK Sienna Compound", "PRE Paste White Chocolate Traditional", "Atomic-100 Super Latte Base", "Panna Cotta"]) {
      expect(ingredientGelatoFacts(mkIng("x", name)), name).toContain("dairy");
    }
  });
  it("plant milks, cocoa butter and butterscotch are not dairy", () => {
    for (const name of ["Almond Milk", "Coconut Milk", "Oat Milk", "Cocoa Butter", "Butterscotch Syrup", "Peanut Butter Crunchy (Bega)", "Cream of Tartar"]) {
      expect(ingredientGelatoFacts(mkIng("x", name)), name).not.toContain("dairy");
    }
  });
  it("almond milk is a nut, so a vegan gelato made with it contains nuts", () => {
    expect(ingredientGelatoFacts(mkIng("x", "Almond Milk"))).toContain("nuts");
    expect(oneFlavour(["Almond Milk", "Base Vegana", "Dextrose"]).derive().labels).toEqual(["dairy_free", "vegan", "nuts"]);
  });
  it("coconut and loose nuts are nuts; a doughnut is not matched by the word nut", () => {
    expect(ingredientGelatoFacts(mkIng("x", "Coconut Cream"))).toContain("nuts");
    expect(ingredientGelatoFacts(mkIng("x", "Crushed Nuts (2)"))).toContain("nuts");
    expect(ingredientGelatoFacts(mkIng("x", "Peanut Butter Crunchy"))).toContain("nuts");
    expect(ingredientGelatoFacts(mkIng("x", "Doughnut Pieces"))).not.toContain("nuts");
  });
  it("egg: tiramisu and nougat pastes; soy: Biscoff, Oreo, couverture; gluten: biscuit, cones, malt, maltesers, liquorice, pie", () => {
    expect(ingredientGelatoFacts(mkIng("x", "Torroncino (Nougat)"))).toEqual(expect.arrayContaining(["egg", "nuts"]));
    expect(ingredientGelatoFacts(mkIng("x", "Tiramisu Imperiale"))).toEqual(expect.arrayContaining(["egg", "gluten", "soy"]));
    expect(ingredientGelatoFacts(mkIng("x", "Biscoff Paste"))).toEqual(expect.arrayContaining(["gluten", "soy"]));
    expect(ingredientGelatoFacts(mkIng("x", "Biscuit Crumbs OREO WITH Creme"))).toEqual(expect.arrayContaining(["gluten", "soy"]));
    expect(ingredientGelatoFacts(mkIng("x", "Chocolate Couverture Piccoli DARK (Lindt)"))).toContain("soy");
    for (const name of ["Broken Cones", "Choc-O-Malt (Mars Bar)", "Crushed Maltesers", "Liquorice", "Jaffas", "PRE Paste Apple Pie Traditional", "Biscuits TIM TAM Family PACK"]) {
      expect(ingredientGelatoFacts(mkIng("x", name)), name).toContain("gluten");
    }
  });
  it("a coffee paste is not pasta", () => {
    expect(ingredientGelatoFacts(mkIng("x", "Caffe Pasta (Cappuccino)"))).not.toContain("gluten");
  });
  it("a gelato with the white base is not dairy free and not vegan; a sorbet is both", () => {
    const real = buildReal();
    const by = (name: string) => real.flavours.find((f) => f.name === name)!.labels;
    expect(by("Banana")).not.toContain("dairy_free");
    expect(by("Banana")).not.toContain("vegan");
    expect(by("superlemon sorbet")).toEqual(["dairy_free", "vegan"]);
  });
  it("egg or honey stops Vegan but not Dairy Free", () => {
    expect(oneFlavour(["Water", "Caster Sugar", "Torroncino (Nougat)"]).derive().labels).toEqual(["dairy_free", "egg", "nuts"]);
    expect(oneFlavour(["Water", "Honey"]).derive().labels).toEqual(["dairy_free"]);
  });
  it("an empty flavour never claims Dairy Free or Vegan", () => {
    expect(deriveGelatoLabels([], buildIndex([], [mkPrep("p", "X")], []), "p").labels).toEqual([]);
    const blank = [{ id: "b", parent_type: "prep", parent_id: "p", component_type: "ingredient", component_id: "", qty: 0, unit: "g", note: null, sort: 1 } as RecipeLine];
    expect(deriveGelatoLabels(blank, buildIndex([], [mkPrep("p", "X")], blank), "p").labels).toEqual([]);
  });
  it("a missing component stops the free claims (it might be dairy), but warnings still show", () => {
    const i = mkIng("i1", "Crushed Nuts");
    const p = mkPrep("p", "X");
    const ls = [ingLine("p", i.id), ingLine("p", "gone")];
    const d = deriveGelatoLabels(ls, buildIndex([i], [p], ls), "p");
    expect(d.labels).toEqual(["nuts"]);
    expect(d.problems).toEqual(["missing"]);
  });
  it("walks nested preps and survives a loop", () => {
    const milk = mkIng("m", "Skim Milk Powder");
    const base = mkPrep("base", "Base");
    const flavour = mkPrep("f", "Loop Gelato Mix");
    const ls = [ingLine("base", milk.id), prepLine("base", "f"), prepLine("f", "base")];
    const d = deriveGelatoLabels(ls.filter((l) => l.parent_id === "f"), buildIndex([milk], [base, flavour], ls), "f");
    expect(d.labels).toEqual([]); // dairy came through the base; the loop is flagged so nothing "free" is claimed
    expect(d.problems).toEqual(["cycle"]);
    expect(d.sources.dairy_free).toEqual(["Skim Milk Powder"]);
  });
  it("a reviewed ingredient is taken at its ticks, not its name", () => {
    expect(ingredientGelatoFacts(mkIng("x", "Almond Milk", { allergens_reviewed: true, allergens: [] }))).toEqual([]);
    expect(ingredientGelatoFacts(mkIng("x", "Mystery Paste", { allergens_reviewed: true, allergens: ["milk", "tree_nuts", "soy", "gluten", "egg"] }))).toEqual(expect.arrayContaining(["dairy", "nuts", "soy", "gluten", "egg", "animal"]));
    expect(ingredientGelatoFacts(mkIng("x", "Mystery Paste", { allergens: ["peanuts"] }))).toContain("nuts"); // ticked but not reviewed: the tick counts
  });
  it("lists the ingredients behind each label", () => {
    const d = oneFlavour(["Norco Pure Cream 2lt", "Hazelnut Kernels", "Broken Cones"]).derive();
    expect(d.labels).toEqual(["nuts", "gluten"]);
    expect(d.sources.nuts).toEqual(["Hazelnut Kernels"]);
    expect(d.sources.gluten).toEqual(["Broken Cones"]);
    expect(d.sources.dairy_free).toEqual(["Norco Pure Cream 2lt"]);
  });
});

describe("gelatoLabelsFor: automatic or set by hand", () => {
  const f = oneFlavour(["Norco Pure Cream 2lt", "Biscoff Paste"]);
  it("null means automatic and follows the ingredients as they change", () => {
    const st = gelatoLabelsFor({ id: "p", dietary_labels: null }, f.ls, f.index);
    expect(st).toMatchObject({ source: "auto", labels: ["soy", "gluten"], missing: [], extra: [] });
    const more = oneFlavour(["Norco Pure Cream 2lt", "Biscoff Paste", "Crushed Nuts"]);
    expect(gelatoLabelsFor({ id: "p" }, more.ls, more.index).labels).toEqual(["soy", "nuts", "gluten"]);
  });
  it("a stored list wins and is compared with the ingredients, in the sheet's order", () => {
    const st = gelatoLabelsFor({ id: "p", dietary_labels: ["gluten", "egg"] }, f.ls, f.index);
    expect(st.source).toBe("set");
    expect(st.labels).toEqual(["egg", "gluten"]);
    expect(st.missing).toEqual(["soy"]);
    expect(st.extra).toEqual(["egg"]);
  });
  it("an empty stored list is a real answer: set by hand, no labels", () => {
    const st = gelatoLabelsFor({ id: "p", dietary_labels: [] }, f.ls, f.index);
    expect(st).toMatchObject({ source: "set", labels: [], missing: ["soy", "gluten"] });
  });
  it("forgets unknown ids in a stored list", () => {
    expect(gelatoLabelsFor({ id: "p", dietary_labels: ["vegan", "kosher"] }, f.ls, f.index).labels).toEqual(["vegan"]);
  });
});

/* ------------------------------------------------------------------ the printable sheet */

describe("buildDietarySheet", () => {
  const flavours = [
    { name: "Vegan Chocolate", labels: ["dairy_free", "vegan", "soy", "nuts"] as GelatoLabelId[] },
    { name: "superlemon sorbet", labels: ["dairy_free", "vegan"] as GelatoLabelId[] },
    { name: "Hazelnut", labels: ["nuts"] as GelatoLabelId[] },
    { name: "Biscoff", labels: ["soy", "gluten"] as GelatoLabelId[] },
    { name: "Apple Pie", labels: ["gluten"] as GelatoLabelId[] },
    { name: "Oat Swirl", labels: ["dairy_free"] as GelatoLabelId[] },
  ];
  const sheet = buildDietarySheet(flavours);
  const rows = (col: "left" | "right", id: GelatoLabelId) => (sheet[col].find((s) => s.id === id)?.rows ?? []).map((r) => r.text);

  it("two columns in the laminated order", () => {
    expect(sheet.left.map((s) => s.heading)).toEqual(["Dairy Free", "Vegan", "Contains Egg", "Contains Soy"]);
    expect(sheet.right.map((s) => s.heading)).toEqual(["Contains Nuts", "Contains Gluten"]);
  });
  it("prints the fixed rows first, then flavours A to Z", () => {
    expect(rows("right", "gluten")).toEqual(["Plain Cones", "Apple Pie", "Biscoff"]);
    expect(rows("left", "soy")).toEqual(["Plain Cones", "Biscoff", "Vegan Chocolate"]);
    expect(rows("right", "nuts")).toEqual(["Hazelnut", "Vegan Chocolate"]);
    expect(rows("left", "egg")).toEqual([]);
  });
  it("sorbets and vegan gelatos are covered by their rule line, other dairy free flavours are listed", () => {
    expect(rows("left", "dairy_free")).toEqual(["Plain Cones", "All sorbets", "All vegan gelatos", "Oat Swirl"]);
    expect(rows("left", "vegan")).toEqual(["Plain Cones", "All sorbets", "Vegan Chocolate"]);
  });
  it("every heading has a colour block and the layout constants are plain data", () => {
    for (const s of [...sheet.left, ...sheet.right]) expect(s.swatch).toMatch(/^#[0-9A-F]{6}$/i);
    expect([...DIETARY_SHEET.left, ...DIETARY_SHEET.right].map((c) => c.id)).toEqual([...GELATO_LABEL_IDS]);
  });
  it("recognises sorbets and vegan gelatos by name only for the sheet's rule lines", () => {
    expect(isSorbetName("superlemon sorbet")).toBe(true);
    expect(isSorbetName("Sorbetto Mix")).toBe(false);
    expect(isVeganGelatoName("Vegan Chocolate")).toBe(true);
    expect(isVeganGelatoName("Chocolate Vegan")).toBe(false);
  });
});

/* ------------------------------------------------------------------ guards on the screens */

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("gelato flavour page", () => {
  const editor = read("components/editor/recipe-editor.tsx");
  it("shows Dietary Requirements for a flavour and no longer the generic allergen group", () => {
    // a flavour gets Dietary Requirements; a food dish has its own Allergens And Dietary card; everything else keeps the roll-up panel
    expect(editor).toMatch(/isFlavour\s*\?\s*\(\s*<GelatoDietary[^>]*\/>\s*\)\s*:\s*isFood\s*\?\s*null\s*:\s*\(\s*<>[\s\S]*?<RecipeAllergens/);
    expect(editor.match(/<RecipeAllergens/g)).toHaveLength(1);
  });
  it("the draft diff names the new field", () => {
    expect(read("lib/draft-changes.ts")).toContain("dietary_labels");
  });
});

describe("editing helpers", () => {
  it("ticking Vegan ticks Dairy Free; unticking Dairy Free unticks Vegan", () => {
    expect(toggleGelatoLabel([], "vegan", true)).toEqual(["dairy_free", "vegan"]);
    expect(toggleGelatoLabel(["dairy_free", "vegan", "nuts"], "dairy_free", false)).toEqual(["nuts"]);
    expect(toggleGelatoLabel(["dairy_free", "vegan"], "vegan", false)).toEqual(["dairy_free"]);
  });
  it("keeps the sheet's order whatever order labels are ticked in", () => {
    expect(toggleGelatoLabel(["gluten"], "egg", true)).toEqual(["egg", "gluten"]);
    expect(toggleGelatoLabel(["egg"], "egg", false)).toEqual([]);
  });
  it("says what differs in plain words", () => {
    expect(differenceNote(["soy"], [])).toBe("The ingredients suggest Contains Soy. Your list does not.");
    expect(differenceNote([], ["egg"])).toBe("Your list has Contains Egg. The ingredients do not suggest it.");
    expect(differenceNote(["soy", "nuts"], ["egg", "gluten"])).toBe("The ingredients suggest Contains Soy and Contains Nuts. Your list does not. Your list has Contains Egg and Contains Gluten. The ingredients do not suggest them.");
    expect(differenceNote([], [])).toBeNull();
    expect(labelList(["dairy_free", "vegan", "egg"])).toBe("Dairy Free, Vegan and Contains Egg");
    expect(shortNames(["A", "B", "C", "D"])).toBe("A, B and 2 more");
    expect(shortNames(["A", "B"])).toBe("A, B");
  });
  it("no UI text uses a dash", () => {
    const src = [read("components/editor/gelato-dietary.tsx"), read("app/(app)/gelato/dietary/page.tsx"), read("lib/gelato-labels.ts")].join("\n");
    const strings = src.match(/"[^"\n]{12,}"/g) ?? [];
    for (const str of strings) expect(str, str).not.toMatch(/—|–/);
  });
});

describe("migration, schema and seed", () => {
  const mig = read("supabase/migrations/20261005100000_gelato_dietary_labels.sql");
  const code = mig.replace(/--.*$/gm, "");
  const schema = read("supabase/schema.sql");
  const squash = (x: string) => x.replace(/\s+/g, " ").trim();
  it("adds a nullable text[] column with no default, restricted to the six ids, idempotently", () => {
    const c = squash(code);
    expect(c).toContain("add column if not exists dietary_labels text[]");
    expect(c).not.toMatch(/default|not null/i);
    for (const id of GELATO_LABEL_IDS) expect(c).toContain(`'${id}'`);
  });
  it("is mirrored in supabase/schema.sql", () => {
    expect(squash(schema)).toContain(squash(code).replace(/;$/, ""));
  });
  it("the seed sets exactly what the sheet says, for the flavours on the sheet, and nothing else", () => {
    const seed = read("supabase/seed-gelato-dietary-labels.sql");
    const rows = [...seed.matchAll(/\('([^']+)',\s+array\[([^\]]*)\]\)/g)].map((m) => ({ prep: m[1], labels: [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) }));
    const real = buildReal();
    const sheet = sheetLabels();
    const want = new Map<string, GelatoLabelId[]>();
    for (const f of real.flavours) {
      const labels = new Set<GelatoLabelId>(sheet.get(f.name) ?? []);
      if (isSorbetName(f.name) || isVeganGelatoName(f.name)) {
        labels.add("dairy_free");
        labels.add("vegan");
      }
      if (labels.size) want.set(f.prep.name, GELATO_LABEL_IDS.filter((l) => labels.has(l)));
    }
    expect(rows).toHaveLength(22);
    expect(new Set(rows.map((r) => r.prep)).size).toBe(22);
    for (const r of rows) expect(cleanGelatoLabels(r.labels), r.prep).toEqual(want.get(r.prep));
    expect(new Set(rows.map((r) => r.prep))).toEqual(new Set(want.keys()));
  });
});
