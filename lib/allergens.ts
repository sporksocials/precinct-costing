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
 * FINING AGENTS: wine, beer, cider, spirits and liqueurs are often clarified with isinglass (fish), casein, egg or gelatine,
 * none of which has to be declared. A reviewed drink ingredient with no animal flag therefore reads "maybe" (Not Confirmed)
 * for Vegetarian and Vegan, never "yes", unless it carries the explicit `vegan` marker in diet_flags (see isFiningRisk).
 *
 * GROUPS (Troy, 10 Oct 2026): sulphites are a declared allergen (Food Standards Code, 10 mg/kg or more) and sit in the main
 * "required" list; nitrites are a chef extra; alcohol stays an "attribute", not an allergen (recorded and rolled up under its
 * own id, but summarise() returns it in its own fields and no list or count of allergens includes it). There is no quiet
 * "sensitivity" tier any more. lib/allergen-badges.ts turns a roll-up into the tiers the screens print.
 */

/**
 * required  : the Food Standards Code declared allergens (Schedule 9, which includes sulphites at 10 mg/kg or more), shown as the main allergen badges
 * extra     : chef extras (not law, so Nitrites is here), shown with the main badges
 * attribute : alcohol. Not an allergen: a neutral "Contains Alcohol" attribute shown outside the allergen row
 * The ids stay as stored ('sesame' is displayed as "Seeds"; 'sulphites' and 'alcohol' stay in the arrays); only grouping and display changed.
 */
export type AllergenGroup = "required" | "extra" | "attribute";

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
  "nitrites",
  // attribute (not part of the main allergen list)
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
  { id: "sesame", label: "Seeds", short: "Seeds", group: "required" }, // the id stays "sesame" (it is stored on records); Troy, 10 Oct 2026: shown as "Seeds"
  { id: "soy", label: "Soy", short: "Soy", group: "required" },
  { id: "tree_nuts", label: "Tree Nuts", short: "Tree Nuts", group: "required" },
  { id: "lupin", label: "Lupin", short: "Lupin", group: "required" },
  { id: "molluscs", label: "Molluscs", short: "Molluscs", group: "required" },
  { id: "sulphites", label: "Sulphites", short: "Sulphites", group: "required" }, // Troy, 10 Oct 2026: a main allergen, after Molluscs
  { id: "chilli", label: "Chilli", short: "Chilli", group: "extra" },
  { id: "onion_garlic", label: "Onion & Garlic", short: "Onion & Garlic", group: "extra" },
  { id: "nitrites", label: "Nitrites", short: "Nitrites", group: "extra" }, // not on the FSANZ list, so a chef extra; cured and processed meats
  { id: "alcohol", label: "Alcohol", short: "Contains Alcohol", group: "attribute" },
];

/** The main allergen badges, in the fixed order: required (ending in Sulphites), then chef extras (ending in Nitrites). */
export const CONTAINS_IDS: AllergenId[] = ALLERGENS.filter((a) => a.group === "required" || a.group === "extra").map((a) => a.id);
export const ATTRIBUTE_IDS: AllergenId[] = ALLERGENS.filter((a) => a.group === "attribute").map((a) => a.id);
export function allergenGroup(id: AllergenId): AllergenGroup {
  return ALLERGENS.find((a) => a.id === id)?.group ?? "required";
}

/** Ingredients with these allergens are seafood for the origin label (unless marked exempt). */
export const SEAFOOD_ALLERGENS: AllergenId[] = ["fish", "crustacea", "molluscs"];
export function isSeafoodAllergen(id: string): boolean {
  return (SEAFOOD_ALLERGENS as string[]).includes(id);
}

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

/** Marker stored in cost_ingredients.diet_flags when a person has confirmed a drink or other fined ingredient is vegan (no UI sets it yet). */
export const VEGAN_MARKER = "vegan";

/** Ingredient categories whose products may be fined with animal products (lower case; matched ignoring case and spacing). */
export const FINING_CATEGORIES = ["wine", "spirits", "liqueurs", "beer keg", "packaged beer / cider / rtd", "packaged beer & cider", "rtd"] as const;

function normCategory(c: string | null | undefined): string {
  return (c ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
export function isFiningCategory(category: string | null | undefined): boolean {
  return (FINING_CATEGORIES as readonly string[]).includes(normCategory(category));
}

/** which animal flags an allergen implies */
const IMPLIES: Partial<Record<AllergenId, AnimalFlag>> = { milk: "dairy", egg: "egg", fish: "fish", crustacea: "fish", molluscs: "fish" };

/** The animal flag a ticked allergen implies (milk is dairy, egg is egg, fish, crustacea and molluscs are fish), if any. */
export function impliedAnimalFlag(id: AllergenId): AnimalFlag | undefined {
  return IMPLIES[id];
}

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

/** E numbers and "preservative 2xx" wording for a range of additive codes (E220 to E228 sulphites, E249 to E252 nitrites). */
function ENUMBERS(from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`e${n}`, `preservative ${n}`);
  return out;
}
/** Seeds: "seeded mustard" is wholegrain mustard, and spice seeds are never the Seeds allergen. */
const NOT_SEED_FOOD = /\b(seeded|seed)\s+mustard\b/g;
/** Sulphites: sparkling water and the like are not wine, port salut is cheese, black or red currants are fresh, mustard seed and powder are dry spices. */
const NOT_SULPHITE = /\bsparkling\s+(mineral\s+)?(water|soda|juice|lemonade|mineral)\b|\bport\s+salut\b|\b(black|red|white)\s?currants?\b|\bmustard\s+(seeds?|greens?|powder|oil|cress|leaf|leaves|microgreens?)\b/g;
/** Nitrites: plant "bacon", salt-cured or cured fish, eggs, lemons and olives are not cured meat. */
const NOT_NITRITE = /\b(coconut|vegan|plant|mushroom|veggie|vegetarian)\s+bacon\b|\bsalt[\s-]?cured\b|\bcured\s+(salmon|fish|trout|ocean trout|kingfish|tuna|yolks?|eggs?|lemons?|olives?)\b/g;

/** Molluscs and crustacea: oyster mushrooms and oyster blade are not shellfish, scalloped potatoes are not scallops, crab apples are not crab. */
const NOT_SHELLFISH = /\boyster\s+(mushrooms?|blade|leaf|plant)\b|\bscalloped\b|\bscallop\s+squash\b|\bcrab\s?apples?\b/g;

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
  { allergens: ["crustacea"], strip: NOT_SHELLFISH, terms: ["prawn", "shrimp", "crab", "lobster", "yabby", "yabbie", "crayfish", "crawfish", "langoustine", "scampi", "krill", "moreton bay bug", "balmain bug", "belacan"] },
  { allergens: ["molluscs"], strip: NOT_SHELLFISH, terms: ["squid", "calamari", "octopus", "oyster", "mussel", "clam", "scallop", "abalone", "cuttlefish", "pipi", "whelk", "snail", "escargot", "vongole", "oyster sauce"] },
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
  {
    // SEEDS (stored id "sesame", shown as "Seeds"). Seed foods and their products, not spice seeds: cumin, fennel, caraway,
    // coriander and mustard seed are left out on purpose, and the bare word "seed" is never a term ("seedless", "seeded mustard").
    allergens: ["sesame"],
    strip: NOT_SEED_FOOD,
    terms: [
      "sesame", "tahini", "tahina", "gomasio", "gomashio", "hummus", "humus", "houmous", "halva", "halvah", "zaatar", "zatar", "dukkah", "duqqa", "hoisin", "furikake",
      "sunflower seed", "sunflower kernel", "pumpkin seed", "pepita", "poppy seed", "poppyseed", "chia", "flax", "flaxseed", "linseed", "hemp seed", "hemp heart",
      "mixed seed", "seed mix", "seed blend", "seed and nut", "seeded",
    ],
  },
  { allergens: ["soy"], terms: ["soy", "soya", "soybean", "tofu", "tempeh", "edamame", "miso", "tamari", "lecithin", "teriyaki", "hoisin", "kecap manis"] },
  { allergens: ["lupin"], terms: ["lupin", "lupine"] },
  {
    // SULPHITES (a declared allergen at 10 mg/kg or more): wine and its relatives, vinegar, dried fruit, preserved or
    // preservative-carrying foods. Spirits, plain fresh fruit, glucose syrup and cola post-mix are NOT included.
    allergens: ["sulphites"],
    strip: NOT_SULPHITE,
    terms: [
      // wine, sparkling wine and fortified wine
      "wine", "prosecco", "champagne", "cava", "sparkling", "cider", "vermouth", "sherry", "port", "marsala", "madeira", "sangria",
      "chardonnay", "sauvignon blanc", "sauvignon", "semillon", "riesling", "pinot noir", "pinot grigio", "pinot gris", "shiraz", "merlot", "cabernet", "malbec", "tempranillo", "moscato",
      // vinegar and things kept in it
      "vinegar", "balsamic", "pickle", "pickled", "gherkin", "cornichon",
      // dried fruit and coconut
      "dried fruit", "dried apricot", "dried peach", "dried pear", "dried apple", "dried fig", "dried mango", "dried pineapple", "sultana", "raisin", "currant", "prune", "desiccated coconut", "coconut desiccated", "shredded coconut", "coconut shredded",
      // bottled juice, cordial and soft drink syrups that carry a sulphite preservative
      "bottled lemon juice", "bottled lime juice", "lemon juice bottled", "lime juice bottled", "reconstituted lemon", "reconstituted lime", "lemon juice concentrate", "lime juice concentrate", "juice concentrate", "concentrated juice", "from concentrate", "cordial",
      "fruit squash", "orange squash", "lemon squash", "lime squash", "post mix lemonade", "post mix lemon", "post mix lime", "post mix orange", "post mix fruit", "postmix lemonade", "postmix lemon", "postmix lime", "postmix orange", "postmix fruit",
      // other usual carriers
      "mustard", "sausage", "snag", "chipolata", "bratwurst", "prawn", "shrimp", "jam", "marmalade",
      // named outright
      "sulphite", "sulfite", "metabisulphite", "metabisulfite", "sulphur dioxide", "sulfur dioxide",
      ...ENUMBERS(220, 228),
    ],
  },
  { allergens: ["chilli"], terms: ["chilli", "chili", "chile", "sriracha", "jalapeno", "habanero", "cayenne", "harissa", "sambal", "gochujang", "tabasco", "chipotle", "peri peri", "piri piri", "birds eye", "kimchi", "hot sauce", "nduja"] },
  { allergens: ["onion_garlic"], terms: ["onion", "garlic", "shallot", "eschalot", "leek", "chive", "scallion", "spring onion", "aioli", "pesto", "tzatziki", "sofrito", "soffritto", "mirepoix", "french onion"] },
  {
    // NITRITES (a chef extra, not on the FSANZ list): cured and processed meats, plus the curing agents themselves.
    // Raw pork, chicken, beef and sausage mince, smoked fish and cured fish are NOT nitrite by default.
    allergens: ["nitrites"],
    strip: NOT_NITRITE,
    terms: [
      "bacon", "ham", "leg ham", "gammon", "prosciutto", "pancetta", "salami", "pepperoni", "chorizo", "cabanossi", "kransky", "mortadella", "speck", "bresaola", "jamon", "pastrami", "corned beef", "salt beef",
      "soppressata", "sopressa", "capocollo", "capicola", "coppa", "lardons", "lap cheong", "nduja", "polony", "luncheon meat", "deli meat",
      "frankfurt", "frankfurter", "hot dog", "hotdog",
      "cured", "smoked ham", "smoked sausage", "smoked turkey", "smoked chicken", "smoked duck", "smoked pork", "smoked meat",
      "celery salt", "celery powder", "celery juice powder",
      "nitrite", "nitrate", "saltpetre", "saltpeter", "instacure", "curing salt", "prague powder",
      ...ENUMBERS(249, 252),
    ],
  },
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
      "cabanossi", "kransky", "bresaola", "pastrami", "jamon", "gammon", "frankfurt", "frankfurter", "hot dog", "hotdog", "soppressata", "sopressa", "capocollo", "capicola", "coppa", "lardons", "lap cheong", "polony", "luncheon meat", "deli meat",
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
  /** a person marked this ingredient vegan (diet_flags holds "vegan"): lifts the fining-agent doubt on a drink */
  veganMarked: boolean;
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
  const veganMarked = (ing.diet_flags ?? []).includes(VEGAN_MARKER);
  const implied = new Set<AnimalFlag>(ticked);
  for (const id of confirmed) {
    const f = IMPLIES[id];
    if (f) implied.add(f);
  }
  if (reviewed) return { reviewed, confirmed, confirmedAnimal: [...implied], tickedAnimal: ticked, veganMarked, suggested: [], suggestedAnimal: [] };
  const s = scan(`${ing.name} ${supplierDescription ?? ""}`);
  return {
    reviewed,
    confirmed,
    confirmedAnimal: [...implied],
    tickedAnimal: ticked,
    veganMarked,
    suggested: s.allergens.filter((x) => !confirmed.includes(x.id)),
    suggestedAnimal: s.animal.filter((x) => !implied.has(x.flag)),
  };
}

/** True when the allergens migration has been applied (the row carries the columns). */
export function allergensReady(row: object | null | undefined): boolean {
  return !!row && ("allergens" in row || "allergen_add" in row || "allergens_reviewed" in row);
}

/**
 * True when this ingredient may have been fined with an animal product, so a dish that uses it can never be Vegetarian or
 * Vegan until a person says so. It is a drink by category (Wine, Spirits, Liqueurs, Beer Keg, Packaged Beer / Cider / RTD),
 * or it carries the alcohol allergen tick, or its name reads as an alcoholic ingredient (the kitchen feed has no category,
 * so the tick and the name keep a wine sauce honest there). An explicit `vegan` marker in diet_flags clears it.
 */
export function isFiningRisk(ing: Pick<Ingredient, "name" | "allergens" | "diet_flags"> & { category?: string | null }): boolean {
  if ((ing.diet_flags ?? []).includes(VEGAN_MARKER)) return false;
  if (isFiningCategory(ing.category)) return true;
  if (cleanAllergens(ing.allergens).includes("alcohol")) return true;
  return scan(ing.name).allergens.some((a) => a.id === "alcohol");
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
  /**
   * Seafood ingredients (fish, crustacea or molluscs, not marked exempt) through every nested prep, with the origin set
   * on each (null = not set). Suggested (unreviewed) seafood counts too, so an unset origin is never missed.
   */
  seafood: SeafoodIngredient[];
  /**
   * Reviewed ingredients that may have been fined with animal products (wine, beer, spirits and the like) and are not marked
   * vegan: they keep Vegetarian and Vegan at "maybe" (Not Confirmed) instead of "yes".
   */
  finingRisk: string[];
}

export interface SeafoodIngredient {
  id: string;
  name: string;
  origin: "A" | "I" | null;
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
  seafood: Map<string, SeafoodIngredient>;
  fining: Map<string, string>;
  problems: Set<"cycle" | "depth" | "missing">;
}
const K_A = "a:";
const K_D = "d:";

function newAcc(): Acc {
  return { confirmed: new Map(), suggested: new Map(), removed: new Map(), ingredients: new Map(), seafood: new Map(), fining: new Map(), problems: new Set() };
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
  for (const [k, v] of from.seafood) if (!into.seafood.has(k)) into.seafood.set(k, v);
  for (const [k, v] of from.fining) if (!into.fining.has(k)) into.fining.set(k, v);
  for (const p of from.problems) into.problems.add(p);
}

function addIngredient(acc: Acc, ing: Ingredient, beerLine: boolean) {
  const st = ingredientAllergenState(ing);
  acc.ingredients.set(ing.id, { name: ing.name, reviewed: st.reviewed });
  for (const id of st.confirmed) put(acc.confirmed, K_A + id, ing.name);
  for (const f of st.confirmedAnimal) put(acc.confirmed, K_D + f, ing.name);
  for (const s of st.suggested) put(acc.suggested, K_A + s.id, ing.name);
  for (const s of st.suggestedAnimal) put(acc.suggested, K_D + s.flag, ing.name);
  const isSeafood = st.confirmed.some(isSeafoodAllergen) || st.suggested.some((x) => isSeafoodAllergen(x.id));
  if (isFiningRisk(ing)) acc.fining.set(ing.id, ing.name);
  if (isSeafood && !ing.seafood_exempt) acc.seafood.set(ing.id, { id: ing.id, name: ing.name, origin: ing.seafood_origin === "A" || ing.seafood_origin === "I" ? ing.seafood_origin : null });
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
  const finingRisk = [...new Set(acc.fining.values())].sort((a, b) => a.localeCompare(b));
  const diet = dietFrom(animal, reviewed, finingRisk);
  const seafood = [...acc.seafood.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { cells, animal, diet, ingredientCount, unreviewed, unreviewedCount: unreviewed.length, unreviewedIngredients, reviewed, problems: [...acc.problems], seafood, finingRisk };
}

function dietFrom(animal: Record<AnimalFlag, AnimalCell>, reviewed: boolean, finingRisk: string[]): { vegetarian: DietTag; vegan: DietTag } {
  const tag = (id: "vegetarian" | "vegan", label: string, flags: AnimalFlag[]): DietTag => {
    const sure = flags.filter((f) => animal[f].state === "contains");
    if (sure.length) return { id, label, state: "no", because: uniq(sure.flatMap((f) => animal[f].sources)) };
    const maybe = flags.filter((f) => animal[f].state === "may_contain");
    if (maybe.length) return { id, label, state: "maybe", because: uniq(maybe.flatMap((f) => animal[f].sources)) };
    // reviewed and no animal flag: still only "maybe" while a drink that may be fined sits in the recipe
    if (reviewed && finingRisk.length) return { id, label, state: "maybe", because: finingRisk };
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

export interface RollupSummary {
  /** the main allergens (required, then chef extras) that are confirmed */
  contains: AllergenId[];
  /** the main allergens a keyword suggests on an unreviewed ingredient */
  may: AllergenId[];
  /** attributes (alcohol): confirmed, then suggested. Not allergens */
  attributes: AllergenId[];
  attributesMay: AllergenId[];
}

/**
 * Short lists for a summary line. `contains` / `may` hold only the main allergens (sulphites and nitrites included);
 * alcohol comes back in its own fields so no count or list of "allergens" ever includes it.
 */
export function summarise(r: Rollup): RollupSummary {
  const pick = (ids: AllergenId[], state: CellState) => ids.filter((a) => r.cells[a].state === state);
  return {
    contains: pick(CONTAINS_IDS, "contains"),
    may: pick(CONTAINS_IDS, "may_contain"),
    attributes: pick(ATTRIBUTE_IDS, "contains"),
    attributesMay: pick(ATTRIBUTE_IDS, "may_contain"),
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
  /** the menu item itself (its dietary options and seafood flag), when the row is one: null for a gelato flavour mix */
  item: MenuItem | null;
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
      if (!rows.has(key)) rows.set(key, { key, name: flavourName(prep), venueId: it.venue_id, category: it.category, section: null, href: `/preps/${prep.id}`, rollup: rollup({ kind: "prep", id: prep.id }, index), item: null, mixOnly: true });
    } else if (isBeerItemId(it.id)) {
      const p = parseBeerItemId(it.id);
      if (!p) continue;
      const key = `beer:${p.beerId}`;
      if (!rows.has(key)) rows.set(key, { key, name: it.name.replace(/\s+-\s+[^-]*$/, ""), venueId: it.venue_id, category: it.category, section: it.section, href: `/beers/${p.beerId}`, rollup: rollup({ kind: "item", id: it.id }, index), item: it, mixOnly: false });
    } else {
      rows.set(`item:${it.id}`, { key: `item:${it.id}`, name: it.name, venueId: it.venue_id, category: it.category, section: it.section, href: `/items/${it.id}`, rollup: rollup({ kind: "item", id: it.id }, index), item: it, mixOnly: false });
    }
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
