/**
 * Invoice questions: the plain-words questions the engine raises for the venue managers (Mon and Matt) and Troy and Abbey. Each has
 * a prompt written for a person (no jargon, no dashes) and options with stable ids, so an answer can be recorded and replayed.
 * Pure, no store.
 */
import type { AnalyseIngredient, AnalysedQuestion, QuestionOption } from "./invoice-types";
import type { MatchTarget } from "./invoice-match";
import { dollars, limitText, pctText, plain, tidyLabel } from "./invoice-names";
import { plausibleFactors } from "./invoice-units";

const OPT = {
  ignoreLine: (): QuestionOption => ({ id: "ignore_line", label: "Ignore this line", action: "ignore_line" }),
  notAProduct: (): QuestionOption => ({ id: "not_a_product", label: "This is not a stock item", action: "not_a_product" }),
  reread: (): QuestionOption => ({ id: "reread", label: "Read the invoice again", action: "reread" }),
  ignoreDoc: (): QuestionOption => ({ id: "ignore_document", label: "Ignore this invoice", action: "ignore_document" }),
};

const targetName = (t: MatchTarget) => plain(t.ingredient?.name ?? t.product?.name ?? "Unnamed product");
const targetId = (t: MatchTarget) => `pick:${t.ingredient?.id ?? "none"}:${t.product?.id ?? "none"}`;
const targetOption = (t: MatchTarget): QuestionOption => ({
  id: targetId(t),
  label: targetName(t),
  ingredient_id: t.ingredient?.id ?? null,
  product_id: t.product?.id ?? null,
});

/** How the supplier introduces the line in a sentence: "Daniel Street Fish Market sent 'Kingfish fillets' (code 15026)". */
function sent(supplier: string, description: string, code: string | null): string {
  return `${supplier} sent '${plain(description)}'${code ? ` (code ${plain(code)})` : ""}`;
}

export function unmatchedQuestion(args: { supplier: string; lineNo: number; description: string; code: string | null; suggestions: MatchTarget[] }): AnalysedQuestion {
  return {
    kind: "unmatched_line",
    line_no: args.lineNo,
    prompt: `${sent(args.supplier, args.description, args.code)}. Which product is this?`,
    options: [...args.suggestions.map(targetOption), OPT.notAProduct(), OPT.ignoreLine()],
  };
}

export function ambiguousQuestion(args: { supplier: string; lineNo: number; description: string; code: string | null; candidates: MatchTarget[] }): AnalysedQuestion {
  return {
    kind: "ambiguous_match",
    line_no: args.lineNo,
    prompt: `${sent(args.supplier, args.description, args.code)}. It could be more than one product. Which one is it?`,
    options: [...args.candidates.map(targetOption), OPT.ignoreLine()],
  };
}

export function unitQuestion(args: { supplier: string; lineNo: number; description: string; unit: string | null; ingredient: AnalyseIngredient }): AnalysedQuestion {
  const unit = plain(args.unit) || "unit";
  const factors = plausibleFactors(args.description);
  return {
    kind: "unit_unclear",
    line_no: args.lineNo,
    prompt: `${args.supplier} sells '${plain(args.description)}' by the ${unit}. How many of ${plain(args.ingredient.name)} are in one ${unit}?`,
    options: [...factors.map((n): QuestionOption => ({ id: `packs:${n}`, label: `${n} per ${unit}`, packs_per_unit: n })), OPT.ignoreLine()],
  };
}

export function packConflictQuestion(args: { supplier: string; lineNo: number; description: string; unit: string | null; mapPacks: number; productPacks: number }): AnalysedQuestion {
  const unit = plain(args.unit) || "unit";
  const factors = Array.from(new Set([args.mapPacks, args.productPacks]));
  return {
    kind: "unit_unclear",
    line_no: args.lineNo,
    prompt: `For '${plain(args.description)}' from ${args.supplier}, a saved match says ${args.mapPacks} per ${unit} but the ordering list says ${args.productPacks}. Which is right?`,
    options: [...factors.map((n): QuestionOption => ({ id: `packs:${n}`, label: `${n} per ${unit}`, packs_per_unit: n })), OPT.ignoreLine()],
  };
}

export interface BigChangeArgs {
  lineNo: number;
  name: string;
  supplier: string;
  oldPrice: number | null;
  newPrice: number;
  /** "a pack, ex GST", "a carton, inc GST" */
  per: string;
  changePct: number | null;
  autoApplyPct: number;
}

export function bigChangeQuestion(a: BigChangeArgs): AnalysedQuestion {
  const prompt =
    a.oldPrice == null || !(a.oldPrice > 0) || a.changePct == null
      ? `We have no current price for ${plain(a.name)}. ${a.supplier} charges ${dollars(a.newPrice)} ${a.per}. Should we use it?`
      : `${plain(a.name)} from ${a.supplier} is ${dollars(a.newPrice)} ${a.per}, ${a.changePct >= 0 ? "up" : "down"} ${pctText(a.changePct)} from ${dollars(a.oldPrice)}. That is over our ${limitText(a.autoApplyPct)} limit. Is the new price right?`;
  return {
    kind: "big_change",
    line_no: a.lineNo,
    prompt,
    options: [
      { id: "approve_change", label: "Yes, use the new price", action: "approve_change" },
      { id: "reject_change", label: "No, keep the current price", action: "reject_change" },
    ],
  };
}

export function totalsQuestion(args: { supplier: string; invoiceNumber: string | null; problems: string[] }): AnalysedQuestion {
  const which = args.invoiceNumber ? `Invoice ${plain(args.invoiceNumber)}` : "An invoice";
  const why = args.problems.slice(0, 2).map((p) => plain(p).replace(/\.$/, "")).join(". ");
  return {
    kind: "totals_mismatch",
    line_no: null,
    prompt: `${which} from ${args.supplier} does not add up${why ? `. ${why}` : ""}. No prices change until it is checked.`,
    options: [OPT.reread(), OPT.ignoreDoc()],
  };
}

export function newSupplierQuestion(args: { name: string; abn: string | null; candidates: { id: string; name: string }[] }): AnalysedQuestion {
  if (args.candidates.length > 0) {
    return {
      kind: "new_supplier",
      line_no: null,
      prompt: `The invoice says ${plain(args.name)}, which could be more than one of our suppliers. Which one is it?`,
      options: [...args.candidates.map((c): QuestionOption => ({ id: `supplier:${c.id}`, label: plain(c.name) })), { id: "add_supplier", label: "None of them, add a new supplier" }, OPT.ignoreDoc()],
    };
  }
  return {
    kind: "new_supplier",
    line_no: null,
    prompt: `We have not seen ${plain(args.name)}${args.abn ? ` (ABN ${args.abn})` : ""} before. Is this a new supplier?`,
    options: [{ id: "add_supplier", label: "Yes, add them as a new supplier" }, OPT.ignoreDoc()],
  };
}

export function supplierAbnQuestion(args: { name: string; readAbn: string; knownAbn: string }): AnalysedQuestion {
  return {
    kind: "new_supplier",
    line_no: null,
    prompt: `The invoice says ${plain(args.name)} with ABN ${args.readAbn}, but we have that supplier with ABN ${args.knownAbn}. Is it the same supplier?`,
    options: [
      { id: "same_supplier", label: "Yes, it is the same supplier" },
      { id: "add_supplier", label: "No, add a new supplier" },
      OPT.ignoreDoc(),
    ],
  };
}

export function unreadableSupplierQuestion(invoiceNumber: string | null): AnalysedQuestion {
  return {
    kind: "new_supplier",
    line_no: null,
    prompt: `We could not read which supplier sent ${invoiceNumber ? `invoice ${plain(invoiceNumber)}` : "this invoice"}. Please check the scan.`,
    options: [OPT.reread(), OPT.ignoreDoc()],
  };
}

export function creditQuestion(args: { lineNo: number; productDescription: string; creditEx: number; unit: string | null }): AnalysedQuestion {
  const unit = plain(args.unit).toLowerCase();
  const per = unit === "kg" ? "kilos" : unit === "" ? "units" : unit;
  return {
    kind: "credit_unclear",
    line_no: args.lineNo,
    prompt: `The ${tidyLabel(args.productDescription)} line was credited ${dollars(Math.abs(args.creditEx))}. How many ${per} were credited?`,
    options: [{ id: "credit_leave", label: "Not sure. Leave the cost per unit blank for this line" }],
  };
}

export function unattachedCreditQuestion(args: { lineNo: number; description: string; creditEx: number }): AnalysedQuestion {
  return {
    kind: "credit_unclear",
    line_no: args.lineNo,
    prompt: `The invoice has a credit of ${dollars(Math.abs(args.creditEx))} ('${plain(args.description)}'), but we cannot tell which product it was for.`,
    options: [{ id: "credit_leave", label: "Leave it. It does not change any cost" }],
  };
}

export function chargeQuestion(args: { supplier: string; lineNo: number; description: string; totalEx: number }): AnalysedQuestion {
  return {
    kind: "other",
    line_no: args.lineNo,
    prompt: `${args.supplier} charged ${dollars(args.totalEx)} for '${plain(args.description)}'. Should that be spread over the products as part of their cost?`,
    options: [
      { id: "spread_charge", label: "Yes, spread it over the products" },
      { id: "leave_out_charge", label: "No, leave it out of cost", action: "not_a_product" },
    ],
  };
}

export function gstQuestion(args: { supplier: string; lineNo: number; description: string }): AnalysedQuestion {
  return {
    kind: "other",
    line_no: args.lineNo,
    prompt: `The price for '${plain(args.description)}' from ${args.supplier} does not say whether GST is included. Please check the scan.`,
    options: [OPT.reread(), OPT.ignoreLine()],
  };
}

export function poolQuestion(args: { supplier: string; poolEx: number }): AnalysedQuestion {
  return {
    kind: "other",
    line_no: null,
    prompt: `${args.supplier} charged ${dollars(args.poolEx)} in delivery and fees, but there is no product on the invoice to spread it over.`,
    options: [OPT.ignoreDoc()],
  };
}
