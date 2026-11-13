import { barIngredientName } from "./bar";
import { parentKey } from "./costing";
import { isActive } from "./active";
import { kitchenPhotoSrc } from "./kitchen";
import { formatUpdated, toTitleCase } from "./print-recipe";
import { STATION_VENUE_SHORT } from "./station-names";
import type { Ingredient, MenuItem, Prep, RecipeLine, Venue } from "./types";

/**
 * Kitchen Cheat Sheet: the executive chef's pass sheet, one per venue, A4 landscape, five dishes a page. The PURE half
 * (this file): which dishes, in what order, each dish's recipe lines sorted under BUILD / WITH / SAUCE / TOP WITH / GARNISH by a
 * guess from the ingredient's NAME, amounts the way a chef reads them, the Sauce Key, and the font-scale fit. The screens live
 * in components/print/cheat-sheet-*.tsx. Ported from the two reference builds (Drift draft 1 and Chiobu draft 4) that were
 * written outside the app.
 *
 * Nothing here reads or writes money: the model carries dish names, sections, photo paths, ingredient names and per-serve
 * amounts, and a test walks it to prove no price, cost, GP, target or supplier field can appear.
 *
 * Roles are a GUESS (no schema): a line the guess cannot place goes under BUILD. The old red "check this amount" flags of the
 * reference builds are deliberately gone (Troy, 14 Nov 2026): the sheet shows exactly what the recipes hold.
 */

/* ------------------------------------------------------------------ constants */

export const DISHES_PER_PAGE = 5;

/** Each page starts its text at this scale and steps down until nothing overflows, never below the floor. */
export const SCALE_START = 1.25;
export const SCALE_STEP = 0.02;
export const SCALE_MIN = 0.55;

export const HEADER_DISHES = "Check every plate against this before it goes out";
export const HEADER_KEY = "Which sauce goes on which dish, and how much";
export const KEY_TITLE = "Sauce Key: which sauce goes on which dish";
export const KEY_EMPTY = "None of these dishes has a sauce line yet.";
export const NO_PHOTO = "Photo needed";
export const SHEET_TITLE = "Kitchen Cheat Sheet";

export const HOW_TO_READ =
  "The photo is the target plate. Coloured bars: BUILD the main item, WITH what it sits on or comes with, SAUCE, TOP WITH, then GARNISH to finish. Amounts are per serve, from the costed recipes. Vessel is for the chef to fill in. A grey dashed tile means there is no photo of that dish yet.";

export type RoleId = "main" | "with" | "sauce" | "top" | "garn";

export interface RoleDef {
  id: RoleId;
  /** the word on the bar: every colour carries its word, so a black and white print still reads */
  label: string;
  bg: string;
  fg: string;
}

export const INK = "#17171a";
export const ROLES: readonly RoleDef[] = [
  { id: "main", label: "BUILD", bg: "#0A3848", fg: "#ffffff" },
  { id: "with", label: "WITH", bg: "#3b6c8c", fg: "#ffffff" },
  { id: "sauce", label: "SAUCE", bg: "#8F5F56", fg: "#ffffff" },
  { id: "top", label: "TOP WITH", bg: "#f0b13a", fg: INK },
  { id: "garn", label: "GARNISH", bg: "#2f8a4b", fg: "#ffffff" },
];
export const roleDef = (id: RoleId): RoleDef => ROLES.find((r) => r.id === id) ?? ROLES[0];

/**
 * Menu sections in the order the pass reads them. Unknown sections follow A to Z, "Other" (no section) is last. Small Chow, Big
 * Chow (Chiobu) and Little Drifters (Drift) are placed where those menus read them.
 */
export const SECTION_ORDER: readonly string[] = [
  "Breakfast",
  "Small Plates",
  "Small Chow",
  "Share Plates",
  "Kids",
  "Little Drifters",
  "Mains",
  "Big Chow",
  "Daily Specials",
  "Salads",
  "Bowls & Salads",
  "Grill",
  "Burgers",
  "Tacos",
  "Pizzas",
  "Sides",
  "Sweets",
];
export const OTHER_SECTION = "Other";

/* ------------------------------------------------------------------ names */

/** Words that stay in capitals ("bvc" reads BVC). */
const ACRONYMS = ["BVC", "GK", "GF", "BBQ", "VG"];
const ACRONYM_RX = new RegExp(`\\b(?:${ACRONYMS.join("|")})\\b`, "gi");

/**
 * Supplier-style names the kitchen calls something shorter. Keys are lower case: the whole name as the app holds it, or the name without its pack size. Only exact
 * names are mapped; everything else keeps its own words in Title Case.
 */
const KITCHEN_NAMES: Record<string, string> = {
  "bacon middle rindless gas flushed": "Bacon",
  "chips 10mm supa crunch ultrafast": "Chips",
  "chicken skewers 80g skewers": "Chicken Skewers",
  "21/25 prawn cutlet": "Prawn Cutlets",
  "prawn 21/25": "Prawns",
  "pizza base 7 inch": "Pizza Base (7 inch)",
  "pomegranate mollases": "Pomegranate Molasses",
  "chicken nuggets dino": "Dino Nuggets",
  "fish cocktail": "Fish Cocktails",
  "vegan bun": "Bun",
  bao: "Bao Buns",
  "roti paratha": "Roti",
  "young coconut can": "Young Coconut",
  "chicken breast schnitzels p\\c 250 grams": "Chicken Schnitzel",
  "pak choi green stem": "Pak Choi",
  "masterstock duck maryland": "Masterstock Duck",
  "bean snake": "Snake Beans",
  "shallots (kg)": "Spring Onion",
  "3 cup base": "3 Cup Sauce",
};

/** A pack or size marker the app keeps on the end of an ingredient name: "(5kg)", "(4.5L)", "(Each)", "(kg)", "(L)". */
const PACK_TAIL = /\s*\((?:each|ea|kg|g|ml|l|\d+(?:\.\d+)?\s*(?:kg|g|ml|l|mm|inch))\)\s*$/i;

/** An ingredient name without its trailing pack size, spaces tidied. */
export function stripPack(name: string): string {
  return barIngredientName(name).replace(PACK_TAIL, "").replace(/\s+/g, " ").trim();
}

/** The name as the pass reads it: pack size gone, kitchen wording where one is known, otherwise Title Case with acronyms kept. */
export function cleanName(raw: string): string {
  const base = stripPack(raw);
  if (!base) return raw.trim();
  // the whole name first (a few mappings belong to one pack, "Shallots (kg)"), then the name without its pack size
  const hit = KITCHEN_NAMES[raw.trim().toLowerCase()] ?? KITCHEN_NAMES[base.toLowerCase()];
  if (hit) return hit;
  return toTitleCase(base).replace(ACRONYM_RX, (m) => m.toUpperCase());
}

/** "Pork and Prawn Dumplings (5)" has 5 pieces: the badge number, or null. */
export function pcsOf(dishName: string): number | null {
  const m = dishName.match(/\((\d+)\)/);
  return m ? Number(m[1]) : null;
}

/** The dish name without its "(5)" piece count. */
export function withoutPcs(dishName: string): string {
  return dishName.replace(/\s*\(\d+\)/g, "").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ amounts */

function trimNum(n: number, places: number): string {
  return String(Number(n.toFixed(places)));
}

/**
 * An amount the way a chef reads it on the pass: kg under 1 shows grams (0.18 kg is "180 g"), L under 1 shows ml, each shows
 * "x2" ("x½" for a half), everything else "<number> <unit>". Blank when there is no amount.
 */
export function cheatAmount(qty: number | null | undefined, unit: string | null | undefined): string {
  const q = Number(qty);
  if (!(q > 0)) return "";
  if (unit === "each") {
    if (q === 0.5) return "x½";
    if (q === 0.25) return "x¼";
    if (q === 0.75) return "x¾";
    return `x${trimNum(q, 3)}`;
  }
  if ((unit === "kg" || unit === "L") && q < 1) {
    const small = q * 1000;
    const v = Math.round(small);
    return `${v === 0 ? trimNum(small, 2) : v} ${unit === "kg" ? "g" : "ml"}`;
  }
  return `${trimNum(q, 3)} ${unit ?? ""}`.trim();
}

/* ------------------------------------------------------------------ roles */

/** A list of words, each matched at the START of a word (so "tomato" finds "Tomatoes" but "ham" does not find "Graham"). Parts are regex source. */
const words = (...parts: string[]) => new RegExp(`(?:^|[^a-z])(?:${parts.join("|")})`, "i");

const BUILD_EXACT = new Set(["shoestring fries"]);

const SAUCE_RX = words(
  "sauce",
  "mayo",
  "aioli",
  "hollandaise",
  "tartare",
  "dressing",
  "miso",
  "balsamic",
  "molasses",
  "mollases",
  "salsa",
  "napoli",
  "pesto",
  "hickory",
  "olive oil",
  "brown butter",
  "compote",
  "maple",
  "nutella",
  "syrup",
  "ketchup",
  "caramel\\b",
  "bvc",
  "chilli oil",
  "curry base",
  "3 cup",
  "nahm\\b",
  "nam jim",
  "black pepper curry leaf",
  "sweet chilli",
  "sour cream",
  "guacamole",
  "guac\\b",
  "pico de gallo",
  "crema\\b",
  "chipotle",
  "sriracha",
  "gravy",
  "jus\\b",
  "vinaigrette",
  "chimichurri",
  "queso",
);
const SAUCE_EXACT = /^(?:thickened )?cream$|^avocado cr[eè]me$/i;
const GARN_RX = words("herb", "parsley", "basil", "coriander", "cilantro", "mint", "lemongrass", "kaffir");
const WITH_RX = words(
  "chips",
  "salad",
  "toast\\b",
  "rosti",
  "flat ?bread",
  "roti",
  "rice",
  "buns?\\b",
  "pizza base",
  "penne",
  "linguine",
  "broccolini",
  "cos\\b",
  "cucumber",
  "slaw",
  "sourdough",
  "wrapper",
  "bao\\b",
  "betel",
  "fries",
  "tortilla",
  "taco shell",
  "tostada",
  "nachos",
);
const PROTEIN_RX = words(
  "beef",
  "patty",
  "patties",
  "chicken",
  "lamb",
  "rump",
  "rib fillet",
  "calamari",
  "prawn",
  "barramundi",
  "roughy",
  "fish",
  "salmon",
  "kingfish",
  "egg",
  "nugget",
  "skewer",
  "empanada",
  "arancini",
  "wings",
  "corn ribs",
  "wedges",
  "squid",
  "chorizo",
  "pancakes",
  "granola",
  "mince",
  "omelette",
  "carnitas",
  "pork",
  "steak",
  "brisket",
  "barbacoa",
);
/** Protein words that, when also present, mean it is a topping rather than the main item. */
const NOT_PROTEIN_RX = words("chicken salt", "egg", "bacon", "ham\\b", "chorizo");
const TOP_RX = words(
  "cheese",
  "mozzarella",
  "parmesan",
  "feta",
  "ricotta",
  "crispy",
  "crispys",
  "pine nuts",
  "chilli",
  "onion",
  "tomato",
  "beetroot",
  "lemon",
  "lime",
  "ginger",
  "wakame",
  "cassava",
  "pepper",
  "chicken salt",
  "pineapple",
  "ham\\b",
  "chorizo",
  "bacon",
  "spinach",
  "croutons",
  "walnut",
  "coconut",
  "garlic",
  "sesame",
  "furikake",
  "shallot",
  "peanut",
  "cashew",
  "roasted rice",
  "pickled",
  "kara\\b",
  "curry leaf",
  "lychee",
  "butter",
  "jam\\b",
  "honey",
  "vegemite",
  "jalape",
  "cabbage",
  "radish",
);

/**
 * Which bar a recipe line sits under, guessed from the ingredient's name (pack size ignored). Order matters: a sauce word wins
 * over a garnish word ("Herb Aioli" is a sauce), a "with" word over a protein word ("Chicken Skewers" is not, but "Rice" is),
 * and a protein over a topping. Anything unplaced is BUILD. Tuned on the Chiobu and Drift builds; the Greedy Gringo's words
 * (tortilla, salsa, guacamole, sour cream, jalapeno, coriander...) are there so a Mexican menu sorts sensibly too.
 */
export function guessRole(rawName: string): RoleId {
  const n = stripPack(rawName).toLowerCase();
  if (BUILD_EXACT.has(n)) return "main";
  if (n === "lime" || n.includes("pickled")) return "top";
  if (n.includes("pizza base")) return "main";
  if (SAUCE_RX.test(n) || SAUCE_EXACT.test(n)) return "sauce";
  if (GARN_RX.test(n) && !n.includes("pizza")) return "garn";
  if (WITH_RX.test(n) && !/cheese/.test(n)) return "with";
  if (PROTEIN_RX.test(n) && !NOT_PROTEIN_RX.test(n)) return "main";
  if (/^egg/.test(n)) return "main";
  if (TOP_RX.test(n)) return "top";
  return "main";
}

/* ------------------------------------------------------------------ model */

export interface CheatLine {
  name: string;
  /** "180 g", "x2", "" when the recipe holds no amount */
  amount: string;
}

export interface CheatGroup {
  role: RoleId;
  lines: CheatLine[];
}

export interface CheatDish {
  id: string;
  /** Title Case, without the "(5)" piece count */
  title: string;
  /** the menu section, or "Other" */
  section: string;
  pcs: number | null;
  /** same-origin photo path (the app's /kitchen/photo rewrite), or null for the "Photo needed" tile */
  photo: string | null;
  /** only the bars that have lines, in BUILD, WITH, SAUCE, TOP WITH, GARNISH order */
  groups: CheatGroup[];
}

export interface SauceUse {
  dish: string;
  amount: string;
}
export interface SauceEntry {
  name: string;
  uses: SauceUse[];
}

export interface CheatDishPage {
  kind: "dishes";
  /** 1 based page number */
  n: number;
  dishes: CheatDish[];
}
export interface CheatKeyPage {
  kind: "key";
  n: number;
  entries: SauceEntry[];
}
export type CheatPage = CheatDishPage | CheatKeyPage;

export interface CheatSheet {
  venue: { slug: string; name: string; short: string };
  /** "13 Nov 2026" in Brisbane time */
  printedOn: string;
  dishCount: number;
  /** every dish page, then the Sauce Key page; empty when the venue has no active Food dishes */
  pages: CheatPage[];
  /** the pages' count, shown as "n of N" */
  total: number;
}

export interface CheatSource {
  items: readonly MenuItem[];
  index: {
    linesByParent: Map<string, RecipeLine[]>;
    ingredients: Map<string, Ingredient>;
    preps: Map<string, Prep>;
  };
  venueById: Map<number, Venue>;
}

/** The venue's short name for titles and the footer: "Drift", "Chiobu", "Greedy". */
export function venueShort(slug: string, name: string): string {
  return STATION_VENUE_SHORT[slug] ?? name;
}

function sectionRank(label: string): number {
  if (label === OTHER_SECTION) return Infinity;
  const i = SECTION_ORDER.findIndex((s) => s.toLowerCase() === label.toLowerCase());
  return i === -1 ? SECTION_ORDER.length : i;
}

/** Sections in menu order, then A to Z; "Other" last. */
export function compareSections(a: string, b: string): number {
  return sectionRank(a) - sectionRank(b) || a.localeCompare(b);
}

function dishLines(itemId: string, src: CheatSource): { role: RoleId; line: CheatLine }[] {
  const out: { role: RoleId; line: CheatLine }[] = [];
  for (const l of src.index.linesByParent.get(parentKey("item", itemId)) ?? []) {
    if (!l.component_id) continue; // a blank line still being built
    const raw = l.component_type === "prep" ? src.index.preps.get(l.component_id)?.name : src.index.ingredients.get(l.component_id)?.name;
    const name = raw?.trim() || "Unknown ingredient";
    out.push({ role: guessRole(name), line: { name: cleanName(name), amount: cheatAmount(l.qty, l.unit) } });
  }
  return out;
}

/** One dish as the sheet draws it. */
export function buildCheatDish(item: MenuItem, src: CheatSource): CheatDish {
  const groups: CheatGroup[] = [];
  const lines = dishLines(item.id, src);
  for (const r of ROLES) {
    const mine = lines.filter((x) => x.role === r.id).map((x) => x.line);
    if (mine.length) groups.push({ role: r.id, lines: mine });
  }
  return {
    id: item.id,
    title: toTitleCase(withoutPcs(item.name)),
    section: item.section?.trim() || OTHER_SECTION,
    pcs: pcsOf(item.name),
    photo: kitchenPhotoSrc(item.kitchen_photo),
    groups,
  };
}

/** The Sauce Key: every sauce line on every dish, alphabetical by sauce, each with the dishes that use it and how much. */
export function buildSauceKey(dishes: readonly CheatDish[]): SauceEntry[] {
  const by = new Map<string, SauceEntry>();
  for (const d of dishes) {
    for (const g of d.groups) {
      if (g.role !== "sauce") continue;
      for (const l of g.lines) {
        const k = l.name.toLowerCase();
        const e = by.get(k) ?? { name: l.name, uses: [] };
        e.uses.push({ dish: d.title, amount: l.amount });
        by.set(k, e);
      }
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The one-line text of a Sauce Key use: "Chicken Wings 44 g". */
export function sauceUseText(u: SauceUse): string {
  return `${u.dish} ${u.amount}`.trim();
}

/** The footer text of every page. */
export function footerLine(short: string, printedOn: string): string {
  return `${short} Kitchen Cheat Sheet  |  Printed ${printedOn}  |  Amounts are per serve, from the costed recipes`;
}

/** "3 of 7". */
export function pageOf(n: number, total: number): string {
  return `${n} of ${total}`;
}

/**
 * The whole sheet for one venue, or null when the venue is not known. Active Food dishes only, by section (menu order) then
 * name, five to a page, then one Sauce Key page. A venue with no such dishes gets `dishCount: 0` and no pages.
 */
export function buildCheatSheet(slug: string, src: CheatSource, now: Date = new Date()): CheatSheet | null {
  const venue = [...src.venueById.values()].find((v) => v.slug === slug);
  if (!venue) return null;
  const items = src.items
    .filter((i) => i.venue_id === venue.id && i.category === "Food" && isActive(i))
    .map((i) => buildCheatDish(i, src))
    .sort((a, b) => compareSections(a.section, b.section) || a.title.localeCompare(b.title));
  const head = { slug: venue.slug, name: venue.name, short: venueShort(venue.slug, venue.name) };
  const printedOn = formatUpdated(now.toISOString()) ?? "";
  if (!items.length) return { venue: head, printedOn, dishCount: 0, pages: [], total: 0 };
  const chunks: CheatDish[][] = [];
  for (let i = 0; i < items.length; i += DISHES_PER_PAGE) chunks.push(items.slice(i, i + DISHES_PER_PAGE));
  const total = chunks.length + 1;
  const pages: CheatPage[] = chunks.map((dishes, i) => ({ kind: "dishes", n: i + 1, dishes }));
  pages.push({ kind: "key", n: total, entries: buildSauceKey(items) });
  return { venue: head, printedOn, dishCount: items.length, pages, total };
}

/* ------------------------------------------------------------------ fit */

export interface ScaleFit {
  scale: number;
  /** false = it still overflowed at the floor; the page keeps the floor and the caller warns */
  fits: boolean;
}

/**
 * Finds the largest text scale at which a page's columns do not overflow. `fits(scale)` applies the scale and answers whether
 * everything now fits (the caller measures the real layout). Starts at SCALE_START, steps down by SCALE_STEP, stops at SCALE_MIN.
 */
export function fitScale(fits: (scale: number) => boolean, opts: { start?: number; step?: number; min?: number } = {}): ScaleFit {
  const { start = SCALE_START, step = SCALE_STEP, min = SCALE_MIN } = opts;
  let s = start;
  for (;;) {
    if (fits(s)) return { scale: s, fits: true };
    const next = Math.round((s - step) * 100) / 100;
    if (next < min) {
      // the floor itself is tried once, then the page keeps it
      return { scale: min, fits: s !== min && fits(min) };
    }
    s = next;
  }
}
