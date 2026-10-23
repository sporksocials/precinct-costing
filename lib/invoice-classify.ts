/**
 * Invoice line classes. The reader's own guess (class_hint) is the start; the editable charge rules (invoice_charge_rules) then say
 * what a delivery, fuel levy, deposit or discount line is and whether it is spread over the products. Nothing about delivery is
 * hard-coded here beyond a negative product line being a credit and a "discount" line being a discount: the rules are data.
 * Pure, no store.
 */
import type { InvoiceChargeRuleRow, LineClass } from "./invoice-types";
import { normCode } from "./invoice-names";

export interface ClassifyInput {
  description: string;
  item_code: string | null;
  class_hint: LineClass | null;
  /** line total ex GST (or null); only its sign is used */
  total_ex: number | null;
}

export interface Classified {
  line_class: LineClass;
  /** the rule that decided the class, if any */
  rule: InvoiceChargeRuleRow | null;
  /**
   * charge lines only: true = spread over the products, false = left out of cost, null = nobody has said yet
   * (the line is left out of the pool and the engine asks)
   */
  spread: boolean | null;
}

const CHARGE_CLASSES: LineClass[] = ["delivery", "fee", "discount", "deposit"];
export const isChargeClass = (c: LineClass) => CHARGE_CLASSES.includes(c);

/**
 * The charge rule for a line: active rules for this supplier or for every supplier, a case-insensitive "contains" on the description
 * or the item code. The supplier's own rules beat global ones, then the longer match text wins.
 */
export function findChargeRule(
  rules: InvoiceChargeRuleRow[],
  supplierId: string | null,
  description: string,
  itemCode: string | null,
): InvoiceChargeRuleRow | null {
  const hay = [description, itemCode ?? ""].map((s) => s.toLowerCase());
  const hits = rules.filter((r) => {
    if (!r.active) return false;
    if (r.supplier_id != null && r.supplier_id !== supplierId) return false;
    const needle = r.match_text.trim().toLowerCase();
    return needle !== "" && hay.some((h) => h.includes(needle));
  });
  hits.sort((a, b) => {
    const sa = a.supplier_id != null ? 1 : 0;
    const sb = b.supplier_id != null ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return b.match_text.trim().length - a.match_text.trim().length;
  });
  return hits[0] ?? null;
}

/** Work out a line's class (and whether a charge is spread) from the hint, the charge rules and the sign of the total. */
export function classifyLine(input: ClassifyInput, rules: InvoiceChargeRuleRow[], supplierId: string | null): Classified {
  let cls: LineClass = input.class_hint ?? "product";
  let spread: boolean | null = null;
  const rule = findChargeRule(rules, supplierId, input.description, input.item_code);

  if (rule) {
    cls = rule.line_class;
    spread = rule.spread;
  } else if (cls === "product" || cls === "other") {
    const startsWithDiscount = /^\s*discount\b/i.test(input.description);
    if (startsWithDiscount || normCode(input.item_code) === "ODISCOUNT") cls = "discount";
  }
  if (cls === "product" && input.total_ex != null && input.total_ex < 0) cls = "credit";

  // Only a charge class can be spread; a deposit with no rule is refundable, so it is simply left out.
  if (cls === "deposit" && spread == null) spread = false;
  if (!isChargeClass(cls)) spread = null;
  return { line_class: cls, rule, spread };
}
