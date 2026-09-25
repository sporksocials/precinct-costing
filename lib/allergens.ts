import { MAX_PREP_DEPTH, parentKey, type CostingIndex } from "./costing";
import { flavourName, parseVirtualItemId } from "./gelato";
import { isBeerItemId, parseBeerItemId } from "./beer";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "./types";

/**
 * Allergens: ticked on INGREDIENTS; preps and dishes inherit through their recipe lines (nested preps, cycle-safe).
 * The chef can add / remove an allergen on a prep or dish and write a "made without" note.
 *
 * SAFETY MODEL (this is a guide, never a guarantee):
 *  - confirmed  : a person ticked it on the ingredient (cost_ingredients.allergens / diet_flags).
 *  - suggested  : a keyword rule matched the ingredient name (never stored). Shown as "May contain (unconfirmed)".
 *  - unreviewed : nobody has marked the ingredient as reviewed (allergens_reviewed = false). Suggestions only apply
 *                 to unreviewed ingredients; marking one reviewed means the ticks are the truth.
 *  - a dish is only ever "free from" X when EVERY ingredient (through every nested prep) is reviewed and X is not
 *    contained. Any unreviewed ingredient, missing component, cycle or over-deep nesting keeps the dish "not reviewed".
 *
 * DIET: Vegetarian / Vegan are derived, not ticked. Ingredients carry animal flags (meat, fish, dairy, egg, honey):
 * ticked explicitly in cost_ingredients.diet_flags, and implied by allergens (milk -> dairy, egg -> egg,
 * fish / crustacea / molluscs -> fish). Vegetarian = no meat or fish flag. Vegan = none of the five flags.
 * Chef add / remove overrides change the allergen columns only; they never change the diet tags.
 */

export type AllergenGroup = "required" | "extra";

export interface AllergenDef {
  id: AllergenId;
  label: string;
  /** short header for the matrix grid */
  short: string;
  group: AllergenGroup;
}

export const ALLERGEN_IDS = [
  // Australian required (FSANZ) list
  "gluten",
  "crustacea",
  "egg",
  "fish",
  "milk",
  "peanuts",
  "sesame",
  "soy",
  "tree_nuts",
  "lupin",
  "molluscs",
  "sulphites",
  // chef extras
  "chilli",
  "onion_garlic",
  "alcohol",
] as const;
export type AllergenId = (typeof ALLERGEN_IDS)[number];

export const ALLERGENS: AllergenDef[] = [
  { id: "gluten", label: "Gluten", short: "Gluten", group: "required" },
  { id: "crustacea", label: "Crustacea", short: "Crustacea", group: "required" },
  { id: "egg", label: "Egg", short: "Egg", group: "required" },
  { id: "fish", label: "Fish", short: "Fish", group: "required" },
  { id: "milk", label: "Milk", short: "Milk", group: "required" },
  { id: "peanuts", label: "Peanuts", short: "Peanuts", group: "required" },
  { id: "sesame", label: "Sesame", short: "Sesame", group: "required" },
  { id: "soy", label: "Soy", short: "Soy", group: "required" },
  { id: "tree_nuts", label: "Tree Nuts", short: "Tree Nuts", group: "required" },
  { id: "lupin", label: "Lupin", short: "Lupin", group: "required" },
  { id: "molluscs", label: "Molluscs", short: "Molluscs", group: "required" },
  { id: "sulphites", label: "Sulphites", short: "Sulphites", group: "required" },
  { id: "chilli", label: "Chilli", short: "Chilli", group: "extra" },
  { id: "onion_garlic", label: "Onion & Garlic", short: "Onion & Garlic", group: "extra" },
  { id: "alcohol", label: "Alcohol", short: "Alcohol", group: "extra" },
];

const ALLERGEN_BY_ID = new Map(ALLERGENS.map((a) => [a.id, a]));
export function allergenLabel(id: string): string {
  return ALLERGEN_BY_ID.get(id as AllergenId)?.label ?? id;
}
export function isAllergenId(id: string): id is AllergenId {
  return ALLERGEN_BY_ID.has(id as AllergenId);
}

export const ANIMAL_FLAGS = ["meat", "fish", "dairy", "egg", "honey"] as const;
export type AnimalFlag = (typeof ANIMAL_FLAGS)[number];
export const ANIMAL_LABELS: Record<AnimalFlag, string> = { meat: "Meat", fish: "Fish & Seafood", dairy: "Dairy", egg: "Egg", honey: "Honey" };
export function isAnimalFlag(id: string): id is AnimalFlag {
  return (ANIMAL_FLAGS as readonly string[]).includes(id);
}

/** which animal flags an allergen implies */
const IMPLIES: Partial<Record<AllergenId, AnimalFlag>> = { milk: "dairy", egg: "egg", fish: "fish", crustacea: "fish", molluscs: "fish" };

export const CHEF_SOURCE = "Chef";

/** Sentence for the matrix and every roll-up. */
export const ALLERGEN_NOTICE = "A guide only. Confirm with the chef and check supplier labels.";

/* ------------------------------------------------------------------ keyword rules */

interface Rule {
  terms: string[];
  allergens?: AllergenId[];
  animal?: AnimalFlag[];
  /** phrases removed before this rule looks at the text (e.g. "coconut milk" is not milk) */
  strip?: RegExp;
  /** skip the rule when the text says so (e.g. "gluten free") */
  skip?: RegExp;
}

const PLANT_MILKS = /\b(coconut|almond|oat|soy|soya|rice|cashew|hemp|pea|macadamia|nut|cocoa|cacao|shea|peanut|apple|butter)\s+(milk|cream|butter|yoghurt|yogurt|cheese)\b|\b(butter\s?(bean|lettuce|nut|cup|fly|scotch)|cream of tartar|cream soda|cream cracker|cocoa butter)\b/g;
const NOT_BEER = /\b(ginger|root)\s+(beer|ale)\b/g;
const GLUTEN_FREE = /\bgluten[\s-]?free\b|\bgf\b/;
const NOT_GLUTEN_FLOUR = /\b(rice|corn|maize|tapioca|potato|chickpea|coconut|almond|buckwheat|quinoa|lentil|cassava|arrowroot|soy|besan)\s+(flour|bread|pasta|noodles?|crumbs?|wrap|tortilla|cracker)s?\b|\b(cornflour|cornstarch)\b/g;

const GLUTEN_STRIP = new RegExp(`${NOT_GLUTEN_FLOUR.source}|${NOT_BEER.source}`, "g");

const RULES: Rule[] = [
  {
    allergens: ["gluten"],
    skip: GLUTEN_FREE,
    strip: GLUTEN_STRIP,
    terms: [
      "flour", "bread", "flatbread", "breadcrumb", "crumb", "pasta", "spaghetti", "penne", "linguine", "fettuccine", "tagliatelle", "lasagne", "lasagna", "gnocchi", "ravioli",
      "bun", "brioche", "sourdough", "ciabatta", "focaccia", "baguette", "pita", "pizza", "tortilla", "wrap", "wheat", "panko", "semolina", "couscous", "barley", "rye", "oat", "oats", "spelt",
      "malt", "beer", "ale", "lager", "stout", "cracker", "biscuit", "cookie", "wafer", "cone", "pastry", "filo", "phyllo", "puff", "wonton", "dumpling", "batter", "tempura", "crouton",
      "udon", "ramen", "noodle", "soy sauce", "teriyaki", "hoisin", "worcestershire", "bechamel", "cake", "cheesecake", "tart", "scone", "muffin", "donut", "doughnut", "waffle", "pancake", "crepe", "farro", "bulgur", "seitan",
    ],
  },
  { allergens: ["crustacea"], terms: ["prawn", "shrimp", "crab", "lobster", "yabby", "yabbie", "crayfish", "crawfish", "langoustine", "scampi", "krill", "moreton bay bug", "balmain bug", "belacan"] },
  { allergens: ["molluscs"], terms: ["squid", "calamari", "octopus", "oyster", "mussel", "clam", "scallop", "abalone", "cuttlefish", "pipi", "whelk", "snail", "escargot", "vongole", "oyster sauce"] },
  {
    allergens: ["fish"],
    terms: [
      "fish", "barramundi", "barra", "kingfish", "anchovy", "anchovies", "salmon", "tuna", "dory", "snapper", "cod", "trout", "whiting", "mackerel", "sardine", "pilchard", "herring", "eel",
      "mullet", "trevally", "bonito", "katsuobushi", "dashi", "mahi mahi", "swordfish", "halibut", "flathead", "bream", "hoki", "basa", "grouper", "coral trout", "whitebait", "roe", "caviar", "taramasalata",
      "surimi", "gravlax", "worcestershire", "caesar", "nam pla", "fish sauce",
    ],
  },
  {
    allergens: ["egg"],
    terms: ["egg", "mayo", "mayonnaise", "aioli", "hollandaise", "bearnaise", "kewpie", "meringue", "pavlova", "custard", "brioche", "yolk", "albumen", "carbonara", "quiche", "frittata", "tartare sauce", "tartar sauce", "caesar", "cheesecake", "eggnog", "zabaglione"],
  },
  {
    allergens: ["milk"],
    strip: PLANT_MILKS,
    terms: [
      "milk", "milkshake", "cream", "butter", "buttermilk", "cheese", "mozzarella", "parmesan", "parmigiano", "grana padano", "cheddar", "ricotta", "mascarpone", "feta", "halloumi", "haloumi", "gruyere", "brie",
      "camembert", "gorgonzola", "provolone", "pecorino", "burrata", "bocconcini", "cream cheese", "yoghurt", "yogurt", "whey", "casein", "lactose", "ghee", "custard", "gelato", "ice cream", "aioli",
      "paneer", "labneh", "tzatziki", "bechamel", "pesto", "white chocolate", "milk chocolate", "cheesecake", "carbonara", "dulce de leche", "condensed milk", "kefir", "raita", "creme fraiche", "sour cream",
    ],
  },
  { allergens: ["peanuts"], terms: ["peanut", "satay", "groundnut", "monkey nut"] },
  {
    allergens: ["tree_nuts"],
    terms: ["almond", "cashew", "walnut", "pistachio", "pistacchio", "hazelnut", "macadamia", "pecan", "brazil nut", "pine nut", "pinenut", "praline", "nutella", "frangipane", "marzipan", "amaretto", "orgeat", "mixed nuts", "nut butter", "nut meal", "dukkah", "pesto", "gianduja", "nougat"],
  },
  { allergens: ["sesame"], terms: ["sesame", "tahini", "gomasio", "hummus", "halva", "halvah", "zaatar", "dukkah", "hoisin"] },
  { allergens: ["soy"], terms: ["soy", "soya", "soybean", "tofu", "tempeh", "edamame", "miso", "tamari", "lecithin", "teriyaki", "hoisin", "kecap manis"] },
  { allergens: ["lupin"], terms: ["lupin", "lupine"] },
  {
    allergens: ["sulphites"],
    terms: ["wine", "vinegar", "balsamic", "dried apricot", "sultana", "raisin", "dried fruit", "currant", "sulphite", "sulfite", "prosecco", "champagne", "cider", "sparkling", "pickle", "pickled", "sherry", "vermouth", "port"],
  },
  { allergens: ["chilli"], terms: ["chilli", "chili", "chile", "sriracha", "jalapeno", "habanero", "cayenne", "harissa", "sambal", "gochujang", "tabasco", "chipotle", "peri peri", "piri piri", "birds eye", "kimchi", "hot sauce", "nduja"] },
  { allergens: ["onion_garlic"], terms: ["onion", "garlic", "shallot", "eschalot", "leek", "chive", "scallion", "spring onion", "aioli", "pesto", "tzatziki", "sofrito", "soffritto", "mirepoix", "french onion"] },
  {
    allergens: ["alcohol"],
    strip: NOT_BEER,
    terms: [
      "rum", "vodka", "gin", "whisky", "whiskey", "bourbon", "scotch", "tequila", "mezcal", "brandy", "cognac", "liqueur", "wine", "prosecco", "champagne", "beer", "ale", "lager", "stout", "cider", "aperol", "campari", "vermouth",
      "amaretto", "kahlua", "baileys", "sake", "mirin", "sherry", "port", "triple sec", "cointreau", "schnapps", "absinthe", "pisco", "bitters", "spirit", "spirits", "limoncello", "sambuca", "marsala", "madeira", "grappa",
    ],
  },
  {
    animal: ["meat"],
    terms: [
      "beef", "pork", "chicken", "lamb", "bacon", "ham", "prosciutto", "salami", "chorizo", "sausage", "duck", "turkey", "veal", "mince", "steak", "brisket", "ribs", "pancetta", "guanciale", "pepperoni", "gelatin", "gelatine",
      "lard", "jerky", "wagyu", "venison", "rabbit", "kangaroo", "pulled pork", "bone broth", "meatball", "mortadella", "speck", "nduja", "goat meat", "oxtail", "tripe", "pate", "foie gras", "worcestershire",
    ],
  },
  { animal: ["honey"], terms: ["honey", "hot honey", "mead"] },
];

/** lower-case, accents and apostrophes removed, "&" spoken */
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ");
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Compiled {
  rule: Rule;
  re: RegExp;
}
const COMPILED: Compiled[] = RULES.map((rule) => {
  const alts = [...new Set(rule.terms)].sort((a, b) => b.length - a.length).map((t) => esc(t).replace(/ /g, "[\\s-]+") + "(?:e?s|ed)?");
  return { rule, re: new RegExp(`(?:^|[^a-z])(${alts.join("|")})(?![a-z])`) };
});

export interface Suggestion {
  id: AllergenId;
  /** the word in the name that matched */
  keyword: string;
}
export interface DietSuggestion {
  flag: AnimalFlag;
  keyword: string;
}

function scan(text: string): { allergens: Suggestion[]; animal: DietSuggestion[] } {
  const t = normalise(text);
  const allergens = new Map<AllergenId, string>();
  const animal = new Map<AnimalFlag, string>();
  for (const { rule, re } of COMPILED) {
    if (rule.skip && rule.skip.test(t)) continue;
    const subject = rule.strip ? t.replace(rule.strip, " ") : t;
    const m = re.exec(subject);
    if (!m) continue;
    const kw = m[1].replace(/[\s-]+/g, " ");
    for (const id of rule.allergens ?? []) if (!allergens.has(id)) allergens.set(id, kw);
    for (const f of rule.animal ?? []) if (!animal.has(f)) animal.set(f, kw);
  }
  for (const [id, kw] of allergens) {
    const f = IMPLIES[id];
    if (f && !animal.has(f)) animal.set(f, kw);
  }
  return { allergens: [...allergens].map(([id, keyword]) => ({ id, keyword })), animal: [...animal].map(([flag, keyword]) => ({ flag, keyword })) };
}

/**
 * Keyword suggestions for an ingredient name (and its supplier description, when known).
 * Word-boundary matching: "eggplant" is not egg, "ginger beer" is not beer, "coconut milk" is not milk.
 * A suggestion is only ever a suggestion: it never counts as confirmed.
 */
export function suggestAllergens(name: string, supplierDescription?: string | null): Suggestion[] {
  return scan(`${name} ${supplierDescription ?? ""}`).allergens;
}

/** Animal-product flags a name suggests (meat, honey by keyword; dairy, egg, fish from the allergen matches). */
export function suggestDietFlags(name: string, supplierDescription?: string | null): DietSuggestion[] {
  return scan(`${name} ${supplierDescription ?? ""}`).animal;
}

/* ------------------------------------------------------------------ ingredient state */

export interface IngredientAllergenState {
  reviewed: boolean;
  /** ticked by a person */
  confirmed: AllergenId[];
  /** ticked by a person, plus implied by the confirmed allergens */
  confirmedAnimal: AnimalFlag[];
  /** the ones a person explicitly ticked (a subset of confirmedAnimal) */
  tickedAnimal: AnimalFlag[];
  /** keyword matches not yet confirmed (always empty once reviewed) */
  suggested: Suggestion[];
  suggestedAnimal: DietSuggestion[];
}

function cleanAllergens(xs: readonly string[] | null | undefined): AllergenId[] {
  return [...new Set((xs ?? []).filter(isAllergenId))];
}
function cleanAnimal(xs: readonly string[] | null | undefined): AnimalFlag[] {
  return [...new Set((xs ?? []).filter(isAnimalFlag))];
}

export function ingredientAllergenState(ing: Pick<Ingredient, "name" | "allergens" | "allergens_reviewed" | "diet_flags">, supplierDescription?: string | null): IngredientAllergenState {
  const reviewed = !!ing.allergens_reviewed;
  const confirmed = cleanAllergens(ing.allergens);
  const ticked = cleanAnimal(ing.diet_flags);
  const implied = new Set<AnimalFlag>(ticked);
  for (const id of confirmed) {
    const f = IMPLIES[id];
    if (f) implied.add(f);
  }
  if (reviewed) return { reviewed, confirmed, confirmedAnimal: [...implied], tickedAnimal: ticked, suggested: [], suggestedAnimal: [] };
  const s = scan(`${ing.name} ${supplierDescription ?? ""}`);
  return {
    reviewed,
    confirmed,
    confirmedAnimal: [...implied],
    tickedAnimal: ticked,
    suggested: s.allergens.filter((x) => !confirmed.includes(x.id)),
    suggestedAnimal: s.animal.filter((x) => !implied.has(x.flag)),
  };
}

/** True when the allergens migration has been applied (the row carries the columns). */
export function allergensReady(row: object | null | undefined): boolean {
  return !!row && ("allergens" in row || "allergen_add" in row || "allergens_reviewed" in row);
}

/* ------------------------------------------------------------------ roll-up */

export type CellState = "contains" | "may_contain" | "none";

export interface AllergenCell {
  state: CellState;
  /** ingredient names (or "Chef") that put it here, sorted */
  sources: string[];
  /** the chef added it here, or cleared it (see `was` for what they cleared) */
  chef: null | "added" | "removed";
  was: string[];
  /** "made without" note for this allergen, e.g. "no aioli" */
  note: string | null;
}

export interface AnimalCell {
  state: CellState;
  sources: string[];
}

export type DietState = "yes" | "no" | "maybe" | "unknown";
export interface DietTag {
  id: "vegetarian" | "vegan";
  label: string;
  state: DietState;
  /** the ingredients that make it "no" or "maybe" */
  because: string[];
}

export interface Rollup {
  cells: Record<AllergenId, AllergenCell>;
  animal: Record<AnimalFlag, AnimalCell>;
  diet: { vegetarian: DietTag; vegan: DietTag };
  ingredientCount: number;
  /** names of ingredients nobody has reviewed (plus missing / cyclic / too-deep components) */
  unreviewed: string[];
  unreviewedCount: number;
  /** the real ingredients among them (id + name), for one-tap review; excludes missing / cyclic / too-deep components */
  unreviewedIngredients: { id: string; name: string }[];
  /** every ingredient reviewed, and there is at least one: the only case where "free from" may be shown */
  reviewed: boolean;
  problems: ("cycle" | "depth" | "missing")[];
}

export interface AllergenIndex extends CostingIndex {
  /** menu items by id (for the dish's own overrides and notes) */
  items?: Map<string, MenuItem>;
}

interface Acc {
  confirmed: Map<string, Set<string>>;
  suggested: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
  ingredients: Map<string, { name: string; reviewed: boolean }>;
  problems: Set<"cycle" | "depth" | "missing">;
}
const K_A = "a:";
const K_D = "d:";

function newAcc(): Acc {
  return { confirmed: new Map(), suggested: new Map(), removed: new Map(), ingredients: new Map(), problems: new Set() };
}
function put(m: Map<string, Set<string>>, key: string, src: string) {
  const s = m.get(key);
  if (s) s.add(src);
  else m.set(key, new Set([src]));
}
function mergeInto(into: Acc, from: Acc) {
  for (const [k, v] of from.confirmed) for (const s of v) put(into.confirmed, k, s);
  for (const [k, v] of from.suggested) for (const s of v) put(into.suggested, k, s);
  for (const [k, v] of from.removed) for (const s of v) put(into.removed, k, s);
  for (const [k, v] of from.ingredients) if (!into.ingredients.has(k)) into.ingredients.set(k, v);
  for (const p of from.problems) into.problems.add(p);
}

function addIngredient(acc: Acc, ing: Ingredient, beerLine: boolean) {
  const st = ingredientAllergenState(ing);
  acc.ingredients.set(ing.id, { name: ing.name, reviewed: st.reviewed });
  for (const id of st.confirmed) put(acc.confirmed, K_A + id, ing.name);
  for (const f of st.confirmedAnimal) put(acc.confirmed, K_D + f, ing.name);
  for (const s of st.suggested) put(acc.suggested, K_A + s.id, ing.name);
  for (const s of st.suggestedAnimal) put(acc.suggested, K_D + s.flag, ing.name);
  if (beerLine && !st.reviewed && !/\b(cider|seltzer|gluten[\s-]?free)\b/i.test(ing.name)) {
    // a tap beer keg: barley and alcohol are suggested even when the keg's name does not say "beer"
    if (!st.confirmed.includes("gluten")) put(acc.suggested, K_A + "gluten", ing.name);
    if (!st.confirmed.includes("alcohol")) put(acc.suggested, K_A + "alcohol", ing.name);
  }
}

function pseudoUnreviewed(acc: Acc, key: string, name: string, problem: "cycle" | "depth" | "missing") {
  acc.ingredients.set(key, { name, reviewed: false });
  acc.problems.add(problem);
}

function applyOverrides(acc: Acc, add: readonly string[] | null | undefined, remove: readonly string[] | null | undefined) {
  const adds = cleanAllergens(add);
  for (const id of adds) {
    put(acc.confirmed, K_A + id, CHEF_SOURCE);
    acc.removed.delete(K_A + id);
  }
  for (const id of cleanAllergens(remove)) {
    if (adds.includes(id)) continue;
    const key = K_A + id;
    const was = new Set<string>([...(acc.confirmed.get(key) ?? []), ...(acc.suggested.get(key) ?? [])]);
    was.delete(CHEF_SOURCE);
    acc.confirmed.delete(key);
    acc.suggested.delete(key);
    acc.removed.set(key, was);
  }
}

interface Ctx {
  index: AllergenIndex;
  cache: Map<string, Acc>;
}
const CACHES = new WeakMap<object, Map<string, Acc>>();
function ctxFor(index: AllergenIndex): Ctx {
  let cache = CACHES.get(index);
  if (!cache) {
    cache = new Map();
    CACHES.set(index, cache);
  }
  return { index, cache };
}

function walkLines(lines: RecipeLine[], ctx: Ctx, depth: number, stack: string[], beer: boolean): Acc {
  const acc = newAcc();
  for (const l of lines) {
    if (!l.component_id) continue; // a blank line still being built
    if (l.component_type === "ingredient") {
      const ing = ctx.index.ingredients.get(l.component_id);
      if (!ing) pseudoUnreviewed(acc, `missing:${l.component_id}`, "Unknown ingredient", "missing");
      else addIngredient(acc, ing, beer);
    } else {
      const prep = ctx.index.preps.get(l.component_id);
      if (!prep) pseudoUnreviewed(acc, `missing:${l.component_id}`, "Unknown prep", "missing");
      else if (stack.includes(prep.id)) pseudoUnreviewed(acc, `cycle:${prep.id}`, `${prep.name} (loops back on itself)`, "cycle");
      else if (depth + 1 > MAX_PREP_DEPTH) pseudoUnreviewed(acc, `depth:${prep.id}`, `${prep.name} (nested too deeply to check)`, "depth");
      else mergeInto(acc, prepAcc(prep, ctx, depth + 1, stack));
    }
  }
  return acc;
}

function prepAcc(prep: Prep, ctx: Ctx, depth: number, stack: string[]): Acc {
  const hit = ctx.cache.get(prep.id);
  if (hit) return hit;
  const acc = walkLines(ctx.index.linesByParent.get(parentKey("prep", prep.id)) ?? [], ctx, depth, [...stack, prep.id], false);
  applyOverrides(acc, prep.allergen_add, prep.allergen_remove);
  if (acc.problems.size === 0) ctx.cache.set(prep.id, acc);
  return acc;
}

function finish(acc: Acc, notes: Record<string, string> | null | undefined): Rollup {
  const sorted = (s: Set<string> | undefined) => [...(s ?? [])].sort((a, b) => a.localeCompare(b));
  const cells = {} as Record<AllergenId, AllergenCell>;
  for (const a of ALLERGEN_IDS) {
    const key = K_A + a;
    const conf = acc.confirmed.get(key);
    const sug = acc.suggested.get(key);
    const note = notes && typeof notes[a] === "string" && notes[a].trim() ? notes[a].trim() : null;
    if (conf && conf.size) cells[a] = { state: "contains", sources: sorted(conf), chef: conf.has(CHEF_SOURCE) ? "added" : null, was: [], note };
    else if (sug && sug.size) cells[a] = { state: "may_contain", sources: sorted(sug), chef: null, was: [], note };
    else if (acc.removed.has(key)) cells[a] = { state: "none", sources: [CHEF_SOURCE], chef: "removed", was: sorted(acc.removed.get(key)), note };
    else cells[a] = { state: "none", sources: [], chef: null, was: [], note };
  }
  const animal = {} as Record<AnimalFlag, AnimalCell>;
  for (const f of ANIMAL_FLAGS) {
    const conf = acc.confirmed.get(K_D + f);
    const sug = acc.suggested.get(K_D + f);
    animal[f] = conf && conf.size ? { state: "contains", sources: sorted(conf) } : sug && sug.size ? { state: "may_contain", sources: sorted(sug) } : { state: "none", sources: [] };
  }
  const unreviewed = [...acc.ingredients.values()].filter((i) => !i.reviewed).map((i) => i.name).sort((a, b) => a.localeCompare(b));
  const unreviewedIngredients = [...acc.ingredients.entries()]
    .filter(([k, i]) => !i.reviewed && !k.includes(":"))
    .map(([id, i]) => ({ id, name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ingredientCount = acc.ingredients.size;
  const reviewed = ingredientCount > 0 && unreviewed.length === 0;
  const diet = dietFrom(animal, reviewed);
  return { cells, animal, diet, ingredientCount, unreviewed, unreviewedCount: unreviewed.length, unreviewedIngredients, reviewed, problems: [...acc.problems] };
}

function dietFrom(animal: Record<AnimalFlag, AnimalCell>, reviewed: boolean): { vegetarian: DietTag; vegan: DietTag } {
  const tag = (id: "vegetarian" | "vegan", label: string, flags: AnimalFlag[]): DietTag => {
    const sure = flags.filter((f) => animal[f].state === "contains");
    if (sure.length) return { id, label, state: "no", because: uniq(sure.flatMap((f) => animal[f].sources)) };
    const maybe = flags.filter((f) => animal[f].state === "may_contain");
    if (maybe.length) return { id, label, state: "maybe", because: uniq(maybe.flatMap((f) => animal[f].sources)) };
    return { id, label, state: reviewed ? "yes" : "unknown", because: [] };
  };
  return { vegetarian: tag("vegetarian", "Vegetarian", ["meat", "fish"]), vegan: tag("vegan", "Vegan", [...ANIMAL_FLAGS]) };
}
function uniq(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

export interface RollupRef {
  kind: "item" | "prep";
  id: string;
}

/**
 * Roll up a dish or prep: every ingredient through its recipe lines, nested preps (depth 5, cycle guard), then the
 * prep's / dish's own chef overrides. Gelato virtual items resolve through their flavour mix prep; tap beer virtual
 * items through their keg (gluten and alcohol suggested unless the keg has been reviewed).
 */
export function rollup(ref: RollupRef, index: AllergenIndex): Rollup {
  const ctx = ctxFor(index);
  if (ref.kind === "prep") {
    const prep = index.preps.get(ref.id);
    if (!prep) return finish(newAcc(), null);
    const acc = prepAcc(prep, ctx, 0, []);
    return finish(acc, prep.allergen_notes);
  }
  const item = index.items?.get(ref.id);
  const acc = walkLines(index.linesByParent.get(parentKey("item", ref.id)) ?? [], ctx, 0, [], isBeerItemId(ref.id));
  applyOverrides(acc, item?.allergen_add, item?.allergen_remove);
  return finish(acc, item?.allergen_notes);
}

/** "Free from X" is only ever claimed for a fully reviewed dish that does not contain X. */
export function isFreeFrom(r: Rollup, id: AllergenId): boolean {
  return r.reviewed && r.cells[id].state === "none";
}

/** Vegetarian and Vegan tags for a roll-up. */
export function dietTags(r: Rollup): DietTag[] {
  return [r.diet.vegetarian, r.diet.vegan];
}

/** A copy of the index where one item or prep (and its lines) is replaced by the version being edited. */
export function withDraft(index: AllergenIndex, kind: "item" | "prep", rec: MenuItem | Prep, lines: RecipeLine[]): AllergenIndex {
  const linesByParent = new Map(index.linesByParent);
  linesByParent.set(parentKey(kind, rec.id), lines);
  if (kind === "prep") return { ...index, preps: new Map(index.preps).set(rec.id, rec as Prep), linesByParent };
  return { ...index, items: new Map(index.items ?? []).set(rec.id, rec as MenuItem), linesByParent };
}

/** Short counts for a summary line. */
export function summarise(r: Rollup): { contains: AllergenId[]; may: AllergenId[] } {
  return {
    contains: ALLERGEN_IDS.filter((a) => r.cells[a].state === "contains"),
    may: ALLERGEN_IDS.filter((a) => r.cells[a].state === "may_contain"),
  };
}

/* ------------------------------------------------------------------ matrix */

export interface MatrixRow {
  key: string;
  name: string;
  venueId: number;
  category: string;
  section: string | null;
  href: string;
  rollup: Rollup;
  /** gelato flavours: the mix only (cones and toppings are separate) */
  mixOnly: boolean;
}

/**
 * One row per dish for the allergy matrix. Gelato flavour x serve virtual items collapse to one row per flavour
 * (the mix), tap beer virtual items to one row per beer (its keg).
 */
export function matrixRows(items: MenuItem[], index: AllergenIndex): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  for (const it of items) {
    if (it.id.startsWith("gelato~")) {
      const p = parseVirtualItemId(it.id);
      const prep = p ? index.preps.get(p.prepId) : null;
      if (!p || !prep) continue;
      const key = `prep:${prep.id}`;
      if (!rows.has(key)) rows.set(key, { key, name: flavourName(prep), venueId: it.venue_id, category: it.category, section: null, href: `/preps/${prep.id}`, rollup: rollup({ kind: "prep", id: prep.id }, index), mixOnly: true });
    } else if (isBeerItemId(it.id)) {
      const p = parseBeerItemId(it.id);
      if (!p) continue;
      const key = `beer:${p.beerId}`;
      if (!rows.has(key)) rows.set(key, { key, name: it.name.replace(/\s+-\s+[^-]*$/, ""), venueId: it.venue_id, category: it.category, section: it.section, href: `/beers/${p.beerId}`, rollup: rollup({ kind: "item", id: it.id }, index), mixOnly: false });
    } else {
      rows.set(`item:${it.id}`, { key: `item:${it.id}`, name: it.name, venueId: it.venue_id, category: it.category, section: it.section, href: `/items/${it.id}`, rollup: rollup({ kind: "item", id: it.id }, index), mixOnly: false });
    }
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
