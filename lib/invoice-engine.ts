/**
 * The invoice engine: one read invoice in, one analysis out. Pure (same input, same output; no clock, no network, no store), so it
 * can run in the browser, on the server and in tests. It decides nothing about the database: it says what each line IS and what
 * should happen to its price, and why.
 *
 *   1  supplier, venue check (informational), duplicate                     (invoice-match)
 *   2  ex GST amounts, line classes, charge rules             (invoice-recon, invoice-classify)
 *   3  match each product line, unit and pack conversion      (invoice-match, invoice-units)
 *   4  reconciliation: does the invoice add up?               (invoice-recon)
 *   5  landed cost: fees and discounts spread over products   (invoice-landed)
 *   6  new prices against the app's prices, then the decision (invoice-guards)
 *   7  the questions people need to answer                    (invoice-questions)
 *
 * Safety first: where the rules are silent the line waits for a person. Fuzzy names only ever become suggestions in a question.
 */
import type { AnalyseInvoice } from "./invoice-interfaces";
import type {
  AnalyseContext,
  AnalysedLine,
  AnalysedQuestion,
  DocStatus,
  ExtractedInvoice,
  ExtractedLine,
  InvoiceAnalysis,
  ReconNote,
} from "./invoice-types";
import { baseUnitFor, baseQuantity, resolvePacks, type PackResolution } from "./invoice-units";
import { documentPriceBasis, isNotSupplied, lineAmounts, reconcile, settleGst, type LineAmounts, type ReconLine } from "./invoice-recon";
import { classifyLine, isChargeClass, type Classified } from "./invoice-classify";
import { buildMatcher, checkVenue, findDuplicate, matchSupplier, type LineMatch } from "./invoice-match";
import { allocateLanded, attachDiscounts, type LandedLineResult, type LandedProduct, type LandedCredit } from "./invoice-landed";
import { decideLine, isSamePrice, type DecideInput, type LineVerdict } from "./invoice-guards";
import { abnDigits, plain, round4, round6, tidyLabel, tidySupplierName } from "./invoice-names";
import {
  ambiguousQuestion,
  bigChangeQuestion,
  chargeQuestion,
  creditQuestion,
  gstQuestion,
  newSupplierQuestion,
  packConflictQuestion,
  poolQuestion,
  supplierAbnQuestion,
  totalsQuestion,
  unattachedCreditQuestion,
  unitQuestion,
  unmatchedQuestion,
  unreadableSupplierQuestion,
} from "./invoice-questions";

interface Work {
  i: number;
  line: ExtractedLine;
  amounts: LineAmounts;
  cls: Classified;
  mathOk: boolean | null;
  match: LineMatch | null;
  pack: PackResolution | null;
  baseQty: number | null;
  baseUnit: string | null;
  /** the line was not supplied (ordered, not delivered): not a product on this invoice, left out of every check */
  skip: boolean;
  /**
   * The discount printed on (or inferred for) the line itself, in dollars ex GST: qty x list price less the net line total. The
   * line total is already NET of it; landed cost and the discount columns add it back as gross and as a discount.
   */
  printedDiscEx: number;
}

/** One price the invoice would set: the ingredient's pack price, or the ordering product's price. */
interface TargetPrice {
  kind: "ingredient" | "ordering_product";
  old: number | null;
  /** unrounded, used to compare */
  raw: number;
  /** rounded to 4 dp, used to store */
  stored: number;
  pct: number | null;
  same: boolean;
}

const mkTarget = (kind: TargetPrice["kind"], old: number | null, raw: number): TargetPrice => {
  const o = old != null && Number.isFinite(old) && old > 0 ? old : null;
  return { kind, old: o, raw, stored: round4(raw), pct: o != null ? (raw - o) / o : null, same: o != null && isSamePrice(raw, o) };
};

interface Targets {
  ing: TargetPrice | null;
  prod: TargetPrice | null;
  list: TargetPrice[];
  problem: string | null;
}

/** What the invoice price means for the ingredient's pack price and the ordering product's price. Null targets when it cannot be said. */
function priceTargets(w: Work, gstRate: number): Targets {
  const none = (problem: string): Targets => ({ ing: null, prod: null, list: [], problem });
  const m = w.match;
  const pack = w.pack;
  if (!m || m.state !== "matched" || !pack) return none("No product is matched to this line yet.");
  const up = w.amounts.unit_price_ex;
  if (up == null) return none(!w.amounts.convertible ? "GST is unclear on this line, so its price cannot be read." : "No unit price was read for this line.");
  if (!(up > 0)) return none("The unit price on this line is zero.");

  const gst = w.line.gst;
  const withGst = (v: number): number | null => (gst === "taxable" ? v * (1 + gstRate) : gst === "free" ? v : null);
  let problem: string | null = null;
  let ing: TargetPrice | null = null;
  let prod: TargetPrice | null = null;

  if (m.ingredient && pack.packs != null && pack.packs > 0) {
    const perPack = up / pack.packs;
    const needsInc = m.ingredient.price_inc_gst && !m.ingredient.gst_free;
    const v = needsInc ? withGst(perPack) : perPack;
    if (v == null) problem = "GST is unclear on this line, so the price including GST cannot be worked out.";
    else ing = mkTarget("ingredient", m.ingredient.pack_price, v);
  }
  if (m.product && pack.productUnitMatches) {
    const v = withGst(up);
    if (v == null) problem = "GST is unclear on this line, so the price including GST cannot be worked out.";
    else prod = mkTarget("ordering_product", m.product.price_inc_gst, v);
  }
  const list = [ing, prod].filter((t): t is TargetPrice => t != null);
  return { ing, prod, list, problem: list.length === 0 ? problem ?? "No price could be worked out for this line." : null };
}

const hasProductDeal = (p: { deal_buy_qty: number | null; deal_free_qty: number | null } | null) =>
  !!p && ((p.deal_buy_qty ?? 0) > 0 || (p.deal_free_qty ?? 0) > 0);

const printed = (l: ExtractedLine) => l.unit_price != null || l.line_total != null;

/** A line of a document that is not an invoice (statement, blank page, delivery docket): shown, never priced. */
function passiveLine(w: Work, extracted: ExtractedInvoice, ctx: AnalyseContext): AnalysedLine {
  const l = w.line;
  return {
    source_index: w.i, venue_id: ctx.venueId, invoice_date: extracted.invoice_date, line_no: l.line_no, page: l.page ?? null,
    line_class: "other", item_code: l.item_code, description: l.description, qty: l.qty, unit: l.unit,
    unit_price_ex: w.amounts.unit_price_ex, line_total_ex: w.amounts.line_total_ex, gst: l.gst, gst_amount: w.amounts.gst_amount,
    math_ok: null, match_state: "ignored", match_method: null, map_id: null, ingredient_id: null, product_id: null,
    packs_per_unit: null, base_qty: null, base_unit: null, fee_share_ex: 0, landed_total_ex: null, landed_unit_ex: null, landed_base_ex: null,
    old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null, change_pct: null,
    decision: "none", decision_reason: null, state: "open",
  };
}

/**
 * Optional answers a person already gave, for a caller that re-analyses a document after a question was answered. Pass them as
 * extra properties on the context. Absent means "not confirmed", which is the safe default.
 */
export interface AnalyseConfirmations {
  /** kept so old callers compile: the venue is no longer a check, so nothing reads this */
  venueConfirmed?: boolean;
  /** a person said the supplier with a different ABN is the same supplier */
  supplierConfirmed?: boolean;
  /**
   * The caller already read this document a second time because the first reading did not add up. The second reading may be
   * different but is not independent evidence, so a person must check the numbers: the invoice counts as not reconciled.
   */
  hintedReread?: boolean;
}

export const analyseInvoice: AnalyseInvoice = (extracted: ExtractedInvoice, ctx0: AnalyseContext): InvoiceAnalysis => {
  const ctx = ctx0 as AnalyseContext & AnalyseConfirmations;
  const mode: "learning" | "auto" = ctx.settings.learningMode ? "learning" : "auto";

  // ---------------------------------------------------------------- 1 supplier, venue, duplicate
  const sm = matchSupplier(extracted, ctx.suppliers);
  const supplier = sm.supplier;
  const supplierId = supplier?.id ?? null;
  // the supplier's short trading name: letterhead text such as "(a division of ...)" or an ABN never becomes part of a name
  const readName = tidySupplierName(extracted.supplier_name);
  const supplierLabel = plain(supplier?.name) || readName || "The supplier";
  // informational only (stored on the document, nothing reads it to block): the venue is attributed before the analysis, from the
  // invoice's own bill-to and ship-to, and prices are shared across venues, so which venue it is for never stops or asks anything
  const venue = checkVenue(extracted, ctx.venueNames, ctx.venueId);
  const duplicateOf = supplier ? findDuplicate(extracted.invoice_number, supplierId, ctx.existingDocs, extracted.invoice_date, extracted.total_inc) : null;
  const isDuplicate = duplicateOf != null;
  const invoiceLike = extracted.doc_type === "invoice" || extracted.doc_type === "credit_note";

  // ---------------------------------------------------------------- 2 amounts and classes
  // GST that the invoice itself settles: a printed GST total of 0.00 makes every line GST free; a discount or credit line with no GST
  // status takes the status of the product it belongs to (see settleGst)
  const settledLines = settleGst(extracted.lines, extracted);
  const work: Work[] = settledLines.map((line, i) => {
    const amounts = lineAmounts(line, ctx.gstRate);
    let cls = classifyLine(
      { description: line.description, item_code: line.item_code, class_hint: line.class_hint, total_ex: amounts.line_total_ex },
      ctx.chargeRules,
      supplierId,
    );
    if (extracted.doc_type === "credit_note" && cls.line_class === "product") cls = { ...cls, line_class: "credit" };
    const skip = cls.line_class === "product" && isNotSupplied(line);
    return { i, line, amounts, cls, mathOk: null, match: null, pack: null, baseQty: null, baseUnit: null, skip, printedDiscEx: 0 };
  });

  const priceBasis = documentPriceBasis(extracted.lines);

  // Documents that are not invoices carry no prices: show their lines, decide nothing.
  if (!invoiceLike) {
    return {
      supplier_id: supplierId, new_supplier: null, venue_check: venue.check, price_basis: priceBasis, reconciled: false, recon_notes: [],
      fee_pool_ex: 0, lines: work.map((w) => passiveLine(w, extracted, ctx)), questions: [], duplicate_of: null, mode, status: "nothing_to_apply",
      summary: { products: 0, matched: 0, same: 0, to_apply: 0, need_approval: 0, unmatched: 0 },
    };
  }

  // ---------------------------------------------------------------- 3 matching and units
  const matcher = buildMatcher(ctx, supplier, extracted.supplier_name);
  for (const w of work) {
    if (w.cls.line_class !== "product" || w.skip) continue;
    w.match = matcher.match({ item_code: w.line.item_code, description: w.line.description });
    if (w.match.state === "matched") {
      w.pack = resolvePacks({ mapPacks: w.match.mapPacks, product: w.match.product, ingredient: w.match.ingredient, invoiceUnit: w.line.unit });
      if (w.match.ingredient) {
        w.baseUnit = baseUnitFor(w.match.ingredient.pack_unit);
        w.baseQty = baseQuantity(w.line.qty, w.pack.packs, w.match.ingredient);
      }
    }
  }

  // ---------------------------------------------------------------- 4 reconciliation
  const reconLines: ReconLine[] = work.map((w) => ({
    index: w.i, line_class: w.cls.line_class, description: w.line.description, qty: w.line.qty, unit_price: w.line.unit_price,
    line_total: w.line.line_total, basis: w.line.basis, gst: w.line.gst, amounts: w.amounts,
    total_basis: w.line.total_basis, discount_pct: w.line.discount_pct, discount_amount: w.line.discount_amount, skip: w.skip,
  }));
  const recon = reconcile({ lines: reconLines, gstRate: ctx.gstRate, subtotal_ex: extracted.subtotal_ex, gst_total: extracted.gst_total, total_inc: extracted.total_inc });
  for (const w of work) w.mathOk = recon.mathOk.get(w.i) ?? null;
  // a line that only added up under an inference the invoice's own totals confirmed (an Amount that includes GST, an unlabelled
  // clean-percent discount) is read that way from here on
  for (const [idx, inf] of recon.inferred) {
    const w = work[idx];
    w.line = { ...w.line, ...inf.patch };
    w.amounts = lineAmounts(w.line, ctx.gstRate);
  }
  // the discount printed (or inferred) on a line: list price x qty less the net total
  for (const w of work) {
    const declared = (w.line.discount_pct ?? 0) !== 0 || (w.line.discount_amount ?? 0) !== 0;
    const unit = w.amounts.unit_price_ex;
    const net = w.amounts.line_total_ex;
    if (!declared || w.mathOk !== true || w.skip || w.line.qty == null || unit == null || net == null) continue;
    const d = round4(w.line.qty * unit - net);
    w.printedDiscEx = d >= 0.005 ? d : 0;
  }
  const reread = ctx.hintedReread === true;
  const reconciled = recon.reconciled && !reread;
  const rereadNote: ReconNote | null = reread
    ? { check: "other", ok: false, message: "This invoice was read twice because the first reading did not add up. A person needs to check the numbers before any price is used." }
    : null;

  // ---------------------------------------------------------------- 5 landed cost
  const products = work.filter((w) => w.cls.line_class === "product" && !w.skip);

  // A negative line that shares a product's item code (or its description once "discount" words are dropped) is a standing supplier
  // DISCOUNT on that product, not a goods credit, unless it plainly returns goods (see isGoodsReturn). It is netted off the product
  // line's value, never enters the fee pool and never raises the "how many were credited" question.
  const discountCandidates = extracted.doc_type === "credit_note"
    ? []
    : work.filter((w) => (w.cls.line_class === "credit" || w.cls.line_class === "discount") && w.amounts.line_total_ex != null && w.amounts.line_total_ex < 0);
  const discountAttach = attachDiscounts(
    products.map((w) => ({ index: w.i, itemCode: w.line.item_code, description: w.line.description, unitPriceEx: w.amounts.unit_price_ex })),
    discountCandidates.map((w) => ({ index: w.i, itemCode: w.line.item_code, description: w.line.description, qty: w.line.qty, unitPriceEx: w.amounts.unit_price_ex, totalEx: w.amounts.line_total_ex })),
  );
  const discountOfProduct = new Map<number, number>(); // product line index to the dollars (ex GST, positive) taken off it
  const discountLine = new Map<number, number>(); // discount line index to the product line index it was taken off
  for (const w of discountCandidates) {
    const pi = discountAttach.get(w.i);
    if (pi == null) continue;
    w.cls = { line_class: "discount", rule: null, spread: false };
    discountLine.set(w.i, pi);
    discountOfProduct.set(pi, (discountOfProduct.get(pi) ?? 0) + Math.abs(w.amounts.line_total_ex as number));
  }

  const credits = work.filter((w) => w.cls.line_class === "credit");
  const landedProducts: LandedProduct[] = products.map((w) => ({
    index: w.i, itemCode: w.line.item_code, description: w.line.description, unit: w.line.unit, qty: w.line.qty, baseQty: w.baseQty,
    // gross of a discount printed on the line itself, so the spread weights and the landed total use the NET value (gross less discounts)
    totalEx: w.amounts.line_total_ex == null ? null : round4(w.amounts.line_total_ex + w.printedDiscEx),
    discountEx: round4((discountOfProduct.get(w.i) ?? 0) + w.printedDiscEx),
  }));
  const landedCredits: LandedCredit[] = credits.map((w) => ({
    index: w.i, itemCode: w.line.item_code, description: w.line.description, unit: w.line.unit, qty: w.line.qty, totalEx: w.amounts.line_total_ex,
  }));
  const poolEx = work
    .filter((w) => ["delivery", "fee", "discount"].includes(w.cls.line_class) && w.cls.spread === true && w.amounts.line_total_ex != null)
    .reduce((s, w) => s + (w.amounts.line_total_ex as number), 0);
  const landed = allocateLanded({ products: landedProducts, credits: landedCredits, poolEx, basis: supplier?.allocation_basis ?? "value" });

  // ---------------------------------------------------------------- 6 and 7 decisions, lines, questions
  const docQuestions: AnalysedQuestion[] = [];
  const lineQuestions: AnalysedQuestion[] = [];
  const outLines: AnalysedLine[] = [];
  const supplierSure = sm.status === "matched" || (sm.status === "abn_mismatch" && ctx.supplierConfirmed === true);

  for (const w of work) {
    const l = w.line;
    const cls = w.cls.line_class;
    const base = {
      source_index: w.i, venue_id: ctx.venueId, invoice_date: extracted.invoice_date, line_no: l.line_no, page: l.page ?? null,
      line_class: cls, item_code: l.item_code, description: l.description, qty: l.qty, unit: l.unit,
      unit_price_ex: w.amounts.unit_price_ex, line_total_ex: w.amounts.line_total_ex, gst: l.gst, gst_amount: w.amounts.gst_amount,
      math_ok: cls === "product" ? w.mathOk : null,
    };
    const blank = {
      match_state: "ignored" as const, match_method: null, map_id: null, ingredient_id: null, product_id: null, packs_per_unit: null,
      base_qty: null, base_unit: null, fee_share_ex: 0, landed_total_ex: null, landed_unit_ex: null, landed_base_ex: null,
      old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null, change_pct: null,
      decision: "none" as const, decision_reason: null, state: "open" as const,
    };

    if (!w.amounts.convertible) lineQuestions.push(gstQuestion({ supplier: supplierLabel, lineNo: l.line_no, description: l.description }));

    // ----- charges, credits and other non-product lines
    if (cls !== "product") {
      const total = w.amounts.line_total_ex;
      const takenOffProduct = discountLine.get(w.i);
      if (takenOffProduct != null) {
        // a standing discount on a product: no charge question, no credit question, nothing to spread
        outLines.push({ ...base, ...blank, decision_reason: `Taken off the price of ${tidyLabel(work[takenOffProduct].line.description)}.` });
        continue;
      }
      const unknownCharge =
        (isChargeClass(cls) && cls !== "deposit" && w.cls.rule == null) || (cls === "other" && w.cls.rule == null);
      if (unknownCharge && total != null && Math.abs(total) > 0.004) {
        lineQuestions.push(chargeQuestion({ supplier: supplierLabel, lineNo: l.line_no, description: l.description, totalEx: total }));
      }
      if (cls === "credit" && extracted.doc_type !== "credit_note" && landed.attach.get(w.i) == null && total != null && Math.abs(total) > 0.004) {
        lineQuestions.push(unattachedCreditQuestion({ lineNo: l.line_no, description: l.description, creditEx: total }));
      }
      outLines.push({ ...base, ...blank });
      continue;
    }

    // ----- product lines
    const m = w.match as LineMatch;
    const lr: LandedLineResult | undefined = landed.lines.get(w.i);
    const landedFields = {
      fee_share_ex: lr ? lr.feeShareEx : 0,
      landed_total_ex: lr?.landedTotalEx ?? null,
      landed_unit_ex: lr?.landedUnitEx ?? null,
      landed_base_ex: lr?.landedBaseEx ?? null,
    };
    if (lr && lr.creditQtyUnknown && extracted.doc_type !== "credit_note") {
      lineQuestions.push(creditQuestion({ lineNo: l.line_no, productDescription: l.description, creditEx: lr.creditEx, unit: l.unit }));
    }

    // the supplier discount taken off this line (positive dollars ex GST), as the three columns the screens read
    // = a same-code negative line (taken off the gross line) plus any discount printed on the line itself (the total is already net)
    const discEx = (discountOfProduct.get(w.i) ?? 0) + w.printedDiscEx;
    const grossEx = w.amounts.line_total_ex == null ? null : w.amounts.line_total_ex + w.printedDiscEx;
    const discountFields = discEx > 0.004
      ? {
          line_discount_ex: round4(discEx),
          ...(grossEx != null && grossEx > 0 ? { discount_pct: round6(discEx / grossEx) } : {}),
          ...(w.baseQty != null && w.baseQty > 0 ? { discount_per_base: round4(discEx / w.baseQty) } : {}),
        }
      : {};

    if (w.skip) {
      // ordered but not delivered: not a product on this invoice, so no match, no question and no price
      outLines.push({ ...base, ...blank, decision_reason: "Not supplied on this invoice." });
      continue;
    }

    if (m.state === "ignored") {
      // a person already said this is not a stock item: no match, no question, no price
      outLines.push({
        ...base, ...blank, ...landedFields, ...discountFields, match_state: "ignored",
        decision: "none", decision_reason: "A person said this is not a stock item.",
      });
      continue;
    }

    if (m.state !== "matched") {
      if (m.state === "ambiguous") lineQuestions.push(ambiguousQuestion({ supplier: supplierLabel, lineNo: l.line_no, description: l.description, code: l.item_code, candidates: m.options }));
      else lineQuestions.push(unmatchedQuestion({ supplier: supplierLabel, lineNo: l.line_no, description: l.description, code: l.item_code, suggestions: m.options }));
      outLines.push({
        ...base, ...blank, ...landedFields, ...discountFields, match_state: m.state,
        decision: "none", decision_reason: m.state === "ambiguous" ? "More than one product could match this line." : "No product is matched to this line yet.",
      });
      continue;
    }

    const pack = w.pack as PackResolution;
    const targets = priceTargets(w, ctx.gstRate);
    const ingredient = m.ingredient;
    const product = m.product;

    // unit problems that need a human
    let unitsProblem: string | null = null;
    if (pack.conflict) {
      unitsProblem = `A saved match says ${pack.conflict.mapPacks} per ${plain(l.unit) || "unit"} but the ordering list says ${pack.conflict.productPacks}.`;
      lineQuestions.push(packConflictQuestion({ supplier: supplierLabel, lineNo: l.line_no, description: l.description, unit: l.unit, mapPacks: pack.conflict.mapPacks, productPacks: pack.conflict.productPacks }));
    } else if (ingredient && pack.packs == null) {
      lineQuestions.push(unitQuestion({ supplier: supplierLabel, lineNo: l.line_no, description: l.description, unit: l.unit, ingredient }));
    } else if (!ingredient && product && !pack.productUnitMatches) {
      unitsProblem = `The invoice unit ${plain(l.unit) || "(none)"} is not the ordering unit (${plain(product.unit_name)}).`;
    }

    const pcts = targets.list.map((t) => t.pct);
    const changePct = targets.list.length === 0 || pcts.some((p) => p == null) ? null : Math.max(...pcts.map((p) => Math.abs(p as number)));
    const input: DecideInput = {
      duplicate: isDuplicate,
      supplierKnown: supplierSure,
      reconciled,
      lineClass: cls,
      mathOk: w.mathOk,
      matchState: m.state,
      matchMethod: m.method,
      costedSupplierOk: !ingredient || (ingredient.supplier_id != null && supplier?.cost_supplier_id != null && ingredient.supplier_id === supplier.cost_supplier_id),
      // an ingredient with no stated pack count waits for an answer even when an ordering price could be read
      unitsKnown: ingredient ? pack.packs != null && targets.list.length > 0 : targets.list.length > 0,
      unitsProblem,
      hasPrice: targets.list.length > 0,
      priceProblem: targets.problem,
      qty: l.qty,
      isCredit: (l.qty ?? 0) < 0 || (w.amounts.unit_price_ex ?? 0) < 0,
      creditAttachedEx: lr ? lr.creditEx : 0,
      hasDeal: !!ingredient?.has_deal || hasProductDeal(product),
      invoiceDate: extracted.invoice_date,
      lastPriceUpdate: ingredient?.last_price_update ?? null,
      today: ctx.today,
      changePct,
      autoApplyPct: ctx.settings.autoApplyPct,
      learningMode: ctx.settings.learningMode,
      supplierAutoApply: !!supplier?.auto_apply,
      allSame: targets.list.length > 0 && targets.list.every((t) => t.same),
    };
    const verdict: LineVerdict = decideLine(input);

    if (verdict.failed?.id === "change" && !isDuplicate) {
      const worst = targets.list.find((t) => t.pct == null) ?? [...targets.list].sort((a, b) => Math.abs(b.pct as number) - Math.abs(a.pct as number))[0];
      if (worst) {
        const ingTarget = worst.kind === "ingredient" ? ingredient : null;
        const name = ingTarget ? ingTarget.name : product?.name ?? ingredient?.name ?? l.description;
        const per = ingTarget
          ? `a pack, ${ingTarget.price_inc_gst && !ingTarget.gst_free ? "inc" : "ex"} GST`
          : `a ${plain(product?.unit_name).toLowerCase() || "unit"}, inc GST`;
        lineQuestions.push(bigChangeQuestion({ lineNo: l.line_no, name, supplier: supplierLabel, oldPrice: worst.old, newPrice: worst.stored, per, changePct: worst.pct, autoApplyPct: ctx.settings.autoApplyPct }));
      }
    }

    const primary = targets.ing ?? targets.prod;
    outLines.push({
      ...base, ...landedFields, ...discountFields,
      match_state: "matched", match_method: m.method, map_id: m.mapId,
      ingredient_id: ingredient?.id ?? null, product_id: product?.id ?? null,
      packs_per_unit: pack.packs, base_qty: w.baseQty, base_unit: w.baseUnit,
      old_pack_price: ingredient ? ingredient.pack_price : null, new_pack_price: targets.ing ? targets.ing.stored : null,
      old_product_price: product ? product.price_inc_gst : null, new_product_price: targets.prod ? targets.prod.stored : null,
      change_pct: primary && primary.pct != null ? round6(primary.pct) : null,
      decision: verdict.decision, decision_reason: verdict.reason, state: "open",
    });
  }

  // ----- document level questions
  if (!isDuplicate) {
    // A brand new supplier is added quietly (Troy, 25 Oct 2026: he can rename it in Settings > Invoices), so "new" asks nothing. Only a
    // name that fits several suppliers, or the same name with a different ABN, still needs a person.
    if (sm.status === "ambiguous") docQuestions.push(newSupplierQuestion({ name: readName, abn: null, candidates: sm.candidates.map((c) => ({ id: c.id, name: c.name })) }));
    else if (sm.status === "abn_mismatch" && supplier && !supplierSure) docQuestions.push(supplierAbnQuestion({ name: supplier.name, readAbn: plain(extracted.supplier_abn), knownAbn: plain(supplier.abn) }));
    else if (sm.status === "unreadable") docQuestions.push(unreadableSupplierQuestion(extracted.invoice_number));

    if (!reconciled) {
      docQuestions.push(totalsQuestion({ supplier: supplierLabel, invoiceNumber: extracted.invoice_number, problems: [...recon.notes, ...(rereadNote ? [rereadNote] : [])].filter((n) => !n.ok).map((n) => n.message) }));
    }
    if (landed.poolCents !== 0 && !landed.allocated) docQuestions.push(poolQuestion({ supplier: supplierLabel, poolEx: landed.poolEx }));
  }

  // ----- duplicates keep their lines for display but decide nothing and ask nothing
  if (isDuplicate) {
    for (const ln of outLines) {
      ln.decision = "none";
      ln.decision_reason = "This invoice is a copy of one already filed.";
    }
  }

  const reconNotes: ReconNote[] = [...recon.notes, ...(rereadNote ? [rereadNote] : [])];
  if (isDuplicate) reconNotes.push({ check: "duplicate", ok: false, message: "This invoice is already filed for this supplier." });

  // ----- status and summary
  const productLines = outLines.filter((l) => l.line_class === "product");
  const questions = isDuplicate ? [] : [...docQuestions, ...lineQuestions];
  const count = (f: (l: AnalysedLine) => boolean) => productLines.filter(f).length;
  const summary = {
    products: productLines.length,
    matched: count((l) => l.match_state === "matched"),
    same: count((l) => l.decision === "same"),
    to_apply: count((l) => l.decision === "apply"),
    need_approval: count((l) => l.decision === "needs_approval"),
    unmatched: count((l) => l.match_state === "unmatched" || l.match_state === "ambiguous"),
  };
  let status: DocStatus;
  if (isDuplicate) status = "duplicate";
  else if (summary.need_approval > 0 || summary.unmatched > 0 || questions.length > 0 || summary.to_apply > 0) status = "needs_review";
  else status = "nothing_to_apply";

  return {
    supplier_id: supplierId,
    new_supplier: sm.status === "new" ? { name: readName || `Supplier ${plain(extracted.supplier_abn)}`, abn: abnDigits(extracted.supplier_abn) } : null,
    venue_check: venue.check,
    price_basis: priceBasis,
    reconciled,
    recon_notes: reconNotes,
    fee_pool_ex: landed.poolEx,
    lines: outLines,
    questions,
    duplicate_of: duplicateOf,
    mode,
    status,
    summary,
  };
};
