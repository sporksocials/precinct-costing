/**
 * The auto-apply guards: the rules that decide whether an invoice price may change an app price by itself. Pure and exported so
 * the screens can show the same checklist the engine used. A price applies itself only when EVERY guard passes; the first guard
 * that fails gives the one plain-words reason the line waits for a person.
 *
 *   duplicate, supplier, reconciled, math, match, costed_supplier, units, price, delivered, credit, deal, date, age, change,
 *   learning, supplier_trust
 *
 * The substantive problems come before the two policy switches (learning mode, supplier trust), so a line that is both risky and in
 * learning mode tells people about the risk. A price that equals the current price ("price confirmed") only needs the guards that
 * make the invoice trustworthy; learning mode and supplier trust never stop it.
 */
import type { LineClass, LineDecision, MatchMethod, MatchState } from "./invoice-types";
import { dollars, limitText, pctText, round6 } from "./invoice-names";

export type GuardId =
  | "duplicate"
  | "supplier"
  | "reconciled"
  | "math"
  | "match"
  | "costed_supplier"
  | "units"
  | "price"
  | "delivered"
  | "credit"
  | "deal"
  | "date"
  | "age"
  | "change"
  | "learning"
  | "supplier_trust";

export interface GuardResult {
  id: GuardId;
  ok: boolean;
  /** short and positive, for a checklist: "Invoice adds up" */
  label: string;
  /** plain words for the failure (also set when ok, as the passing sentence) */
  reason: string;
}

export interface GuardInput {
  /** a repeat of an invoice already filed */
  duplicate: boolean;
  /** the supplier is one we know and its ABN is not in doubt */
  supplierKnown: boolean;
  reconciled: boolean;
  lineClass: LineClass;
  mathOk: boolean | null;
  matchState: MatchState;
  matchMethod: MatchMethod | null;
  /**
   * The line's target is not an ingredient costed on another supplier's price. True when the line has no ingredient target, or the
   * ingredient's costing supplier is the invoice supplier's costing supplier. Owners cost interchangeable products on the dearer
   * supplier, so one supplier's invoice must not move a price that another supplier's list sets.
   */
  costedSupplierOk: boolean;
  /** at least one price target (ingredient pack, ordering product) has a known unit conversion */
  unitsKnown: boolean;
  /** a plain-words problem with the units that must stop the line (a pack count conflict), else null */
  unitsProblem: string | null;
  /** at least one new price could be worked out, and it is above zero */
  hasPrice: boolean;
  /** a plain-words reason no price could be worked out (GST unclear, no unit price), else null */
  priceProblem: string | null;
  qty: number | null;
  /** the line is negative or a credit */
  isCredit: boolean;
  /** dollars (negative) of credit notes attached to this line, 0 when none */
  creditAttachedEx: number;
  hasDeal: boolean;
  invoiceDate: string | null;
  /** the ingredient's last_price_update; null for none, or for a line with no ingredient (no date to compare) */
  lastPriceUpdate: string | null;
  today: string;
  /** the largest |change| across the price targets as a fraction; null when any target has no current price to compare */
  changePct: number | null;
  autoApplyPct: number;
  learningMode: boolean;
  supplierAutoApply: boolean;
}

export type GuardPurpose = "apply" | "confirm";

const pass = (id: GuardId, label: string, reason = label): GuardResult => ({ id, ok: true, label, reason });
const stop = (id: GuardId, label: string, reason: string): GuardResult => ({ id, ok: false, label, reason });

/**
 * Two prices are the same when they differ by less than half a cent. The apply layer (invoice-apply) uses this same constant for
 * "nothing to change", so the engine's "price confirmed" and the apply layer's skip can never disagree.
 */
export const SAME_PRICE_EPS = 0.005;
export const isSamePrice = (a: number, b: number): boolean => Math.abs(a - b) < SAME_PRICE_EPS;

/** An invoice dated more than this many days before today is never automatic: a person looks at it first. */
export const MAX_INVOICE_AGE_DAYS = 45;

const DAY_MS = 86_400_000;
/** Whole days from one ISO date to another (b minus a); null when either is not a date. */
function daysBetween(a: string, b: string): number | null {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / DAY_MS) : null;
}

const iso = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every guard in order, each with its result. `purpose: "confirm"` is for a price that equals the current one: it keeps the guards
 * that make the invoice trustworthy and drops the ones about a CHANGE (deal, big change, learning mode, supplier trust, credits).
 */
export function evaluateGuards(i: GuardInput, purpose: GuardPurpose = "apply"): GuardResult[] {
  const g: GuardResult[] = [];
  g.push(i.duplicate ? stop("duplicate", "Not a repeat", "This invoice is a copy of one already filed.") : pass("duplicate", "Not a repeat"));
  g.push(i.supplierKnown ? pass("supplier", "Supplier known") : stop("supplier", "Supplier known", "The supplier is new or not confirmed yet."));
  g.push(i.reconciled ? pass("reconciled", "Invoice adds up") : stop("reconciled", "Invoice adds up", "Invoice does not add up."));
  g.push(
    i.mathOk === true
      ? pass("math", "Line adds up")
      : stop("math", "Line adds up", i.mathOk === false ? "The line's quantity times price does not match its total." : "The line's maths could not be checked."),
  );
  const certain = i.matchState === "matched" && (i.matchMethod === "code" || i.matchMethod === "alias" || i.matchMethod === "human");
  g.push(certain ? pass("match", "Matched by code or saved match") : stop("match", "Matched by code or saved match", "The product is not matched by code or by a saved match."));
  g.push(
    i.costedSupplierOk
      ? pass("costed_supplier", "Costed on this supplier")
      : stop(
          "costed_supplier",
          "Costed on this supplier",
          "This ingredient is costed on a different supplier's price, so this invoice should not change it on its own.",
        ),
  );
  g.push(
    i.unitsProblem
      ? stop("units", "Pack size known", i.unitsProblem)
      : i.unitsKnown
        ? pass("units", "Pack size known")
        : stop("units", "Pack size known", "The pack size for this unit is not known."),
  );
  g.push(i.hasPrice ? pass("price", "Price readable") : stop("price", "Price readable", i.priceProblem ?? "No usable price could be worked out for this line."));

  if (purpose === "apply") {
    g.push(
      i.qty != null && i.qty <= 0
        ? stop("delivered", "Delivered", "Nothing was delivered on this line (quantity 0).")
        : pass("delivered", "Delivered"),
    );
    const creditProblem = i.isCredit
      ? "This line is a credit, so it does not set a price."
      : i.creditAttachedEx < 0
        ? `A credit of ${dollars(Math.abs(i.creditAttachedEx))} was issued against this line.`
        : null;
    g.push(creditProblem ? stop("credit", "No credit", creditProblem) : pass("credit", "No credit"));
    g.push(i.hasDeal ? stop("deal", "No deal", "This product has a deal, so its real price is not the list price.") : pass("deal", "No deal"));
  }

  // date: an apply needs both dates and the invoice not older than the price; a confirm only needs a date it can stamp
  const inv = i.invoiceDate && iso.test(i.invoiceDate) ? i.invoiceDate : null;
  const last = i.lastPriceUpdate && iso.test(i.lastPriceUpdate) ? i.lastPriceUpdate : null;
  let dateProblem: string | null = null;
  if (!inv) dateProblem = "The invoice date could not be read.";
  else if (inv > i.today) dateProblem = "The invoice date is in the future.";
  else if (last && inv < last) dateProblem = "The invoice is older than the price already in the app.";
  else if (purpose === "apply" && !last) dateProblem = "There is no record of when this price last changed.";
  g.push(dateProblem ? stop("date", "Newer than the current price", dateProblem) : pass("date", "Newer than the current price"));

  // age: an old invoice is read by a person first, whatever else is true (both purposes: it also stops a price being "confirmed")
  const age = inv && inv <= i.today ? daysBetween(inv, i.today) : null;
  g.push(
    age != null && age > MAX_INVOICE_AGE_DAYS
      ? stop("age", "Recent invoice", `This invoice is more than ${MAX_INVOICE_AGE_DAYS} days old, so a person should check it before its prices are used.`)
      : pass("age", "Recent invoice"),
  );

  if (purpose === "apply") {
    let changeProblem: string | null = null;
    if (i.changePct == null) changeProblem = "There is no current price to compare with.";
    else if (!(Math.abs(round6(i.changePct)) < i.autoApplyPct)) {
      const p = Math.abs(round6(i.changePct));
      changeProblem = `${pctText(p)} change is ${p > i.autoApplyPct ? "over" : "at"} the ${limitText(i.autoApplyPct)} limit.`;
    }
    g.push(changeProblem ? stop("change", "Small change", changeProblem) : pass("change", "Small change"));
    g.push(i.learningMode ? stop("learning", "Learning mode off", "Learning mode: every price waits for a tap.") : pass("learning", "Learning mode off"));
    g.push(
      i.supplierAutoApply
        ? pass("supplier_trust", "Supplier trusted")
        : stop("supplier_trust", "Supplier trusted", "This supplier is not set to apply prices by itself yet."),
    );
  }
  return g;
}

export interface LineVerdict {
  decision: LineDecision;
  /** plain words; null when there is nothing to explain */
  reason: string | null;
  /** the guard that stopped it, when one did */
  failed: GuardResult | null;
  guards: GuardResult[];
}

export interface DecideInput extends GuardInput {
  /** every price target equals its current price (|new - old| < half a cent) */
  allSame: boolean;
}

/**
 * The decision for one line. Charges and credits decide nothing; an unmatched line waits for a match; a price that equals the
 * current one is "same" (confirmed) when the trust guards pass; anything else applies only when every guard passes.
 */
export function decideLine(i: DecideInput): LineVerdict {
  const none = (reason: string | null): LineVerdict => ({ decision: "none", reason, failed: null, guards: [] });
  if (i.lineClass !== "product") return none(null);
  if (i.duplicate) return none("This invoice is a copy of one already filed.");
  if (i.matchState === "ambiguous") return none("More than one product could match this line.");
  if (i.matchState !== "matched") return none("No product is matched to this line yet.");

  if (i.allSame && i.hasPrice) {
    const guards = evaluateGuards(i, "confirm");
    const failed = guards.find((x) => !x.ok) ?? null;
    return failed ? { decision: "none", reason: `The price matches, but it is not confirmed: ${failed.reason.charAt(0).toLowerCase()}${failed.reason.slice(1)}`, failed, guards } : { decision: "same", reason: null, failed: null, guards };
  }
  const guards = evaluateGuards(i, "apply");
  const failed = guards.find((x) => !x.ok) ?? null;
  return failed ? { decision: "needs_approval", reason: failed.reason, failed, guards } : { decision: "apply", reason: null, failed: null, guards };
}
