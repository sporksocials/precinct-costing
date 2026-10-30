/**
 * Bar display, Pre-Mix Bottles page (/bar/<venue>/premix): data shape and pure display helpers.
 * At Drift and Greedy Gringo's the bar makes drink pre-mixes before service in 700 ml bottles labelled with the drink
 * ("Bulcock Banger Pre-Mix"), and a cocktail card says "2½ shots Bulcock Banger Pre-Mix" (1 shot = 30 ml).
 * Data comes from the public `cost_bar_premix(slug)` function: display fields only, never prices, costs or notes.
 */
import { barIngredientName, qtyText, toMl } from "./bar";

export const SHOT_ML = 30;

export interface PremixLine {
  /** ingredient name as shown on the bar (pack size dropped) */
  name: string;
  qty: number;
  unit: string;
  sort: number;
}

export interface PremixUse {
  /** the cocktail or mocktail that uses this pre-mix */
  drink: string;
  qty: number;
  unit: string;
}

export interface Premix {
  id: string;
  name: string;
  yieldQty: number;
  yieldUnit: string;
  lines: PremixLine[];
  usedIn: PremixUse[];
}

export interface BarPremix {
  venue: { slug: string; name: string };
  premixes: Premix[];
  /** when this copy was read from the database (ISO) */
  syncedAt: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A finite number, or 0 for anything that isn't one ("90", 90 and 90.0 all read as 90). */
function num(v: unknown): number {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rows(v: unknown): Record<string, unknown>[] {
  return (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}

/**
 * Validates the `cost_bar_premix` payload. Null when the venue doesn't exist or the reply isn't the right shape.
 * Malformed rows are dropped rather than failing the page: a pre-mix with no name, an ingredient line with no name,
 * a "used in" row with no drink. Numbers are coerced; lines stay in recipe order (`sort`), pre-mixes and drinks A to Z.
 */
export function parseBarPremix(raw: unknown, syncedAt: string): BarPremix | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { venue?: { slug?: unknown; name?: unknown }; premixes?: unknown };
  if (!r.venue || typeof r.venue.slug !== "string") return null;
  const premixes: Premix[] = rows(r.premixes)
    .map((p, i) => {
      const name = str(p.name);
      if (!name) return null;
      const lines = rows(p.lines)
        .map((l, j) => ({ name: str(l.name), qty: num(l.qty), unit: str(l.unit), sort: l.sort == null ? j : num(l.sort), j }))
        .filter((l) => l.name)
        .sort((a, b) => a.sort - b.sort || a.j - b.j)
        .map(({ name: n, qty, unit, sort }) => ({ name: n, qty, unit, sort }));
      const usedIn = rows(p.used_in)
        .map((u) => ({ drink: str(u.drink), qty: num(u.qty), unit: str(u.unit) }))
        .filter((u) => u.drink)
        .sort((a, b) => a.drink.localeCompare(b.drink, "en-AU"));
      return { id: str(p.id) || `premix-${i}`, name, yieldQty: num(p.yield_qty), yieldUnit: str(p.yield_unit), lines, usedIn };
    })
    .filter((p): p is Premix => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "en-AU"));
  return { venue: { slug: r.venue.slug, name: str(r.venue.name) || r.venue.slug }, premixes, syncedAt };
}

/** The pre-mix's full volume in ml ("0.7 L" gives 700), or null when it isn't a volume. */
export function bottleMl(p: Pick<Premix, "yieldQty" | "yieldUnit">): number | null {
  const ml = toMl(p.yieldQty, p.yieldUnit);
  return ml != null && ml > 0 ? ml : null;
}

/**
 * The bottle sizes a venue uses, whatever the batch inside is. Chiobu's pre-mixes are 700 ml bottles (Troy, 29 Oct 2026), but
 * each holds a WHOLE number of drinks at the recipe's own pour, so the batch inside is a little under 700 ml (Pretty Lady is 7
 * drinks of 90 ml, 630 ml): the card says "700 ml bottle" and "Makes 7 drinks". The recipes never change to fill a bottle. Chiobu's
 * boba mixes go in 1 L bottles (30 Oct 2026). A batch fits the smallest bottle that holds it with a little room in the neck
 * (`BOTTLE_NECK_ALLOWANCE`: the boba mix is 1,080 ml and fits a 1 L bottle, Troy "tried it"); anything bigger is a batch.
 */
export const BOTTLE_SIZES_BY_VENUE: Record<string, number[]> = { chiobu: [700, 1000] };
export const BOTTLE_NECK_ALLOWANCE = 1.1;

/** "700 ml bottle". Anything past a litre is a batch, not a bottle; a non-volume yield reads "Makes 2 kg". */
export function bottleSizeText(p: Pick<Premix, "yieldQty" | "yieldUnit">, venueSlug?: string): string {
  const ml = bottleMl(p);
  if (ml == null) return p.yieldQty > 0 ? `Makes ${qtyText(p.yieldQty, p.yieldUnit).replace(/(\d)([a-z])/i, "$1 $2")}` : "";
  const fixed = (venueSlug ? BOTTLE_SIZES_BY_VENUE[venueSlug] ?? [] : []).find((size) => ml <= size * BOTTLE_NECK_ALLOWANCE);
  if (fixed) return fixed < 1000 ? `${fixed.toLocaleString("en-AU")} ml bottle` : `${(fixed / 1000).toLocaleString("en-AU", { maximumFractionDigits: 2 })} L bottle`;
  const n = Math.round(ml * 10) / 10;
  if (ml <= 1000) return `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} ml bottle`;
  return `${(Math.round(ml) / 1000).toLocaleString("en-AU", { maximumFractionDigits: 2 })} L batch`;
}

/**
 * "2½ shots" for a pour that is a whole number of half shots (15 ml steps), else null. Same wording as the cocktail card
 * ("½ shot", "1 shot", "1½ shots", "2½ shots"...), carried on past the card's own table so a 150 ml line still reads "5 shots".
 */
export function shotsText(qty: number, unit: string): string | null {
  const ml = toMl(qty, unit);
  if (ml == null || ml <= 0) return null;
  const halves = ml / (SHOT_ML / 2);
  const h = Math.round(halves);
  if (h < 1 || Math.abs(halves - h) > 1e-6) return null;
  const whole = Math.floor(h / 2);
  const amount = h % 2 ? `${whole || ""}½` : String(whole);
  return `${amount} ${h <= 2 ? "shot" : "shots"}`;
}

/** The amount as poured, big on the card: "150 ml" (one decimal at most, "116.7 ml"). Other units keep their own style. */
export function premixAmount(qty: number, unit: string): string {
  const ml = toMl(qty, unit);
  if (ml == null) return qtyText(qty, unit);
  return `${(Math.round(ml * 10) / 10).toLocaleString("en-AU", { maximumFractionDigits: 1 })} ml`;
}

/** How many full serves of `qty`/`unit` one bottle holds: a 700 ml bottle at 75 ml a drink makes 9. Null when it can't be worked out. */
export function servesPerBottle(bottle: number | null, qty: number, unit: string): number | null {
  const serve = toMl(qty, unit);
  if (bottle == null || serve == null || serve <= 0) return null;
  return Math.floor(bottle / serve + 1e-9);
}

/**
 * An ingredient line on the bottle card, in whole millilitres, rounded DOWN ("233.3 ml" reads "233 ml"): nobody measures
 * a third of a ml, and a bottle that is a few drops short still fits in the 700 ml. The tiny addition stops float noise
 * (149.9999999) from dropping a clean 150. Other units keep their own style.
 */
export function bottleLineAmount(qty: number, unit: string): string {
  const ml = toMl(qty, unit);
  if (ml == null) return qtyText(qty, unit);
  return `${Math.floor(ml + 1e-6).toLocaleString("en-AU")} ml`;
}

export interface PremixLineDisplay {
  name: string;
  /** "150 ml" */
  amount: string;
  /** "5 shots" when the line is a clean multiple of 15 ml */
  shots: string | null;
}

/** Shots are for the small measures: a bottle line up to 300 ml and one drink's pour up to 100 ml. An 840 ml tea line or a 210 ml boba pour is not "28 shots" or "7 shots". */
export const LINE_SHOTS_MAX_ML = 300;
export const POUR_SHOTS_MAX_ML = 100;

function shotsUpTo(qty: number, unit: string, maxMl: number): string | null {
  const ml = toMl(qty, unit);
  return ml != null && ml > maxMl ? null : shotsText(qty, unit);
}

export function premixLineDisplay(l: PremixLine): PremixLineDisplay {
  return { name: barIngredientName(l.name), amount: bottleLineAmount(l.qty, l.unit), shots: shotsUpTo(l.qty, l.unit, LINE_SHOTS_MAX_ML) };
}

export interface PremixUseDisplay {
  drink: string;
  /** "2½ shots" for a clean pour, else the amount ("80 ml") */
  pour: string;
  /** "9 serves per bottle" */
  serves: string | null;
}

/**
 * How many whole drinks one bottle makes, when every drink that uses it agrees ("Makes 7 drinks"). The batch inside holds exactly
 * that many pours, so this is the batch volume divided by the pour. Null when no drink uses it or they disagree.
 */
export function drinksPerBottle(p: Pick<Premix, "yieldQty" | "yieldUnit" | "usedIn">): number | null {
  const bottle = bottleMl(p);
  const counts = new Set(p.usedIn.map((u) => servesPerBottle(bottle, u.qty, u.unit)));
  if (counts.size !== 1) return null;
  const n = [...counts][0];
  return n != null && n >= 1 ? n : null;
}

/** "Makes 7 drinks" / "Makes 1 drink". */
export function makesText(n: number): string {
  return `Makes ${n} ${n === 1 ? "drink" : "drinks"}`;
}

export function premixUseDisplay(u: PremixUse, bottle: number | null, batch = false): PremixUseDisplay {
  const n = servesPerBottle(bottle, u.qty, u.unit);
  const per = batch ? "per batch" : "per bottle";
  return { drink: u.drink, pour: shotsUpTo(u.qty, u.unit, POUR_SHOTS_MAX_ML) ?? premixAmount(u.qty, u.unit), serves: n == null || n < 1 ? null : batch ? `${n} ${per}` : `${n} ${n === 1 ? "serve" : "serves"} ${per}` };
}

/**
 * A pre-mix that is a BATCH rather than a bottle: more than fits the venue's biggest bottle (the 4 L green tea), or not a volume.
 * The card then says "Batches To Make" and "3 batches, 12 L" instead of bottles (Troy, 30 Oct 2026).
 */
export function isBatchPremix(p: Pick<Premix, "yieldQty" | "yieldUnit">, venueSlug?: string): boolean {
  return bottleMl(p) == null || bottleSizeText(p, venueSlug).endsWith(" batch");
}

/** "2 pre-mixes" / "1 pre-mix" for the entry row on the station. */
export function premixCountText(n: number): string {
  return `${n} ${n === 1 ? "pre-mix" : "pre-mixes"}`;
}

// ---------------------------------------------------------------- making several bottles at once
// The bar makes pre-mixes in big batches, not one bottle at a time (Troy, 25 Oct 2026): a bottle counter on each card multiplies
// the whole recipe, so the team reads one set of amounts instead of doing the sums. Display only: nothing is saved or costed.

/** The most bottles one card can ask for. */
export const MAX_BOTTLES = 40;

/** A whole number of bottles from 1 to MAX_BOTTLES (anything else, including NaN, reads as 1). */
export function clampBottles(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_BOTTLES, Math.max(1, Math.round(n)));
}

/** "1 bottle" / "4 bottles". */
export function bottlesText(n: number, batch = false): string {
  const b = clampBottles(n);
  const one = batch ? "batch" : "bottle";
  return `${b} ${b === 1 ? one : batch ? "batches" : "bottles"}`;
}

/** A volume in ml as the team would pour it: "560 ml" up to a litre, then litres ("1.4 L", "2.33 L", never more than two decimals). Rounded down. */
export function volumeText(ml: number): string {
  const whole = Math.floor(ml + 1e-6);
  if (whole < 1000) return `${whole.toLocaleString("en-AU")} ml`;
  const litres = Math.floor(whole / 10) / 100;
  return `${litres.toLocaleString("en-AU", { maximumFractionDigits: 2 })} L`;
}

/**
 * One ingredient line scaled to `bottles`. Volumes round DOWN after the multiply (116.67 ml x 3 is 350 ml, the same rule as one
 * bottle) and read in litres from 1 L; other units keep their own style ("2 each").
 */
export function batchLineAmount(qty: number, unit: string, bottles: number): string {
  const n = clampBottles(bottles);
  const ml = toMl(qty * n, unit);
  if (ml == null) return qtyText(qty * n, unit);
  return volumeText(ml);
}

export interface BatchLineDisplay extends PremixLineDisplay {
  /** "140 ml a bottle" when more than one bottle is being made (so the one-bottle amount is still readable), else null */
  each: string | null;
}

export function batchLineDisplay(l: PremixLine, bottles: number): BatchLineDisplay {
  const n = clampBottles(bottles);
  const one = premixLineDisplay(l);
  if (n === 1) return { ...one, each: null };
  return { name: one.name, amount: batchLineAmount(l.qty, l.unit, n), shots: null, each: `${one.amount} a bottle` };
}

/** The whole batch: "4 bottles, 2.8 L" (a non-volume yield reads "4 bottles"). Null for one bottle, where the card already says its size. */
export function batchTotalText(p: Pick<Premix, "yieldQty" | "yieldUnit">, bottles: number, drinksEach?: number | null, batch = false): string | null {
  const n = clampBottles(bottles);
  if (n === 1) return null;
  const ml = bottleMl(p);
  const drinks = drinksEach && !batch ? `, ${drinksEach * n} drinks` : "";
  return ml == null ? `${bottlesText(n, batch)}${drinks}` : `${bottlesText(n, batch)}${drinks}, ${volumeText(ml * n)}`;
}

/** "36 serves from 4 bottles" for one drink's line (each bottle makes whole serves). Null for one bottle or when serves cannot be worked out. */
export function batchServesText(bottle: number | null, u: PremixUse, bottles: number, batch = false): string | null {
  const n = clampBottles(bottles);
  if (n === 1) return null;
  const per = servesPerBottle(bottle, u.qty, u.unit);
  if (per == null || per < 1) return null;
  const total = per * n;
  return batch ? `${total} from ${bottlesText(n, true)}` : `${total} ${total === 1 ? "serve" : "serves"} from ${bottlesText(n)}`;
}
