"use client";

import Link from "next/link";
import { BadgePercent } from "lucide-react";
import { money, packLabel } from "@/lib/format";
import { brisbaneStamp } from "@/lib/ordering-orders-ui";
import { approveLabel, canApprove, canSkip, chargeTreatment, CLASS_WORD, lineStatus, priceCompares, qtyPriceText } from "@/lib/invoice-view";
import { lineDiscountText, lineNetPerBase, perUnitText } from "@/lib/invoice-discounts";
import type { InvoiceChargeRuleRow, InvoiceDocumentRow, InvoiceLineRow, InvoicePriceChangeRow } from "@/lib/invoice-types";
import type { Ingredient } from "@/lib/types";
import { TouchButton } from "@/components/ordering/touch";
import { StatusLabel } from "./inv-parts";

export interface LineHandlers {
  onApprove: (l: InvoiceLineRow) => void;
  onSkip: (l: InvoiceLineRow) => void;
  onUnskip: (l: InvoiceLineRow) => void;
  onUndo: (c: InvoicePriceChangeRow) => void;
  busyId: string | null;
}

/**
 * One product line, quietly: what the invoice called it and what it cost, what it is in the app (with the app's price now), and ONE plain
 * status. Landed cost, the reasons and the other technical detail live under the page's Details. A line that needs matching links to its
 * supplier's Match Items screen.
 */
export function InvLine({
  line,
  ingredient,
  productName,
  venueSlug,
  matchHref,
  changes,
  nameOf,
  h,
}: {
  line: InvoiceLineRow;
  ingredient: Ingredient | null;
  productName: string | null;
  venueSlug: string | null;
  /** the supplier's Match Items screen, when the invoice has a supplier */
  matchHref: string | null;
  changes: InvoicePriceChangeRow[];
  nameOf: (email: string | null | undefined) => string | null;
  h: LineHandlers;
}) {
  const status = lineStatus(line);
  const busy = h.busyId === line.id;
  const compare = priceCompares(line)[0] ?? null;
  const discount = lineDiscountText(line);
  const netPerBase = lineNetPerBase(line);
  const qtyText = qtyPriceText(line);
  const appPrice = compare?.now ?? null;
  return (
    <li className="px-4 py-3.5">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold leading-snug">{line.description}</p>
          <p className="mt-0.5 text-[15px] text-label-2 sm:text-[13px]">
            {[line.item_code ? `Code ${line.item_code}` : null, qtyText || null, line.line_total_ex != null ? `${money(line.line_total_ex)} ex GST` : null].filter(Boolean).join(" · ")}
          </p>
          {discount ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium text-label sm:text-[13px]">
              <BadgePercent aria-hidden className="h-4 w-4 shrink-0 text-label-2" strokeWidth={2.5} />
              <span>{discount}</span>
              {netPerBase != null ? <span className="text-label-2">{`Net ${perUnitText(netPerBase, line.base_unit)}`}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 text-[15px] sm:text-[13px]">
          <p className="text-[13px] text-label-3">In the app as</p>
          {line.ingredient_id && ingredient ? (
            <Link href={`/ingredients/${ingredient.id}`} className="inline-flex min-h-[44px] flex-wrap items-center gap-x-2 font-medium text-accent">
              <span>{ingredient.name}</span>
              {appPrice != null ? <span className="font-normal text-label-2">{`${money(appPrice)} per ${packLabel(ingredient.pack_size, ingredient.pack_unit)}`}</span> : null}
            </Link>
          ) : line.product_id && productName ? (
            venueSlug ? (
              <Link href={`/ordering/${venueSlug}/setup/products/${line.product_id}`} className="inline-flex min-h-[44px] items-center font-medium text-accent">
                {productName}
              </Link>
            ) : (
              <span className="inline-flex min-h-[44px] items-center font-medium">{productName}</span>
            )
          ) : (
            <p className="inline-flex min-h-[44px] items-center text-label-2">{status.kind !== "needs_matching" ? "Not in the app" : matchHref ? <Link href={matchHref} className="inline-flex min-h-[44px] items-center font-medium text-accent">Match this item</Link> : "Not matched yet"}</p>
          )}
          <p>
            <StatusLabel view={status} />
          </p>
        </div>
      </div>

      {changes.map((c) => (
        <div key={c.id} className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-1.5">
          <p className="min-w-0 text-[15px] text-label-2 sm:text-[13px]">
            {c.kind === "price_confirmed" ? `Price confirmed at ${money(c.new_price)}` : `Price ${c.status === "reverted" ? "was set to" : "set to"} ${money(c.new_price)} from ${money(c.old_price)}`}
            {". "}
            {c.status === "reverted" ? `Put back${c.reverted_by ? ` by ${nameOf(c.reverted_by) ?? c.reverted_by}` : ""}.` : `${c.mode === "auto" ? "Applied automatically" : `Approved by ${nameOf(c.applied_by) ?? "someone"}`}, ${brisbaneStamp(c.applied_at)}.`}
          </p>
          {c.status === "applied" ? (
            <TouchButton className="!px-3 !text-[15px]" aria-label={`Undo the ${c.kind === "price_confirmed" ? "price check" : "price change"} for ${line.description}`} onClick={() => h.onUndo(c)}>
              Undo
            </TouchButton>
          ) : null}
        </div>
      ))}

      {canApprove(line) || canSkip(line) || line.state === "approved_skip" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {canApprove(line) ? (
            <TouchButton variant="primary" disabled={busy} onClick={() => h.onApprove(line)}>
              {approveLabel(line)}
            </TouchButton>
          ) : null}
          {canSkip(line) ? (
            <TouchButton disabled={busy} onClick={() => h.onSkip(line)}>
              Skip
            </TouchButton>
          ) : null}
          {line.state === "approved_skip" ? (
            <TouchButton disabled={busy} onClick={() => h.onUnskip(line)}>
              Undo Skip
            </TouchButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** A charge or credit line, quiet: what it is, its amount, and whether it is part of the cost. */
export function ChargeLine({
  line,
  doc,
  rules,
  supplierId,
  takenOff,
}: {
  line: InvoiceLineRow;
  doc: Pick<InvoiceDocumentRow, "fee_pool_ex">;
  rules: InvoiceChargeRuleRow[];
  supplierId: string | null;
  /** the product this line is a standing discount on: it is taken off that product's price, not spread over the invoice */
  takenOff?: string | null;
}) {
  const t = takenOff ? { label: `Taken off the price of ${takenOff}` } : chargeTreatment(line, Number(doc.fee_pool_ex ?? 0), rules, supplierId);
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[15px] leading-snug">{line.description}</p>
        <p className="mt-0.5 text-[13px] text-label-2">{`${CLASS_WORD[line.line_class]}. ${t.label}`}</p>
      </div>
      <p className="shrink-0 text-[15px] tnum text-label-2">{money(line.line_total_ex)}</p>
    </li>
  );
}
