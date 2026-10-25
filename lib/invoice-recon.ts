/**
 * Invoice reconciliation: proves (or fails to prove) that a read invoice adds up before any price is trusted.
 *
 *   price basis  every printed price is turned into an ex GST price (4 dp, never rounded to cents inside)
 *   line maths   qty x unit price (less any printed discount) = line total, for product lines. The tolerance scales with the
 *                quantity (`lineTolerance`): a supplier prints the unit price rounded to the cent but works the total from the
 *                unrounded price, so a total can be half a cent per unit away from qty x price, plus a cent of rounding.
 *   subtotal     the line totals add up to the printed subtotal, within 5c
 *   GST          the printed GST is the GST rate on the taxable lines, within 5c
 *   total        the printed total is subtotal + GST, within 5c
 *
 * An invoice with nothing printed to check against is NOT reconciled (it cannot be proven). Every note is plain words for a person.
 *
 * Smarter reading, never looser proof (Troy, 25 Oct 2026): a printed Discount column, an Amount column that includes GST while the
 * unit price does not, lines that were not supplied and a GST total of 0.00 are all understood. A line that still does not add up
 * may be explained by an INFERENCE (an amount that includes GST, or an unlabelled clean-percent discount), but only when the
 * document's printed subtotal, GST and total all agree with that reading; otherwise the line fails exactly as before.
 *
 * A printed Discount column is read TWO ways per line (25 Oct 2026, Markris): (A) the discount comes off the printed price, or (B) the
 * printed price is already net of it and the column is only information. Whichever reproduces the printed line total wins; B wins
 * a tie. A line neither reading explains fails as before. Pure, no store, no clock.
 */
import type { ExtractedLine, GstFlag, LineClass, ReconNote } from "./invoice-types";
import { dollars, normCode, qtyText, round4, tidyLabel } from "./invoice-names";
import { discountKey } from "./invoice-landed";

/** The smallest tolerance on a line: 2c. */
export const LINE_TOLERANCE = 0.02;
export const SUM_TOLERANCE = 0.05;
/** Half a cent per unit: the unit price is printed to the cent but the total is worked from the unrounded price. */
export const PER_UNIT_TOLERANCE = 0.005;
const EPS = 1e-9;

/**
 * How far a line total may sit from qty x unit price: max(2c, qty x half a cent + 1c). 10 x 5.77 = 57.70 against 57.65 is fine (limit
 * 6c); 2.39 kg x 41.50 = 99.185 against 98.98 (diff 20.5c, limit 2.2c) is a real mismatch and still fails.
 */
export function lineTolerance(qty: number | null | undefined): number {
  return Math.max(LINE_TOLERANCE, Math.abs(qty ?? 0) * PER_UNIT_TOLERANCE + 0.01);
}

export interface LineAmounts {
  unit_price_ex: number | null;
  line_total_ex: number | null;
  /** GST on the line in dollars; null when the GST status is unknown */
  gst_amount: number | null;
  /** false when a printed price includes GST but the GST status is unknown, so it cannot be turned into an ex GST price */
  convertible: boolean;
}

type BasisFields = Pick<ExtractedLine, "unit_price" | "line_total" | "basis" | "gst"> & { total_basis?: "ex" | "inc" | null };

/**
 * Turn what was printed into ex GST amounts. Printed inc GST on a taxable line is divided by (1 + rate); GST free is already ex.
 * The unit price follows `basis`; the line total follows `total_basis` when the reader gave one (an Amount column that includes GST
 * beside a unit price that does not), else `basis`. A printed zero is the same in every basis, so it never needs the GST status.
 */
export function lineAmounts(line: BasisFields, gstRate: number): LineAmounts {
  const toEx = (v: number | null, basis: "ex" | "inc"): number | null => {
    if (v == null || !Number.isFinite(v)) return null;
    if (v === 0) return 0;
    if (basis === "ex") return round4(v);
    if (line.gst === "taxable") return round4(v / (1 + gstRate));
    if (line.gst === "free") return round4(v);
    return null; // inc GST with the GST status unknown: cannot be converted
  };
  const totalBasis = line.total_basis ?? line.basis;
  const unit_price_ex = toEx(line.unit_price, line.basis);
  const line_total_ex = toEx(line.line_total, totalBasis);
  const convertible = !((line.unit_price != null && unit_price_ex == null) || (line.line_total != null && line_total_ex == null));
  let gst_amount: number | null = null;
  if (line_total_ex != null) {
    if (line.gst === "taxable") gst_amount = round4(line_total_ex * gstRate);
    else if (line.gst === "free") gst_amount = 0;
  }
  return { unit_price_ex, line_total_ex, gst_amount, convertible };
}

/** ex when every priced line was printed ex GST, inc when every one was inc, mixed otherwise; null when no line has a price. */
export function documentPriceBasis(lines: Pick<ExtractedLine, "unit_price" | "line_total" | "basis">[]): "ex" | "inc" | "mixed" | null {
  const seen = new Set<string>();
  for (const l of lines) if (l.unit_price != null || l.line_total != null) seen.add(l.basis);
  if (seen.size === 0) return null;
  return seen.size > 1 ? "mixed" : (Array.from(seen)[0] as "ex" | "inc");
}

export interface ReconLine {
  index: number;
  line_class: LineClass;
  description: string;
  qty: number | null;
  /** as printed (not converted) */
  unit_price: number | null;
  line_total: number | null;
  basis: "ex" | "inc";
  gst: GstFlag;
  amounts: LineAmounts;
  /** whether the printed line total includes GST; absent = the same as `basis` */
  total_basis?: "ex" | "inc" | null;
  /** a printed Discount column as a percent (20 = 20%) */
  discount_pct?: number | null;
  /** a printed discount in dollars, in the same basis as the line total */
  discount_amount?: number | null;
  /** the line was not supplied (see isNotSupplied): left out of every check */
  skip?: boolean;
}

export interface ReconInput {
  lines: ReconLine[];
  gstRate: number;
  subtotal_ex: number | null;
  gst_total: number | null;
  total_inc: number | null;
}

/** What an inference changes about a line, for the caller to apply before it works out the line's ex GST amounts again. */
export interface LinePatch {
  basis?: "ex" | "inc";
  total_basis?: "ex" | "inc";
  gst?: GstFlag;
  discount_pct?: number;
  discount_amount?: number;
}

export interface LineInference {
  index: number;
  /** price_net: the printed price is already net of the printed Discount column, so no line discount is stored */
  kind: "gst_inclusive_total" | "discount" | "price_net";
  patch: LinePatch;
  /** the clean percent, for kind "discount" */
  pct?: number;
}

export interface ReconResult {
  notes: ReconNote[];
  reconciled: boolean;
  /** per ReconLine.index: true/false for a product line that could be checked, null when it could not */
  mathOk: Map<number, boolean | null>;
  /** lines that add up only under another reading: a discount column the price already includes (always safe), or an inference the document-level checks confirmed */
  inferred: Map<number, LineInference>;
}

const within = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol + EPS;

// ---------------------------------------------------------------- lines that were not supplied, and GST that can be settled
const NOT_SUPPLIED_RE = /\b(?:n\/a|na|not\s+available|unavailable|out\s+of\s+stock|no\s+stock|back\s*-?\s*order(?:ed)?|not\s+supplied|short\s+supplied)\b/i;

/**
 * Was this line NOT supplied (ordered but not delivered)? A line with money on it never is. Without money it is not supplied when
 * the supplied quantity is exactly 0, or the description says NA, not available, out of stock or back order. "SU - sent as
 * substitute" lines carry money and are not matched by any of this.
 */
export function isNotSupplied(line: Pick<ExtractedLine, "description" | "qty" | "unit_price" | "line_total">): boolean {
  if (line.line_total != null && Math.abs(line.line_total) > 0.004) return false;
  if (line.qty != null && line.qty === 0) return true;
  const noMoney = (line.line_total == null || line.line_total === 0) && (line.unit_price == null || line.unit_price === 0);
  return noMoney && NOT_SUPPLIED_RE.test(line.description);
}

const isZeroLine = (l: Pick<ExtractedLine, "unit_price" | "line_total">) =>
  (l.line_total == null || l.line_total === 0) && (l.unit_price == null || l.unit_price === 0);

/**
 * Settles the GST status the reader could not, before any amount is worked out:
 *  - an invoice that PRINTS a GST total of 0.00 (with a subtotal or total to prove it) is GST free on every line, whatever the
 *    reader flagged (a "(*) taxable" legend on an invoice with no GST);
 *  - a negative or zero-value line (a discount or credit) with an unknown status takes the status of the product it attaches to
 *    (same item code, else the same description once discount words are dropped), and is GST free when there is none.
 * Returns new line objects; the input is untouched.
 */
export function settleGst<T extends Pick<ExtractedLine, "item_code" | "description" | "unit_price" | "line_total" | "gst">>(
  lines: T[],
  printed: { subtotal_ex: number | null; gst_total: number | null; total_inc: number | null },
): T[] {
  if (printed.gst_total === 0 && (printed.subtotal_ex != null || printed.total_inc != null)) {
    return lines.map((l) => (l.gst === "free" ? l : { ...l, gst: "free" as GstFlag }));
  }
  const positive = lines.filter((l) => l.gst !== "unknown" && l.line_total != null && l.line_total > 0);
  return lines.map((l) => {
    if (l.gst !== "unknown") return l;
    const negative = l.line_total != null && l.line_total < 0;
    if (!negative && !isZeroLine(l)) return l;
    const code = normCode(l.item_code);
    const key = discountKey(l.description);
    let hits = code ? positive.filter((p) => normCode(p.item_code) === code) : [];
    if (hits.length === 0 && key !== "") hits = positive.filter((p) => discountKey(p.description) === key);
    const statuses = Array.from(new Set(hits.map((h) => h.gst)));
    return { ...l, gst: (statuses.length === 1 ? statuses[0] : "free") as GstFlag };
  });
}

// ---------------------------------------------------------------- line maths
/** An amount printed in one basis, expressed in another (null when the GST status is missing and the amount is not zero). */
function inBasis(v: number, from: "ex" | "inc", to: "ex" | "inc", gst: GstFlag, rate: number): number | null {
  if (v === 0 || from === to || gst === "free") return v;
  if (gst === "unknown") return null;
  return to === "ex" ? v / (1 + rate) : v * (1 + rate);
}

const pctText = (p: number) => `${Math.round(p * 100) / 100}%`;

interface DocLineView {
  total_ex: number | null;
  gst: GstFlag;
}

/** The three document-level checks over a set of line views. `ok` is false when any of them fails. */
function documentChecks(views: DocLineView[], gstRate: number, S: number | null, G: number | null, T: number | null): { notes: ReconNote[]; ok: boolean } {
  const notes: ReconNote[] = [];
  let ok = true;
  const fail = (check: ReconNote["check"], message: string) => {
    ok = false;
    notes.push({ check, ok: false, message });
  };
  let sumEx = 0;
  let taxableEx = 0;
  let gstResolvable = true;
  for (const v of views) {
    const t = v.total_ex;
    if (t == null) continue;
    sumEx += t;
    if (v.gst === "taxable") taxableEx += t;
    else if (v.gst === "unknown" && Math.abs(t) > EPS) gstResolvable = false;
  }
  sumEx = round4(sumEx);
  const expectedGst = round4(taxableEx * gstRate);

  // (b) subtotal
  if (S != null) {
    if (within(sumEx, S, SUM_TOLERANCE)) notes.push({ check: "subtotal", ok: true, message: `The lines add up to the subtotal (${dollars(S)}).` });
    else fail("subtotal", `The lines add up to ${dollars(sumEx)} but the invoice subtotal says ${dollars(S)}.`);
  }
  // (c) GST
  if (G != null) {
    if (!gstResolvable) fail("gst", "GST could not be checked because some lines do not say whether they carry GST.");
    else if (within(expectedGst, G, SUM_TOLERANCE)) notes.push({ check: "gst", ok: true, message: `The GST (${dollars(G)}) matches the taxable lines.` });
    else fail("gst", `GST on the taxable lines works out at ${dollars(expectedGst)} but the invoice says ${dollars(G)}.`);
  }
  // (d) total: subtotal + GST, using what is printed and the lines for whatever is not
  if (T != null) {
    const base = S ?? sumEx;
    const gstPart = G ?? (gstResolvable ? expectedGst : null);
    if (gstPart == null) fail("total", "The total could not be checked because some lines do not say whether they carry GST.");
    else if (within(base + gstPart, T, SUM_TOLERANCE)) notes.push({ check: "total", ok: true, message: `The total (${dollars(T)}) is the subtotal plus GST.` });
    else fail("total", `The subtotal ${dollars(base)} plus GST ${dollars(gstPart)} is ${dollars(base + gstPart)} but the invoice total says ${dollars(T)}.`);
  }
  return { notes, ok };
}

/** The most an unlabelled discount may be and still be believed. */
const MAX_INFERRED_DISCOUNT_PCT = 50;

interface Candidate {
  line: ReconLine;
  message: string;
  inference: LineInference | null;
  /** the line total ex GST under the inference */
  totalEx: number | null;
}

/** A failed line that could carry an unlabelled discount, with what the search needs. */
interface DiscountPoolEntry {
  cand: Candidate;
  gross: number;
  actual: number;
  qty: number;
}

/** Check one document. Returns plain-words notes (failures and passes), whether it is reconciled, and the per-line maths result. */
export function reconcile(input: ReconInput): ReconResult {
  const { gstRate } = input;
  const lines = input.lines.filter((l) => !l.skip);
  const notes: ReconNote[] = [];
  const mathOk = new Map<number, boolean | null>();
  for (const l of input.lines) if (l.skip) mathOk.set(l.index, null);
  const inferred = new Map<number, LineInference>();
  let allOk = true;
  const fail = (check: ReconNote["check"], message: string) => {
    allOk = false;
    notes.push({ check, ok: false, message });
  };
  const { subtotal_ex: S, gst_total: G, total_inc: T } = input;
  const anyPrinted = S != null || G != null || T != null;

  // GST status that stops a price being read at all
  for (const l of lines) {
    if (!l.amounts.convertible) {
      fail("gst", `${tidyLabel(l.description)}: the invoice does not say whether GST is included in this price, so it cannot be read.`);
    }
  }

  // (a) line maths, product lines only
  const failed: Candidate[] = [];
  const pool: DiscountPoolEntry[] = [];
  let checked = 0;
  let priceNetLines = 0;
  for (const l of lines) {
    if (l.line_class !== "product") continue;
    const hasPrice = l.unit_price != null;
    const hasTotal = l.line_total != null;
    if (!hasPrice && !hasTotal) {
      mathOk.set(l.index, null);
      fail("line_math", `${tidyLabel(l.description)}: no price or total could be read.`);
      continue;
    }
    if (l.qty == null || !hasPrice || !hasTotal) {
      mathOk.set(l.index, null);
      continue;
    }
    const basis = l.basis;
    const totalBasis = l.total_basis ?? basis;
    const actual = inBasis(l.line_total as number, totalBasis, basis, l.gst, gstRate);
    const amt = l.discount_amount ?? 0;
    const amtU = inBasis(amt, totalBasis, basis, l.gst, gstRate);
    if (actual == null || amtU == null) {
      mathOk.set(l.index, null); // the GST problem above already failed the invoice
      continue;
    }
    checked += 1;
    const qty = l.qty as number;
    const price = l.unit_price as number;
    const pct = l.discount_pct ?? 0;
    const declared = pct !== 0 || amt !== 0;
    const gross = qty * price;
    const tol = lineTolerance(qty);
    // Reading B: the printed price is already net of the Discount column. Tried first, so it wins a tie. It is only the plain
    // qty x price = total check, so it can never excuse a line that does not add up on its own terms.
    if (declared && within(gross, actual, tol)) {
      mathOk.set(l.index, true);
      inferred.set(l.index, { index: l.index, kind: "price_net", patch: { discount_pct: 0, discount_amount: 0 } });
      priceNetLines += 1;
      continue;
    }
    // Reading A: the discount comes off the printed price.
    const calc = gross * (1 - pct / 100) - amtU;
    if (within(calc, actual, tol)) {
      mathOk.set(l.index, true);
      continue;
    }
    mathOk.set(l.index, false);
    const less = `${pct !== 0 ? ` less ${pctText(pct)}` : ""}${amt !== 0 ? ` less ${dollars(amt)}` : ""}`;
    const message = `${tidyLabel(l.description)}: ${qtyText(l.qty)} x ${dollars(l.unit_price)}${less} is ${dollars(calc)} but the line says ${dollars(l.line_total)}.`;

    // An INFERENCE is tried only for a line with no printed discount, and only when the document has printed totals to confirm it.
    let inference: LineInference | null = null;
    let totalEx: number | null = l.amounts.line_total_ex;
    let poolable = false;
    if (!declared && anyPrinted && gross > 0 && actual >= 0) {
      const taxableOrProven = l.gst === "taxable" || (l.gst === "unknown" && G != null && G > 0);
      if (taxableOrProven && within(actual, gross * (1 + gstRate), tol * (1 + gstRate))) {
        // the Amount column carries GST that the unit price does not
        inference = { index: l.index, kind: "gst_inclusive_total", patch: { basis: "ex", total_basis: "inc", gst: "taxable" } };
        totalEx = round4((l.line_total as number) / (1 + gstRate));
      } else if (totalBasis === basis && l.gst !== "unknown") {
        poolable = true; // maybe an unlabelled discount: judged for the whole document below
      }
    }
    const cand: Candidate = { line: l, message, inference, totalEx };
    failed.push(cand);
    if (poolable) pool.push({ cand, gross, actual, qty });
  }

  // An unlabelled discount is judged for the whole document at once, in DOLLARS: one clean percent (multiples of 0.5 from 1 to 50,
  // smallest first) that every failing line fits within its own tolerance. A supplier that takes the same percent off every line
  // leaves a consistent shortfall, but cents rounding on a small line moves its percent by more than a tight percent test allows.
  // Consistency across lines is the evidence; a lone line must also sit very close to the percent. Believed only when a printed
  // subtotal or total exists to check the lines against (and the document check below agrees).
  if (pool.length > 0 && (S != null || T != null)) {
    for (let p = 1; p <= MAX_INFERRED_DISCOUNT_PCT + EPS; p += 0.5) {
      if (!pool.every((e) => within(e.gross * (1 - p / 100), e.actual, lineTolerance(e.qty)))) continue;
      if (pool.length === 1) {
        const e = pool[0];
        if (Math.abs(((e.gross - e.actual) / e.gross) * 100 - p) > 0.05) continue;
      }
      for (const e of pool) e.cand.inference = { index: e.cand.line.index, kind: "discount", patch: { discount_pct: p }, pct: p };
      break;
    }
  }

  // Accept the inferences only if the document's own printed figures agree with that reading.
  const candidates = failed.filter((f) => f.inference);
  const byIndex = new Map(candidates.map((c) => [c.line.index, c]));
  const view = (l: ReconLine, use: boolean): DocLineView => {
    const c = use ? byIndex.get(l.index) : undefined;
    return { total_ex: c ? c.totalEx : l.amounts.line_total_ex, gst: c?.inference?.patch.gst ?? l.gst };
  };
  const accepted = candidates.length > 0 && documentChecks(lines.map((l) => view(l, true)), gstRate, S, G, T).ok;
  for (const f of failed) {
    if (accepted && f.inference) {
      mathOk.set(f.line.index, true);
      inferred.set(f.line.index, f.inference);
    } else {
      fail("line_math", f.message);
    }
  }
  if (checked > 0 && failed.every((f) => accepted && f.inference)) {
    notes.push({ check: "line_math", ok: true, message: "Every line's quantity times price matches its total." });
  }
  if (priceNetLines > 0) {
    notes.push({ check: "line_math", ok: true, message: "The printed prices already include the discount column." });
  }
  if (accepted) {
    const gstLines = candidates.filter((c) => c.inference?.kind === "gst_inclusive_total");
    if (gstLines.length > 0) {
      const names = gstLines.slice(0, 5).map((c) => tidyLabel(c.line.description)).join(", ");
      const more = gstLines.length > 5 ? ` and ${gstLines.length - 5} more` : "";
      notes.push({
        check: "line_math",
        ok: true,
        message: `Amount includes GST on ${gstLines.length === 1 ? "this line" : "these lines"}: ${names}${more}. The unit price is before GST.`,
      });
    }
    for (const c of candidates.filter((x) => x.inference?.kind === "discount")) {
      const l = c.line;
      const gross = (l.qty as number) * (l.unit_price as number);
      notes.push({
        check: "line_math",
        ok: true,
        message: `${tidyLabel(l.description)}: ${pctText(c.inference?.pct as number)} off ${dollars(gross)} is ${dollars(l.line_total)}. The invoice does not label this discount, but its printed totals agree with it.`,
      });
    }
  }

  // document level, on the readings as accepted
  const doc = documentChecks(lines.map((l) => view(l, accepted)), gstRate, S, G, T);
  for (const n of doc.notes) {
    if (!n.ok) allOk = false;
    notes.push(n);
  }
  // (e) nothing to check against
  if (!anyPrinted) fail("total", "The invoice shows no subtotal, GST or total to check the lines against, so it cannot be proven to add up.");

  return { notes, reconciled: allOk && anyPrinted, mathOk, inferred };
}
