import { MENU_CATEGORIES, type MenuItem } from "./types";

/**
 * "What Are You Adding?": the first step before any new record on the Menu.
 * Tap beers and gelato flavours are made by their own forms (keg and serves, mix), so "Tap Beer" and "Gelato" are not
 * categories a new Menu Item can be given. The stored values stay valid in MENU_CATEGORIES for old records.
 */

/** Categories that have their own form, so a plain new menu item can never be filed under them. */
export const OWN_FORM_CATEGORIES: readonly string[] = ["Tap Beer", "Gelato"];

/** The categories a new Menu Item can be given. */
export const NEW_ITEM_CATEGORIES: readonly string[] = MENU_CATEGORIES.filter((c) => !OWN_FORM_CATEGORIES.includes(c));

export type AddDestination =
  | { kind: "item"; category: string }
  | { kind: "prep" }
  | { kind: "beer" }
  | { kind: "flavour" };

export interface AddChoice {
  id: string;
  label: string;
  destination: AddDestination;
}

/** The tiles, in the order they are shown. Every tap goes straight to its form. */
export const ADD_CHOICES: readonly AddChoice[] = [
  { id: "food", label: "Food", destination: { kind: "item", category: "Food" } },
  { id: "cocktail", label: "Cocktail", destination: { kind: "item", category: "Cocktail" } },
  { id: "mocktail", label: "Mocktail", destination: { kind: "item", category: "Mocktail" } },
  { id: "cold-drink", label: "Cold Drink", destination: { kind: "item", category: "Cold Drink" } },
  { id: "wine", label: "Wine", destination: { kind: "item", category: "Wine" } },
  { id: "spirits", label: "Spirits", destination: { kind: "item", category: "Spirits" } },
  { id: "packaged", label: "Packaged Beer & Cider", destination: { kind: "item", category: "Packaged Beer & Cider" } },
  { id: "rtd", label: "RTD", destination: { kind: "item", category: "RTD" } },
  { id: "tap-beer", label: "Tap Beer", destination: { kind: "beer" } },
  { id: "gelato", label: "Gelato Flavour", destination: { kind: "flavour" } },
  { id: "prep", label: "Prep", destination: { kind: "prep" } },
];

/**
 * Where a category filter on the Menu sends the + button, skipping the chooser: Tap Beer and Gelato go to their own forms,
 * any other category opens the New Menu Item form with that category chosen. No filter ("all") needs the chooser (null).
 */
export function destinationForCategory(cat: string): AddDestination | null {
  if (!cat || cat === "all") return null;
  if (cat === "Tap Beer") return { kind: "beer" };
  if (cat === "Gelato") return { kind: "flavour" };
  return { kind: "item", category: cat };
}

/** The venue a new tap beer starts on: the chosen venue (not Gelato), else Drift, else the first venue. */
export function beerDefaultVenueId(venue: { id: number; slug: string } | null | undefined, venues: { id: number; slug: string }[]): number | undefined {
  return (venue && venue.slug !== "gelato" ? venue.id : undefined) ?? venues.find((v) => v.slug === "drift")?.id ?? venues[0]?.id;
}

const KEYWORDS: [RegExp, string][] = [
  [/\b(nip|30 ?ml|shot)\b/i, "Spirits"],
  [/\b(stubby|can|bottle of beer|cider|seltzer)\b/i, "Packaged Beer & Cider"],
  [/\b(rtd|premix|cruiser|smirnoff)\b/i, "RTD"],
  [/\b(merlot|shiraz|sauv|sauvignon|pinot|chardonnay|ros[eé]|prosecco|riesling|moscato|cabernet|tempranillo|glass|carafe|bubbles|champagne)\b/i, "Wine"],
  [/\b(virgin|mocktail|lemonade|iced tea|soda)\b/i, "Mocktail"],
  [/\b(smoothie|milkshake|shake|frapp[eé]|spider|iced (?:coffee|latte|mocha|chocolate|matcha))(?![a-z])/i, "Cold Drink"],
  [/\b(margarita|spritz|martini|mojito|negroni|sour|daiquiri|colada|mule|paloma|old fashioned|cocktail|punch|highball|bellini|cosmo)\b/i, "Cocktail"],
];

function mostCommon(xs: string[]): string | null {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of m) if (v > n) [best, n] = [k, v];
  return best;
}

/**
 * Best guess at a new menu item's category: a similar existing name at this venue, then drink keywords, then the venue's usual.
 * Never Tap Beer or Gelato (their own forms make those): a venue whose usual category is one of them falls back to its most
 * common allowed category, then Food.
 */
export function guessCategory(name: string, venueItems: Pick<MenuItem, "name" | "category">[]): string {
  const allowed = (cats: string[]) => cats.filter((c) => NEW_ITEM_CATEGORIES.includes(c));
  const fallback = mostCommon(allowed(venueItems.map((i) => i.category))) ?? "Food";
  const n = name.trim().toLowerCase();
  if (n.length < 3) return fallback;
  for (const [re, cat] of KEYWORDS) if (re.test(n)) return cat;
  const words = n.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const similar = venueItems.filter((i) => words.some((w) => i.name.toLowerCase().includes(w)));
  return mostCommon(allowed(similar.map((i) => i.category))) ?? fallback;
}
