/**
 * Ingredient categories (Troy, 9 Oct 2026): a short pick-list, never free text. The values are the ones already in the
 * live database, unchanged (no renames, no reshuffle). A stored value that is not in the list still works: it is shown as
 * it is with "Not In The List" and the person can pick a proper one. Nothing here rewrites data.
 *
 * Do not confuse with MENU_CATEGORIES (lib/types.ts), which are the categories of things SOLD.
 * Five names are bound to code and must not change: Beer Keg (lib/keg.ts) and Wine, Spirits, Liqueurs,
 * Packaged Beer / Cider / RTD (FINING_CATEGORIES in lib/allergens.ts).
 */

export const INGREDIENT_CATEGORY_GROUPS = ["Kitchen", "Bar", "Gelato", "Other"] as const;
export type IngredientCategoryGroup = (typeof INGREDIENT_CATEGORY_GROUPS)[number];

export const BEER_KEG_CATEGORY = "Beer Keg";

export const INGREDIENT_CATEGORIES = [
  { name: "Food", group: "Kitchen" },
  { name: "Dairy", group: "Kitchen" },
  { name: "Spirits", group: "Bar" },
  { name: "Liqueurs", group: "Bar" },
  { name: "Wine", group: "Bar" },
  { name: BEER_KEG_CATEGORY, group: "Bar" },
  { name: "Packaged Beer / Cider / RTD", group: "Bar" },
  { name: "Bar consumable", group: "Bar" },
  { name: "Beverage (non-alc)", group: "Bar" },
  { name: "Gelato Supplies", group: "Gelato" },
  { name: "Packaging", group: "Other" },
] as const satisfies readonly { name: string; group: IngredientCategoryGroup }[];

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number]["name"];

const LISTED = new Set<string>(INGREDIENT_CATEGORIES.map((c) => c.name));

/** True when a stored value is exactly one of the pick-list names. */
export function isListedCategory(value: string | null | undefined): value is IngredientCategory {
  return value != null && LISTED.has(value);
}

/** The pick-list split into its display groups, in order. */
export function categoriesByGroup(): { group: IngredientCategoryGroup; names: IngredientCategory[] }[] {
  return INGREDIENT_CATEGORY_GROUPS.map((group) => ({ group, names: INGREDIENT_CATEGORIES.filter((c) => c.group === group).map((c) => c.name) }));
}

/** A name that says keg on its own ("Stone & Wood Keg"). Also exported by lib/keg.ts. */
export function looksLikeKeg(name: string): boolean {
  return /\bkeg\b/i.test(name);
}

/**
 * Words that mean the product is a food, mix or flavouring that merely contains an alcohol word
 * ("Red Wine Vinegar", "Rum Raisin Gelato Mix", "Scotch Fillet", "Bourbon Vanilla Paste"). Any of these stops the alcohol rules,
 * so the answer is "no suggestion" rather than a wrong one. They never stop the keg rule.
 */
const NOT_A_DRINK = /\b(gelato|gelati|mix|ice\s*cream|sorbet|flavou?rs?|flavou?ring|vinegar|sauce|glaze|fillet|steak|essence|extract|vanilla|paste|gummy|gummies|jelly|cake)\b/i;

const RULES: { category: IngredientCategory; re: RegExp }[] = [
  // liqueurs before spirits so "Coconut Rum Liqueur" is a liqueur
  { category: "Liqueurs", re: /\b(liqueurs?|aperol|campari|bailey'?s|cointreau|amaretto|triple\s+sec|vermouth|kahl[uú]a|schnapps)\b/i },
  { category: "Spirits", re: /\b(vodka|gin|rum|whisky|whiskey|tequila|bourbon|brandy|mezcal|scotch|cognac)\b/i },
  { category: "Wine", re: /\b(prosecco|champagne|wine|shiraz|chardonnay|pinot|sauvignon|merlot|moscato)\b/i },
  { category: "Packaged Beer / Cider / RTD", re: /\b(cider|seltzer|rtd|stubby)\b/i },
];

/**
 * A best guess at the category from the name alone, or null. SAFE rules only, first match wins, whole word and
 * case-insensitive. It never guesses Food or Dairy (a null means "the person chooses"). It only ever proposes: callers
 * pre-select it once and stop as soon as the person taps a category themselves.
 */
export function suggestCategory({ name }: { name: string }): IngredientCategory | null {
  const n = name.trim();
  if (!n) return null;
  if (looksLikeKeg(n)) return BEER_KEG_CATEGORY;
  if (NOT_A_DRINK.test(n)) return null;
  for (const r of RULES) if (r.re.test(n)) return r.category;
  return null;
}
