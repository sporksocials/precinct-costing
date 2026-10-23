/**
 * Invoice reconciliation: proves (or fails to prove) that a read invoice adds up before any price is trusted.
 *
 *   price basis  every printed price is turned into an ex GST price (4 dp, never rounded to cents inside)
 *   line maths   qty x unit price = line total, within 2c, for product lines
 *   subtotal     the line totals add up to the printed subtotal, within 5c
 *   GST          the printed GST is the GST rate on the taxable lines, within 5c
 *   total        the printed total is subtotal + GST, within 5c
 *
 * An invoice with nothing printed to check against is NOT reconciled (it cannot be proven). Every note is plain words for a person.
 * Pure, no store, no clock.
 */
import type { ExtractedLine, GstFlag, LineClass, ReconNote } from "./invoice-types";
import { dollars, qtyText, round4, tidyLabel } from "./invoice-names";

export const LINE_TOLERANCE = 0.02;
export const SUM_TOLERANCE = 0.05;
const EPS = 1e-9;

export interface LineAmounts {
  unit_price_ex: number | null;
  line_total_ex: number | null;
  /** GST on the line in dollars; null when the GST status is unknown */
  gst_amount: number | null;
  /** false when a printed price includes GST but the GST status is unknown, so it cannot be turned into an ex GST price */
  convertible: boolean;
}

/** Turn what was printed into ex GST amounts. Printed inc GST on a taxable line is divided by (1 + rate); GST free is already ex. */
export function lineAmounts(line: Pick<ExtractedLine, "unit_price" | "line_total" | "basis" | "gst">, gstRate: number): LineAmounts {
  const toEx = (v: number | null): number | null => {
    if (v == null || !Number.isFinite(v)) return null;
    if (line.basis === "ex") return round4(v);
    if (line.gst === "taxable") return round4(v / (1 + gstRate));
    if (line.gst === "free") return round4(v);
    return null; // inc GST with the GST status unknown: cannot be converted
  };
  const printedAny = line.unit_price != null || line.line_total != null;
  const unit_price_ex = toEx(line.unit_price);
  const line_total_ex = toEx(line.line_total);
  const convertible = !(printedAny && line.basis === "inc" && line.gst === "unknown");
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
}

export interface ReconInput {
  lines: ReconLine[];
  gstRate: number;
  subtotal_ex: number | null;
  gst_total: number | null;
  total_inc: number | null;
}

export interface ReconResult {
  notes: ReconNote[];
  reconciled: boolean;
  /** per ReconLine.index: true/false for a product line that could be checked, null when it could not */
  mathOk: Map<number, boolean | null>;
}

const within = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol + EPS;

/** Check one document. Returns plain-words notes (failures and passes), whether it is reconciled, and the per-line maths result. */
export function reconcile(input: ReconInput): ReconResult {
  const { lines, gstRate } = input;
  const notes: ReconNote[] = [];
  const mathOk = new Map<number, boolean | null>();
  let allOk = true;
  const fail = (check: ReconNote["check"], message: string) => {
    allOk = false;
    notes.push({ check, ok: false, message });
  };

  // GST status that stops a price being read at all
  for (const l of lines) {
    if (!l.amounts.convertible) {
      fail("gst", `${tidyLabel(l.description)}: the invoice does not say whether GST is included in this price, so it cannot be read.`);
    }
  }

  // (a) line maths, product lines only
  let checked = 0;
  let mathFailures = 0;
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
    checked += 1;
    const calc = (l.qty as number) * (l.unit_price as number);
    const ok = within(calc, l.line_total as number, LINE_TOLERANCE);
    mathOk.set(l.index, ok);
    if (!ok) {
      mathFailures += 1;
      fail(
        "line_math",
        `${tidyLabel(l.description)}: ${qtyText(l.qty)} x ${dollars(l.unit_price)} is ${dollars(calc)} but the line says ${dollars(l.line_total)}.`,
      );
    }
  }
  if (checked > 0 && mathFailures === 0) notes.push({ check: "line_math", ok: true, message: "Every line's quantity times price matches its total." });

  // Sums over every line (credits and discounts are negative)
  let sumEx = 0;
  let taxableEx = 0;
  let gstResolvable = true;
  for (const l of lines) {
    const t = l.amounts.line_total_ex;
    if (t == null) continue;
    sumEx += t;
    if (l.gst === "taxable") taxableEx += t;
    else if (l.gst === "unknown" && Math.abs(t) > EPS) gstResolvable = false;
  }
  sumEx = round4(sumEx);
  const expectedGst = round4(taxableEx * gstRate);

  const { subtotal_ex: S, gst_total: G, total_inc: T } = input;
  const anyPrinted = S != null || G != null || T != null;

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
  // (e) nothing to check against
  if (!anyPrinted) fail("total", "The invoice shows no subtotal, GST or total to check the lines against, so it cannot be proven to add up.");

  return { notes, reconciled: allOk && anyPrinted, mathOk };
}
