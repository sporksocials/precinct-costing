/**
 * The one place the dietary letters, seafood origin letters and badge wording live. The costing app, the kitchen iPad
 * and any printed menu legend read from here, so the words cannot drift apart.
 *
 * WORDING RULE (Troy's decisions). The APP never works out or decides a "Gluten Free", "Vegetarian" or "Vegan" claim for
 * a dish: the derived badge is only ever "No Gluten Ingredients" (from fully reviewed ingredients), and the chef's swap
 * is "Gluten Free Option Available" (cross-contact possible). There is NO stand-alone dairy free statement for a dish at
 * all (10 Oct 2026: "we never mark anything as dairy free standard"): dairy appears only as the Dairy Free OPTION (DFO).
 *
 * The exception is the three MARKS GF, V and VG (10 Oct 2026, Troy's explicit decision). They are a person's own
 * declaration, ticked by a chef or manager on the dish, and the app never ticks them itself. "GF" is a legal claim in
 * Australia (no detectable gluten), so whoever ticks it takes responsibility for it.
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
 * Vegetarian Option, VGO Vegan Option, DFO Dairy Free Option (10 Oct 2026: it was "DF Dairy Free"; the option is never a
 * standard claim). The stored key for the dairy option stays `dfo`.
 */
export const DIET_OPTIONS: DietOptionDef[] = [
  option("gfo", "GFO", "Gluten Free Option Available", "Gluten Free Option Available", ""),
  option("vo", "VO", "Vegetarian Option", "Vegetarian Option", ""),
  option("vgo", "VGO", "Vegan Option", "Vegan Option", ""),
  option("dfo", "DFO", "Dairy Free Option", "Dairy Free Option", ""),
];

/**
 * The hand-set MARKS (GF, V, VG). Stored in `cost_menu_items.diet_options` beside the options, under the keys gf, v and vg,
 * with no note needed. A dish marked GF cannot also offer GFO (V and VO, VG and VGO likewise: `excludes`).
 */
export const DIET_MARK_IDS = ["gf", "v", "vg"] as const;
export type DietMarkId = (typeof DIET_MARK_IDS)[number];

export interface DietMarkDef {
  id: DietMarkId;
  /** the printed letters */
  letter: string;
  /** the plain name and the printed wording */
  name: string;
  label: string;
  /** one line for the legend */
  definition: string;
  /** the option this mark cannot be combined with */
  excludes: DietOptionId;
}

function mark(id: DietMarkId, letter: string, name: string, excludes: DietOptionId): DietMarkDef {
  return { id, letter, name, label: name, definition: name, excludes };
}

/** Legend wording: GF Gluten Free, V Vegetarian, VG Vegan. */
export const DIET_MARKS: DietMarkDef[] = [mark("gf", "GF", "Gluten Free", "gfo"), mark("v", "V", "Vegetarian", "vo"), mark("vg", "VG", "Vegan", "vgo")];

const MARK_BY_ID = new Map(DIET_MARKS.map((m) => [m.id, m]));
export function dietMarkDef(id: DietMarkId): DietMarkDef {
  return MARK_BY_ID.get(id) as DietMarkDef;
}
export function isDietMarkId(id: string): id is DietMarkId {
  return MARK_BY_ID.has(id as DietMarkId);
}
/** The mark an option cannot be combined with (gfo with gf, vo with v, vgo with vg), or null (the dairy option has no mark). */
export function markExcludedBy(option: DietOptionId): DietMarkId | null {
  return DIET_MARKS.find((m) => m.excludes === option)?.id ?? null;
}

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
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  containsAlcohol: "Contains Alcohol",
  contains: "Contains",
  mayContain: "May Contain (Unconfirmed)",
  seafoodOrigin: "Seafood Origin",
  originNotConfirmed: "Origin Not Confirmed",
  dietary: "Dietary",
  options: "Options",
  /** the hand-set marks tier (GF, V, VG) */
  marks: "Dietary Marks",
  whatChanges: "What Changes",
  /** the Contains tier of a fully reviewed recipe that contains none of the main allergens */
  noneListed: "None Listed",
  /** the Contains tier of a recipe with unreviewed ingredients and nothing found yet */
  nothingFoundSoFar: "Nothing Found So Far",
  /** a tile with nothing to flag at all (fully reviewed, no allergens, no attributes) */
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

/** Hand-set mark lines for the legend (GF, V, VG). */
export function markLegendLines(): LegendLine[] {
  return DIET_MARKS.map((m) => ({ key: m.id, letter: m.letter, text: m.definition }));
}

/** Dietary option lines for the legend (GFO, VO, VGO, DFO). */
export function dietLegendLines(): LegendLine[] {
  return DIET_OPTIONS.map((o) => ({ key: o.id, letter: o.letter, text: o.definition }));
}

/** Seafood origin lines for the legend (A, I, M). */
export function seafoodLegendLines(): LegendLine[] {
  return SEAFOOD_LETTERS.map((s) => ({ key: s.letter, letter: s.letter, text: s.definition }));
}
