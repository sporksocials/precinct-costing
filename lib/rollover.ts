import { brisbaneToday, effectivePackPrice, groupDeals } from "./deals";
import type { Ingredient, IngredientDeal } from "./types";

/**
 * Date rollover for deals. Brisbane is UTC+10 all year (no daylight saving), so the next Brisbane midnight is
 * pure arithmetic on the epoch and does not depend on the device's timezone.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BRISBANE_OFFSET_MS = 10 * HOUR;
/** fire a moment after midnight so the date has definitely changed when the timer runs */
export const ROLLOVER_BUFFER_MS = 500;
/** safety tick that compares the date, in case a timer was throttled or the device slept */
export const ROLLOVER_TICK_MS = 60_000;

/** Milliseconds from `nowMs` until the next Brisbane midnight (always > 0, at most 24 hours). */
export function msUntilBrisbaneMidnight(nowMs: number): number {
  const intoDay = (((nowMs + BRISBANE_OFFSET_MS) % DAY) + DAY) % DAY;
  return DAY - intoDay;
}

/** Delay to hand to setTimeout: until the next Brisbane midnight plus the buffer. */
export function rolloverDelayMs(nowMs: number): number {
  return msUntilBrisbaneMidnight(nowMs) + ROLLOVER_BUFFER_MS;
}

export interface RolloverChange {
  ingredientId: string;
  from: number;
  to: number;
}

/**
 * Ingredients whose effective (deal) pack price is different on `toDay` than on `fromDay`. Empty when no deal
 * changed anything, which is the only time the app stays silent about a rollover.
 */
export function dealPriceChanges(ingredients: Ingredient[], deals: IngredientDeal[] | null | undefined, fromDay: string, toDay: string): RolloverChange[] {
  if (!deals?.length || fromDay === toDay) return [];
  const by = groupDeals(deals);
  const out: RolloverChange[] = [];
  for (const ing of ingredients) {
    const own = by.get(ing.id);
    if (!own) continue;
    const base = Number(ing.pack_price);
    const from = effectivePackPrice(base, own, fromDay);
    const to = effectivePackPrice(base, own, toDay);
    if (Math.abs(from - to) > 1e-9) out.push({ ingredientId: ing.id, from, to });
  }
  return out;
}

/** The toast text for a rollover, or null when nothing changed. A price going up means a deal ended. */
export function rolloverMessage(changes: RolloverChange[]): string | null {
  if (!changes.length) return null;
  return changes.some((c) => c.to > c.from) ? "A deal ended, so costs were refreshed" : "A deal started, so costs were refreshed";
}

/** Today in Brisbane for a given epoch time. */
export function brisbaneDayAt(nowMs: number): string {
  return brisbaneToday(new Date(nowMs));
}
