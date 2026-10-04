/**
 * The one place the dietary letters, seafood origin letters and badge wording live. The costing app, the kitchen iPad
 * and any printed menu legend read from here, so the words cannot drift apart.
 *
 * WORDING RULE (Troy's decision): the app never prints the claim "Gluten Free" for a dish. A dish is only ever
 * "No Gluten Ingredients" (worked out from fully reviewed ingredients) or "Gluten Free Option, cross-contact possible"
 * (the chef offers a swap, with no guarantee against cross-contact). Same idea for dairy.
 */

export const DIET_OPTION_IDS = ["gfo", "vo", "vgo", "dfo"] as const;
export type DietOptionId = (typeof DIET_OPTION_IDS)[number];

export interface DietOptionDef {
  id: DietOptionId;
  /** the printed menu letters */
  letter: string;
  /** the option's plain name, e.g. "Gluten Free Option" */
  name: string;
  /** the badge wording (carries the cross-contact caution where it applies) */
  label: string;
  /** what the option means, a sentence */
  detail: string;
  /** one line for the legend: name and detail */
  definition: string;
}

function option(id: DietOptionId, letter: string, name: string, label: string, detail: string): DietOptionDef {
  return { id, letter, name, label, detail, definition: detail ? `${name}: ${detail}` : name };
}

/**
 * Wording is the printed menu legend, word for word (Drift menu Sept 26 V3): GFO Gluten Free Option Available, VO
 * Vegetarian Option, VGO Vegan Option, DF Dairy Free. The stored key for the dairy marker stays `dfo`.
 */
export const DIET_OPTIONS: DietOptionDef[] = [
  option("gfo", "GFO", "Gluten Free Option Available", "Gluten Free Option Available", ""),
  option("vo", "VO", "Vegetarian Option", "Vegetarian Option", ""),
  option("vgo", "VGO", "Vegan Option", "Vegan Option", ""),
  option("dfo", "DF", "Dairy Free", "Dairy Free", ""),
];

const OPTION_BY_ID = new Map(DIET_OPTIONS.map((o) => [o.id, o]));
export function dietOptionDef(id: DietOptionId): DietOptionDef {
  return OPTION_BY_ID.get(id) as DietOptionDef;
}
export function isDietOptionId(id: string): id is DietOptionId {
  return OPTION_BY_ID.has(id as DietOptionId);
}

export type SeafoodLetter = "A" | "I" | "M";

export interface SeafoodDef {
  letter: SeafoodLetter;
  label: string;
  definition: string;
}

/** "NZ" is not a permitted letter: New Zealand seafood is imported, so it is I. */
export const SEAFOOD_LETTERS: SeafoodDef[] = [
  { letter: "A", label: "Australian Seafood", definition: "Australian Seafood" },
  { letter: "I", label: "Imported Seafood", definition: "Imported Seafood" },
  { letter: "M", label: "Mixed Origin Seafood", definition: "Mixed Origin Seafood" },
];

const SEAFOOD_BY_LETTER = new Map(SEAFOOD_LETTERS.map((s) => [s.letter, s]));
export function seafoodDef(letter: SeafoodLetter): SeafoodDef {
  return SEAFOOD_BY_LETTER.get(letter) as SeafoodDef;
}

/** Wording of the derived badges and tier headings, shared by every screen. */
export const BADGE_LABELS = {
  notReviewed: "Allergens Not Reviewed",
  notConfirmed: "Not Confirmed",
  noGlutenIngredients: "No Gluten Ingredients",
  noDairyIngredients: "No Dairy Ingredients",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  containsAlcohol: "Contains Alcohol",
  sensitivities: "Sensitivities",
  contains: "Contains",
  mayContain: "May Contain (Unconfirmed)",
  seafoodOrigin: "Seafood Origin",
  originNotConfirmed: "Origin Not Confirmed",
  dietary: "Dietary",
  options: "Options",
  whatChanges: "What Changes",
  /** the Contains tier of a fully reviewed recipe that contains none of the main allergens */
  noneListed: "None Listed",
  /** the Contains tier of a recipe with unreviewed ingredients and nothing found yet */
  nothingFoundSoFar: "Nothing Found So Far",
  /** a tile with nothing to flag at all (fully reviewed, no allergens, sensitivities, attributes) */
  noAllergensListed: "No Allergens Listed",
  /** the small seafood prompt on a kitchen screen: the menu letter is only right while deliveries match it */
  checkDelivery: "Check Delivery",
  checkDeliveryDetail: "Check the delivery matches this letter. Tell the chef if the supplier has changed.",
  originNotConfirmedDetail: "Ask the chef before you plate this dish. Origin is not set on",
  legend: "Legend",
  /** the action line under the Not Reviewed banner on the kitchen screens */
  notReviewedAction: "Check with the chef before you serve it.",
  notReviewedStillApply: "Anything not listed below may still apply.",
  notCheckedYet: "Not yet checked",
  noIngredients: "This recipe has no ingredients yet, so nothing can be confirmed.",
} as const;

/** The legend a printed menu or screen shows under its dish list. */
export const LEGEND_INVITATION = "Please tell us about any allergy or dietary need.";

export interface LegendLine {
  key: string;
  letter: string;
  text: string;
}

/** Dietary option lines for the legend (GFO, VO, VGO, DF). */
export function dietLegendLines(): LegendLine[] {
  return DIET_OPTIONS.map((o) => ({ key: o.id, letter: o.letter, text: o.definition }));
}

/** Seafood origin lines for the legend (A, I, M). */
export function seafoodLegendLines(): LegendLine[] {
  return SEAFOOD_LETTERS.map((s) => ({ key: s.letter, letter: s.letter, text: s.definition }));
}
