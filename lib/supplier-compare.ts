import { money } from "./format";

/**
 * Dual-sourced items (owners' rule, 15 Oct 2026): order from the product's own supplier (Star) unless another supplier is
 * cheaper by enough to matter. "Enough" is when this supplier's price is 10% or more OVER the other's. The app only says so; it
 * never switches a supplier by itself. Both prices are for the same unit and size, inc GST. Pure, no store.
 */
export const SWITCH_PCT = 0.1;

export interface SupplierCompare {
  /** (this price - other price) / other price: 0.12 means this supplier is 12% over the other */
  overPct: number;
  /** this price - other price, in dollars (negative when this supplier is the cheaper) */
  diff: number;
  /** this supplier is at or over the switch line */
  flagged: boolean;
}

export function compareSuppliers(price: number | null | undefined, otherPrice: number | null | undefined): SupplierCompare | null {
  const p = Number(price);
  const o = Number(otherPrice);
  if (!(p > 0) || !(o > 0)) return null;
  const overPct = (p - o) / o;
  // a tiny tolerance so 110 against 100 reads as exactly 10%
  return { overPct, diff: Math.round((p - o) * 100) / 100, flagged: overPct >= SWITCH_PCT - 1e-9 };
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const unitText = (unit: string | null | undefined) => (unit ? ` a ${unit.toLowerCase()}` : "");

export interface CompareInput {
  price: number | null | undefined;
  otherName: string | null | undefined;
  otherPrice: number | null | undefined;
  unit?: string | null;
}

/** The note for an order line: only when the other supplier is at least 10% cheaper, otherwise null (the line stays quiet). */
export function switchNote(i: CompareInput): string | null {
  const c = compareSuppliers(i.price, i.otherPrice);
  const name = (i.otherName ?? "").trim();
  if (!c || !c.flagged || !name) return null;
  return `${name} is ${money(c.diff)}${unitText(i.unit)} cheaper. This price is ${pct(c.overPct)} over theirs. The owners' rule is to look at switching at 10% over.`;
}

/** The sentence on the product page, always shown once an other supplier price is saved, saying what to do. */
export function compareSentence(i: CompareInput): string | null {
  const c = compareSuppliers(i.price, i.otherPrice);
  const name = (i.otherName ?? "").trim() || "The other supplier";
  if (!c) return null;
  if (c.flagged) return `${name} is ${money(c.diff)}${unitText(i.unit)} cheaper. This price is ${pct(c.overPct)} over theirs, so look at switching (the rule is 10% over).`;
  if (c.diff > 0) return `${name} is ${money(c.diff)}${unitText(i.unit)} cheaper, but this price is only ${pct(c.overPct)} over theirs. Stay with this supplier (the rule is 10% over).`;
  if (c.diff < 0) return `This price is ${money(-c.diff)}${unitText(i.unit)} under ${name} (${pct(c.overPct)}). Stay with this supplier.`;
  return `The same price as ${name}. Stay with this supplier.`;
}
