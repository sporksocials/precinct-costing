import { allergenLabel, ALLERGEN_NOTICE, rollup, type AllergenIndex } from "./allergens";
import { badgeModel, FULL_ALLERGENS, isDrinkItem, type BadgeModel, type BadgePolicy } from "./allergen-badges";
import { barIngredientName, barPhotoSrc, isBarCategory, textList } from "./bar";
import { parentKey } from "./costing";
import { BADGE_LABELS, seafoodDef } from "./diet-legend";
import { optionText, readOption, swapSentence, swapWords } from "./diet-options";
import { kitchenPhotoSrc, yieldText } from "./kitchen";
import { formatQty } from "./parse-qty";
import type { MenuItem, Prep, RecipeLine, Venue } from "./types";

/**
 * Print a recipe for the kitchen wall: the PURE half (the printable model, the allergen lines, Title Case and the font-size
 * fit). The screens live in components/print/. Nothing here reads or writes money: the model carries ingredient amounts,
 * method, garnish, glass, allergens, a photo path and a date, and a test walks it to prove no price, cost, GP, target or
 * supplier field can appear.
 */

/* ------------------------------------------------------------------ rules */

/** One print job holds at most this many recipes (one A4 page each). */
export const MAX_PRINT = 60;

/**
 * Which allergens a printed recipe lists. A recipe on the wall is read by the cook who makes it, so it lists the main allergens
 * (the same roll-up and badge rules the Kitchen Station uses, lib/allergen-badges.ts: drinks mark only DRINK_ALLERGEN_IDS, egg, milk and nuts) and
 * says so plainly when an ingredient has not been checked. This is its own switch: the Kitchen Station and the costing app
 * stay on the menu-only default (DEFAULT_POLICY). Change this one line to follow them instead.
 */
export const PRINT_POLICY: BadgePolicy = FULL_ALLERGENS;

/** Recipe content starts this big and steps down until the page fits, never below the floor. 15pt is about 20px, 14pt about 18.7px. */
export const FONT_START_PT = 15;
export const FONT_MIN_PT = 14;
export const FONT_STEP_PT = 0.25;

/** The plain line printed when any ingredient has not been checked for allergens. */
export const NOT_CHECKED_LINE = "Some ingredients have not been checked for allergens.";

/** The on-screen warning (never printed) on a recipe that does not fit one page at the floor size. */
export const TOO_LONG_WARNING = "This recipe is too long to print on one page at a readable size. Shorten the method or ingredients.";

/* ------------------------------------------------------------------ model */

export type PrintKind = "item" | "prep";

export interface PrintAmount {
  /** "180", "2", "1.5"; empty for a zero amount */
  value: string;
  /** "g", "ml", "kg", "L", "ea" */
  unit: string;
}

export interface PrintLine {
  amount: PrintAmount;
  name: string;
  /** the line's own note ("toasted", "3 dashes"), printed small after the name */
  note: string | null;
}

export interface PrintOption {
  letter: string;
  /** the option's printed name: "Gluten Free Option Available", "Dairy Free Option" */
  label: string;
  /** the dish's own note on what changes */
  note: string;
  /** the ingredient swap in plain words ("Leave out Soy Sauce. Add Tamari 15 ml."), or null when the option only has a note. Never a cost, price or surcharge. */
  swap: string | null;
  /** the line as printed after the name: the swap, then the note */
  text: string;
}

/** A hand-set mark (GF, V, VG) as printed. */
export interface PrintMark {
  letter: string;
  label: string;
}

export interface PrintAllergens {
  /** "Contains: Egg, Milk", or "Contains: None listed" / "Contains: Nothing found so far" */
  contains: string;
  /** "May contain (unconfirmed): Gluten", or null */
  mayContain: string | null;
  /** the chef's "made without" notes on the allergens that are listed */
  notes: string[];
  /** the hand-set marks that print (GF, V, VG; VG alone when both V and VG are set) */
  marks: PrintMark[];
  /** the seafood origin letter or its "not confirmed" line, only on a dish the menu markets as seafood */
  seafood: string | null;
  /** NOT_CHECKED_LINE when any ingredient is unreviewed (or the recipe is empty), else null */
  notChecked: string | null;
  notice: string;
}

export interface PrintRecipe {
  id: string;
  kind: PrintKind;
  /** null slug = a shared prep (no venue logo) */
  venue: { slug: string | null; name: string };
  title: string;
  /** section, category or "Sauces Prep" */
  subtitle: string;
  /** "Makes 2 kg" or "Quantities make 4 portions"; null when there is nothing to say */
  detail: string | null;
  lines: PrintLine[];
  /** the method steps; empty = the Method section is left out */
  method: string[];
  plating: string[];
  /**
   * the dish's dietary options (GFO, VO, VGO, DFO) in that order, each with what changes: the "Options" block between the
   * method and the Allergens block. Empty for a prep, a drink, or a dish with no options (then there is no block).
   */
  options: PrintOption[];
  glass: string | null;
  garnish: string[];
  storage: string | null;
  allergens: PrintAllergens;
  /** same-origin photo path, or null */
  photo: string | null;
  /** "7 Oct 2026" in Brisbane time, or null when the record has no updated_at */
  updated: string | null;
  /** "<Venue>  |  Updated <d Mmm yyyy>" */
  footer: string;
}

/* ------------------------------------------------------------------ text helpers */

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "with"]);

function capFirstLetter(w: string): string {
  return w.replace(/^([^A-Za-z0-9]*)([a-z])/, (_m, lead: string, c: string) => lead + c.toUpperCase());
}

/**
 * A recipe name in Title Case: "chicken burger" becomes "Chicken Burger", "slow-cooked lamb" "Slow-Cooked Lamb", small words
 * ("and", "of", "with") stay lower case inside the name. A word that already has its own capitals ("BBQ", "GF", "McCoy") is
 * left alone, and an all-capitals name ("CHICKEN BURGER") is lowered first so it reads as words, not a shout.
 */
export function toTitleCase(name: string): string {
  let s = name.trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (s.length > 3 && !/[a-z]/.test(s)) s = s.toLowerCase();
  const words = s.split(" ");
  return words
    .map((w, i) => {
      if (/\d/.test(w) && !/[a-z]{3,}/i.test(w)) return w;
      // already carries its own capitals beyond the first letter: leave it
      if (/[A-Z]/.test(w.slice(1))) return w;
      const small = i > 0 && i < words.length - 1 && SMALL_WORDS.has(w.toLowerCase());
      if (small) return w.toLowerCase();
      return w
        .split("-")
        .map((part) => capFirstLetter(part))
        .join("-");
    })
    .join(" ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Oct 2026" for an ISO timestamp, in Brisbane time (the venues' clock). Null for a missing or unreadable date. */
export function formatUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const month = MONTHS[get("month") - 1];
  if (!month) return null;
  return `${get("day")} ${month} ${get("year")}`;
}

/** An amount the way the recipe page writes it (lib/parse-qty.ts formatQty: "180 g", "2 ea"), split for the right-aligned column. */
export function printAmount(qty: number, unit: RecipeLine["unit"]): PrintAmount {
  if (!(Number(qty) > 0)) return { value: "", unit: "" };
  const text = formatQty(Number(qty), unit);
  const cut = text.lastIndexOf(" ");
  return cut < 0 ? { value: text, unit: "" } : { value: text.slice(0, cut), unit: text.slice(cut + 1) };
}

function sentence(s: string): string {
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function seafoodLine(m: BadgeModel): string | null {
  const s = m.seafood;
  // the origin letter only counts on a dish the menu markets as seafood (the Kitchen Station's rule)
  if (!s || !s.required) return null;
  if ("letter" in s) return `${BADGE_LABELS.seafoodOrigin}: ${s.letter}, ${seafoodDef(s.letter).label}`;
  return `${BADGE_LABELS.originNotConfirmed}: ${s.missing.map(barIngredientName).join(", ")}`;
}

/**
 * The allergen lines for one recipe, from the shared badge model so the print, the Kitchen Station and the costing app agree.
 * An unreviewed ingredient never reads as "free from": the Contains line then says "Nothing found so far", never "None listed",
 * and the plain not-checked line is added.
 */
export function printAllergens(m: BadgeModel): PrintAllergens {
  const labels = (ids: readonly string[]) => ids.map(allergenLabel).join(", ");
  const none = m.notReviewed ? BADGE_LABELS.nothingFoundSoFar : BADGE_LABELS.noneListed;
  return {
    contains: `${BADGE_LABELS.contains}: ${m.contains.length ? labels(m.contains) : sentence(none)}`,
    mayContain: m.mayContain.length ? `May contain (unconfirmed): ${labels(m.mayContain)}` : null,
    notes: m.notes.map((n) => `${n.label}: ${n.note}`),
    marks: m.marks.map((k) => ({ letter: k.letter, label: k.label })),
    seafood: seafoodLine(m),
    notChecked: m.notReviewed ? NOT_CHECKED_LINE : null,
    notice: ALLERGEN_NOTICE,
  };
}

/** Title size in em of the recipe's base font: a short name is huge, a long one steps down so it does not eat the page. */
export function titleScale(title: string): number {
  const n = title.length;
  return n <= 16 ? 3 : n <= 28 ? 2.5 : n <= 44 ? 2.2 : 1.9;
}

/* ------------------------------------------------------------------ build */

export interface PrintSource {
  /** the costing index with `items` set (the same shape the allergen screens use) */
  index: AllergenIndex;
  venueById: Map<number, Venue>;
}

const SHARED_VENUE = { slug: null, name: "Caloundra Food Precinct" } as const;

function recipeLines(kind: PrintKind, id: string, index: AllergenIndex): PrintLine[] {
  const out: PrintLine[] = [];
  for (const l of index.linesByParent.get(parentKey(kind, id)) ?? []) {
    if (!l.component_id) continue; // a blank line still being built
    const name = l.component_type === "prep" ? index.preps.get(l.component_id)?.name ?? "Unknown prep" : barIngredientName(index.ingredients.get(l.component_id)?.name ?? "Unknown ingredient");
    out.push({ amount: printAmount(l.qty, l.unit), name, note: l.note?.trim() || null });
  }
  return out;
}

/**
 * The Options block of a dish: one entry per option in the order GFO, VO, VGO, DFO, each with the option's name and, in plain
 * words, what it leaves out and adds (the same formatter as the ingredients), then the option's own note. An option with only a
 * note reads "<name>: <note>". Amounts only: never a cost, price, surcharge or GP.
 */
export function printOptions(m: BadgeModel, item: MenuItem | undefined, index: AllergenIndex): PrintOption[] {
  if (!item) return [];
  const own = new Map((index.linesByParent.get(parentKey("item", item.id)) ?? []).map((l) => [l.id, l]));
  const nameOf = (type: "ingredient" | "prep", cid: string): string | null =>
    type === "prep" ? index.preps.get(cid)?.name ?? null : index.ingredients.get(cid)?.name ? barIngredientName(index.ingredients.get(cid)!.name) : null;
  return m.options.map((o) => {
    const read = readOption(item.diet_options, o.id);
    const swap = read
      ? swapSentence(
          swapWords(read, {
            lineName: (id) => {
              const l = own.get(id);
              return l ? nameOf(l.component_type, l.component_id) : null;
            },
            addedName: (a) => nameOf(a.component_type, a.component_id),
          }),
        )
      : null;
    return { letter: o.letter, label: o.label, note: o.note, swap, text: optionText(o.note, swap) };
  });
}

/** The printable model for one dish, drink or prep, or null when the record is not in the index. Reads only; never writes. */
export function buildPrintRecipe(kind: PrintKind, id: string, src: PrintSource, policy: BadgePolicy = PRINT_POLICY): PrintRecipe | null {
  const { index } = src;
  const lines = recipeLines(kind, id, index);

  if (kind === "prep") {
    const prep: Prep | undefined = index.preps.get(id);
    if (!prep) return null;
    const venue = prep.venue_id != null ? src.venueById.get(prep.venue_id) : undefined;
    const v = venue ? { slug: venue.slug, name: venue.name } : SHARED_VENUE;
    const updated = formatUpdated(prep.updated_at);
    const yieldLine = prep.yield_qty > 0 ? yieldText(Number(prep.yield_qty), prep.yield_unit) : "";
    return {
      id,
      kind,
      venue: v,
      title: toTitleCase(prep.name),
      subtitle: prep.prep_type?.trim() ? `${toTitleCase(prep.prep_type)} Prep` : "Prep",
      detail: yieldLine || null,
      lines,
      method: textList(prep.kitchen_method),
      plating: [],
      options: [],
      glass: null,
      garnish: [],
      storage: prep.kitchen_storage?.trim() || null,
      allergens: printAllergens(badgeModel(rollup({ kind: "prep", id }, index), null, policy)),
      photo: null,
      updated,
      footer: footerOf(v.name, updated),
    };
  }

  const item: MenuItem | undefined = index.items?.get(id);
  if (!item) return null;
  const venue = src.venueById.get(item.venue_id);
  const v = venue ? { slug: venue.slug, name: venue.name } : SHARED_VENUE;
  const drink = isDrinkItem(item);
  const updated = formatUpdated(item.updated_at);
  const portions = Number(item.portions);
  const itemBadges = badgeModel(rollup({ kind: "item", id }, index), item, policy);
  return {
    id,
    kind,
    venue: v,
    title: toTitleCase(item.name),
    subtitle: toTitleCase(drink ? item.category : item.section?.trim() || item.category),
    detail: portions > 1 ? `Quantities make ${portions} portions` : null,
    lines,
    method: textList(drink ? item.method : item.kitchen_method),
    plating: drink ? [] : textList(item.kitchen_plating),
    glass: drink ? item.glass?.trim() || null : null,
    garnish: drink ? textList(item.garnish) : [],
    storage: null,
    options: drink ? [] : printOptions(itemBadges, item, index),
    allergens: printAllergens(itemBadges),
    photo: photoOf(item, drink),
    updated,
    footer: footerOf(v.name, updated),
  };
}

function footerOf(venueName: string, updated: string | null): string {
  return updated ? `${venueName}  |  Updated ${updated}` : venueName;
}

/** Dishes: the plated photo. Drinks: the bar photo, and for a cocktail, mocktail or cold drink the file named after it that the Drinks Station also shows (hidden if it is not there). */
function photoOf(item: MenuItem, drink: boolean): string | null {
  if (!drink) return kitchenPhotoSrc(item.kitchen_photo);
  if (item.bar_photo) return barPhotoSrc(item.name, item.bar_photo);
  return isBarCategory(item.category) ? barPhotoSrc(item.name, null) : null;
}

/** Venue logos drawn cream for the dark app are turned dark for white paper. Chiobu and Gelato Rumba read as they are. */
export const INVERT_LOGO_ON_PAPER: ReadonlySet<string> = new Set(["drift", "greedy"]);

/* ------------------------------------------------------------------ fit */

export interface FitResult {
  /** the chosen base font size in pt */
  size: number;
  /** false = it still did not fit at the floor; the caller must warn and let the page flow */
  fits: boolean;
}

export interface FitOptions {
  start?: number;
  min?: number;
  step?: number;
}

/**
 * Finds the largest base font size at which the content fits its page. `fits(size)` applies that size and answers whether the
 * content now fits the printable height (the caller measures the real layout). Tries `start`, steps down by `step`, and stops
 * at `min`: below the floor it never goes. When even the floor does not fit it returns `{ size: min, fits: false }` with the
 * floor size applied last, so the page keeps readable text and the caller shows the warning instead of cutting words.
 */
export function fitFontSize(fits: (size: number) => boolean, opts: FitOptions = {}): FitResult {
  const min = opts.min ?? FONT_MIN_PT;
  const start = Math.max(opts.start ?? FONT_START_PT, min);
  const step = opts.step && opts.step > 0 ? opts.step : FONT_STEP_PT;
  const n = Math.round((start - min) / step);
  for (let i = 0; i <= n; i++) {
    // the last try is exactly the floor, whatever the step
    const size = i === n ? min : Math.round((start - i * step) * 1000) / 1000;
    if (fits(size)) return { size, fits: true };
  }
  return { size: min, fits: false };
}
