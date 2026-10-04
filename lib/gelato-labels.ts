import { MAX_PREP_DEPTH, parentKey, type CostingIndex } from "./costing";
import { ingredientAllergenState, normalise } from "./allergens";
import type { Ingredient, Prep, RecipeLine } from "./types";

/**
 * Gelato dietary labels: the six labels on the laminated Gelato Rumba "Dietary Requirements" sheet, and nothing else.
 *
 *   Dairy Free, Vegan, Contains Egg, Contains Soy, Contains Nuts, Contains Gluten
 *
 * Where they come from (cost_preps.dietary_labels):
 *  - NULL  : Automatic. Worked out here from the flavour's ingredients, never stored. A new flavour starts here, so its
 *            labels fill themselves in as ingredients are added.
 *  - array : Set by hand (a person, or the sheet via supabase/seed-gelato-dietary-labels.sql). The full list is stored
 *            and the ingredients no longer change it, but we still compare it with what the ingredients suggest.
 *
 * HOW THE LABELS ARE WORKED OUT (a guide, never a guarantee; always rules on INGREDIENT NAMES, never on flavour names):
 *  - Each ingredient is read through lib/allergens.ts first (ticked allergens, plus its keyword suggestions while the
 *    ingredient is unreviewed), then through GELATO_NAME_RULES below, which know the gelato supplies (pastes, bases,
 *    toppings) the generic keywords do not. A reviewed ingredient is taken at its ticks and the gelato rules stand aside,
 *    exactly like the Menu Labels rule: once a person has reviewed it, their ticks are the truth.
 *  - Nested preps (the White Base) are walked with the same depth limit and cycle guard as the allergen roll-up.
 *  - Contains Egg / Soy / Nuts / Gluten: any ingredient that carries it.
 *  - Dairy Free: nothing in the recipe is dairy (milk, cream, cheese, milk powder, white or milk chocolate, latte bases).
 *  - Vegan: nothing in the recipe comes from an animal (dairy, egg, honey, meat, gelatine, fish).
 *  - Dairy Free and Vegan are claims, so they are only made for a recipe with at least one ingredient and nothing missing,
 *    looping or nested too deeply to check. An empty flavour never claims "free from".
 *
 * Nuts means tree nuts AND peanuts AND coconut (the sheet files Vegan Coconut under Contains Nuts). Almond milk is a nut.
 */

export const GELATO_LABEL_IDS = ["dairy_free", "vegan", "egg", "soy", "nuts", "gluten"] as const;
export type GelatoLabelId = (typeof GELATO_LABEL_IDS)[number];

export interface GelatoLabelDef {
  id: GelatoLabelId;
  /** the heading on the sheet and the chip on the flavour page */
  label: string;
  /** "free" labels are claims the recipe must earn; "contains" labels are warnings */
  kind: "free" | "contains";
}

/** The six labels, in the fixed order the sheet and the flavour page print them. */
export const GELATO_LABELS: GelatoLabelDef[] = [
  { id: "dairy_free", label: "Dairy Free", kind: "free" },
  { id: "vegan", label: "Vegan", kind: "free" },
  { id: "egg", label: "Contains Egg", kind: "contains" },
  { id: "soy", label: "Contains Soy", kind: "contains" },
  { id: "nuts", label: "Contains Nuts", kind: "contains" },
  { id: "gluten", label: "Contains Gluten", kind: "contains" },
];

const LABEL_BY_ID = new Map(GELATO_LABELS.map((l) => [l.id, l]));
export function gelatoLabelText(id: GelatoLabelId): string {
  return LABEL_BY_ID.get(id)?.label ?? id;
}
export function isGelatoLabelId(id: unknown): id is GelatoLabelId {
  return typeof id === "string" && LABEL_BY_ID.has(id as GelatoLabelId);
}

/** Valid ids only, no duplicates, in the fixed order. Anything that is not a list reads as "no labels". */
export function cleanGelatoLabels(xs: readonly unknown[] | null | undefined): GelatoLabelId[] {
  const set = new Set((Array.isArray(xs) ? xs : []).filter(isGelatoLabelId));
  return GELATO_LABEL_IDS.filter((id) => set.has(id));
}

export function sameLabels(a: readonly GelatoLabelId[], b: readonly GelatoLabelId[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/* ------------------------------------------------------------------ name rules */

type Fact = "dairy" | "animal" | "egg" | "soy" | "nuts" | "gluten";

interface NameRule {
  facts: Fact[];
  terms: string[];
  /** where the rule comes from, for the next person who wonders */
  why: string;
}

/**
 * Gelato supplies the generic keywords in lib/allergens.ts do not know. Matching is word-bounded and ignores case,
 * accents and apostrophes ("Maltesers" matches "malteser"; "Crushed Nuts" matches "nuts"; "coconut" does not match "nut").
 *
 * "product" rules are what the product is (ladyfingers in tiramisu, egg white in nougat, wheat in liquorice).
 * "sheet" rules are there because Troy's laminated sheet lists the product under that label and nothing in the name says why.
 */
export const GELATO_NAME_RULES: NameRule[] = [
  { facts: ["dairy", "animal"], terms: ["latte", "panna cotta", "dulce de leche", "yoghurt base", "yogurt base"], why: "product: milk-based bases and pastes (Latte Xtra, Super Latte Base, Panna Cotta)" },
  { facts: ["egg", "animal"], terms: ["tiramisu", "nougat", "torroncino", "torrone", "zabaione", "sabayon"], why: "product: yolk in tiramisu, egg white in nougat" },
  { facts: ["gluten"], terms: ["tiramisu", "biscotto", "biscotti", "arabeschi", "brownie", "pie", "oreo", "biscoff", "lotus", "tim tam", "malteser", "maltesers", "licorice", "liquorice", "gingerbread", "ginger nut"], why: "product: ladyfingers, biscuit, pastry, wheat or malt" },
  { facts: ["gluten"], terms: ["butterscotch", "jaffa"], why: "sheet: Butterscotch and Jaffa are listed under Contains Gluten" },
  { facts: ["soy"], terms: ["oreo", "biscoff", "lotus", "couverture", "tiramisu"], why: "product: lecithin in biscuit and couverture; sheet lists Tiramisu under Contains Soy" },
  { facts: ["nuts"], terms: ["nocciola", "nocciole", "torroncino", "torrone", "nut", "nuts", "coconut", "almond milk", "almond"], why: "product: hazelnut paste, nougat, loose nuts, almond milk; sheet files Vegan Coconut under Contains Nuts" },
];

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const COMPILED_RULES = GELATO_NAME_RULES.map((rule) => {
  const alts = [...new Set(rule.terms)].sort((a, b) => b.length - a.length).map((t) => esc(t).replace(/ /g, "[\\s-]+") + "(?:e?s)?");
  return { rule, re: new RegExp(`(?:^|[^a-z])(${alts.join("|")})(?![a-z])`) };
});

/* ------------------------------------------------------------------ one ingredient */

type IngredientLike = Pick<Ingredient, "name" | "allergens" | "allergens_reviewed" | "diet_flags">;

const FACT_CACHE = new Map<string, readonly Fact[]>();

/** What one ingredient brings to a gelato, by its ticks (reviewed) or its ticks plus keyword and name rules (not reviewed). */
export function ingredientGelatoFacts(ing: IngredientLike): readonly Fact[] {
  const key = JSON.stringify([ing.name, ing.allergens ?? null, !!ing.allergens_reviewed, ing.diet_flags ?? null]);
  const hit = FACT_CACHE.get(key);
  if (hit) return hit;
  // "Caffe Pasta (Cappuccino)" is a flavour paste, not pasta: read it as paste so the wheat keyword does not fire
  const st = ingredientAllergenState({ ...ing, name: ing.name.replace(/\bpasta\b/gi, "paste") });
  const facts = new Set<Fact>();
  const allergens = new Set<string>([...st.confirmed, ...st.suggested.map((s) => s.id)]);
  const animal = new Set<string>([...st.confirmedAnimal, ...st.suggestedAnimal.map((s) => s.flag)]);
  if (allergens.has("milk") || animal.has("dairy")) facts.add("dairy");
  if (allergens.has("egg") || animal.has("egg")) facts.add("egg");
  if (allergens.has("soy")) facts.add("soy");
  if (allergens.has("tree_nuts") || allergens.has("peanuts")) facts.add("nuts");
  if (allergens.has("gluten")) facts.add("gluten");
  if (animal.size) facts.add("animal");
  if (!st.reviewed) {
    const text = normalise(ing.name);
    for (const { rule, re } of COMPILED_RULES) if (re.test(text)) for (const f of rule.facts) facts.add(f);
  }
  if (facts.has("dairy") || facts.has("egg")) facts.add("animal");
  const out = [...facts];
  if (FACT_CACHE.size > 5000) FACT_CACHE.clear();
  FACT_CACHE.set(key, out);
  return out;
}

/* ------------------------------------------------------------------ a whole flavour */

export interface GelatoDerivation {
  /** the labels the ingredients give, in the fixed order */
  labels: GelatoLabelId[];
  /** the ingredient names behind each "Contains" label, and the dairy / animal ingredients that stop a free label */
  sources: Partial<Record<GelatoLabelId, string[]>>;
  /** how many distinct ingredients were read */
  ingredientCount: number;
  /** a missing, looping or too-deep component: the free labels are never claimed while one exists */
  problems: ("cycle" | "depth" | "missing")[];
}

interface Acc {
  facts: Map<Fact, Set<string>>;
  ingredients: Set<string>;
  problems: Set<"cycle" | "depth" | "missing">;
}

function walk(lines: readonly RecipeLine[], index: CostingIndex, depth: number, stack: string[], acc: Acc): void {
  for (const l of lines) {
    if (!l.component_id) continue; // a blank line still being built
    if (l.component_type === "ingredient") {
      const ing = index.ingredients.get(l.component_id);
      if (!ing) {
        acc.problems.add("missing");
        continue;
      }
      acc.ingredients.add(ing.id);
      for (const f of ingredientGelatoFacts(ing)) {
        const s = acc.facts.get(f);
        if (s) s.add(ing.name);
        else acc.facts.set(f, new Set([ing.name]));
      }
    } else {
      const prep = index.preps.get(l.component_id);
      if (!prep) acc.problems.add("missing");
      else if (stack.includes(prep.id)) acc.problems.add("cycle");
      else if (depth + 1 > MAX_PREP_DEPTH) acc.problems.add("depth");
      else walk(index.linesByParent.get(parentKey("prep", prep.id)) ?? [], index, depth + 1, [...stack, prep.id], acc);
    }
  }
}

const sortedNames = (s: Set<string> | undefined) => [...(s ?? [])].sort((a, b) => a.localeCompare(b));

/**
 * The labels a recipe's ingredients give. `lines` are the flavour's own lines (so a draft being edited is worked out live);
 * nested preps are read from the index. `selfId` guards a flavour that (wrongly) uses itself.
 */
export function deriveGelatoLabels(lines: readonly RecipeLine[], index: CostingIndex, selfId?: string): GelatoDerivation {
  const acc: Acc = { facts: new Map(), ingredients: new Set(), problems: new Set() };
  walk(lines, index, 0, selfId ? [selfId] : [], acc);
  const has = (f: Fact) => (acc.facts.get(f)?.size ?? 0) > 0;
  const claim = acc.ingredients.size > 0 && acc.problems.size === 0;
  const labels: GelatoLabelId[] = [];
  const sources: Partial<Record<GelatoLabelId, string[]>> = {};
  if (claim && !has("dairy")) labels.push("dairy_free");
  else if (has("dairy")) sources.dairy_free = sortedNames(acc.facts.get("dairy"));
  if (claim && !has("animal")) labels.push("vegan");
  else if (has("animal")) sources.vegan = sortedNames(acc.facts.get("animal"));
  for (const [id, fact] of [["egg", "egg"], ["soy", "soy"], ["nuts", "nuts"], ["gluten", "gluten"]] as const) {
    if (has(fact)) {
      labels.push(id);
      sources[id] = sortedNames(acc.facts.get(fact));
    }
  }
  return { labels: cleanGelatoLabels(labels), sources, ingredientCount: acc.ingredients.size, problems: [...acc.problems] };
}

export interface GelatoLabelState {
  /** what to show and print: the hand-set list when there is one, else the worked-out one */
  labels: GelatoLabelId[];
  source: "auto" | "set";
  /** what the ingredients suggest (the same as `labels` when automatic) */
  auto: GelatoDerivation;
  /** set by hand AND different from the ingredients: what the list lacks and what it adds */
  missing: GelatoLabelId[];
  extra: GelatoLabelId[];
}

/** The labels for one flavour: stored when a person set them, otherwise worked out from the ingredients. */
export function gelatoLabelsFor(prep: Pick<Prep, "id" | "dietary_labels">, lines: readonly RecipeLine[], index: CostingIndex): GelatoLabelState {
  const auto = deriveGelatoLabels(lines, index, prep.id);
  if (!Array.isArray(prep.dietary_labels)) return { labels: auto.labels, source: "auto", auto, missing: [], extra: [] };
  const labels = cleanGelatoLabels(prep.dietary_labels);
  return {
    labels,
    source: "set",
    auto,
    missing: auto.labels.filter((l) => !labels.includes(l)),
    extra: labels.filter((l) => !auto.labels.includes(l)),
  };
}

/** The labels for a flavour read from the store's index (its own lines under `prep:<id>`). */
export function gelatoLabelsForPrep(prep: Pick<Prep, "id" | "dietary_labels">, index: CostingIndex): GelatoLabelState {
  return gelatoLabelsFor(prep, index.linesByParent.get(parentKey("prep", prep.id)) ?? [], index);
}

/**
 * Tick or untick one label in a list. Vegan always carries Dairy Free (every vegan flavour is dairy free on the sheet),
 * so ticking Vegan ticks Dairy Free too, and unticking Dairy Free unticks Vegan. Returns the full list in the fixed order.
 */
export function toggleGelatoLabel(current: readonly GelatoLabelId[], id: GelatoLabelId, on: boolean): GelatoLabelId[] {
  const set = new Set<GelatoLabelId>(current);
  if (on) {
    set.add(id);
    if (id === "vegan") set.add("dairy_free");
  } else {
    set.delete(id);
    if (id === "dairy_free") set.delete("vegan");
  }
  return GELATO_LABEL_IDS.filter((l) => set.has(l));
}

/** "Contains Soy", "Contains Soy and Contains Nuts", "Dairy Free, Vegan and Contains Egg". */
export function labelList(ids: readonly GelatoLabelId[]): string {
  const names = ids.map(gelatoLabelText);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The plain sentence under a hand-set list that differs from the ingredients, or null when they agree.
 * "The ingredients suggest Contains Soy. Your list does not." / "Your list has Contains Egg. The ingredients do not suggest it."
 */
export function differenceNote(missing: readonly GelatoLabelId[], extra: readonly GelatoLabelId[]): string | null {
  const parts: string[] = [];
  if (missing.length) parts.push(`The ingredients suggest ${labelList(missing)}. Your list does not.`);
  if (extra.length) parts.push(`Your list has ${labelList(extra)}. The ingredients do not suggest ${extra.length === 1 ? "it" : "them"}.`);
  return parts.length ? parts.join(" ") : null;
}

/** Name an ingredient list briefly: "A, B and 2 more". */
export function shortNames(names: readonly string[], max = 2): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/* ------------------------------------------------------------------ the printable sheet */

export const SORBET_RULE = /\bsorbet\b/i;
export const VEGAN_GELATO_RULE = /^vegan\b/i;
/** A sorbet is named so ("superlemon sorbet"); a vegan gelato starts with "Vegan" ("Vegan Chocolate"). Display only. */
export const isSorbetName = (flavour: string): boolean => SORBET_RULE.test(flavour);
export const isVeganGelatoName = (flavour: string): boolean => VEGAN_GELATO_RULE.test(flavour.trim());

export interface SheetColumn {
  id: GelatoLabelId;
  /** the heading colour block (also printed as text, so colour is never the only signal) */
  swatch: string;
  /** rows printed before the flavours: things on the laminated sheet that are not flavours */
  fixed: string[];
  /** a flavour is left out of the list when one of these rules already prints for the heading */
  coveredBy: ((flavour: string) => boolean)[];
}

/**
 * The laminated sheet's layout. Edit here to change what prints: the fixed rows (Plain Cones and the rule lines) and which
 * flavours a rule line already covers. Left column first, then right.
 */
export const DIETARY_SHEET: { left: SheetColumn[]; right: SheetColumn[] } = {
  left: [
    { id: "dairy_free", swatch: "#F4B6D4", fixed: ["Plain Cones", "All sorbets", "All vegan gelatos"], coveredBy: [isSorbetName, isVeganGelatoName] },
    { id: "vegan", swatch: "#B7DFA8", fixed: ["Plain Cones", "All sorbets"], coveredBy: [isSorbetName] },
    { id: "egg", swatch: "#F7E37A", fixed: [], coveredBy: [] },
    { id: "soy", swatch: "#C9C77A", fixed: ["Plain Cones"], coveredBy: [] },
  ],
  right: [
    { id: "nuts", swatch: "#9CC7EA", fixed: [], coveredBy: [] },
    { id: "gluten", swatch: "#9ED69A", fixed: ["Plain Cones"], coveredBy: [] },
  ],
};

export interface SheetSection {
  id: GelatoLabelId;
  heading: string;
  swatch: string;
  /** fixed rows first, then the flavours alphabetically */
  rows: { text: string; fixed: boolean }[];
}

/** The sheet, ready to print: for each heading, its fixed rows then every active flavour carrying the label. */
export function buildDietarySheet(flavours: { name: string; labels: readonly GelatoLabelId[] }[]): { left: SheetSection[]; right: SheetSection[] } {
  const section = (col: SheetColumn): SheetSection => {
    const names = flavours
      .filter((f) => f.labels.includes(col.id) && !col.coveredBy.some((rule) => rule(f.name)))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b));
    return {
      id: col.id,
      heading: gelatoLabelText(col.id),
      swatch: col.swatch,
      rows: [...col.fixed.map((text) => ({ text, fixed: true })), ...names.map((text) => ({ text, fixed: false }))],
    };
  };
  return { left: DIETARY_SHEET.left.map(section), right: DIETARY_SHEET.right.map(section) };
}

