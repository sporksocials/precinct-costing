"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { money, packLabel } from "@/lib/format";
import { brisbaneStamp } from "@/lib/ordering-orders-ui";
import {
  approveLabel,
  canApprove,
  canSkip,
  chargeTreatment,
  CLASS_WORD,
  decisionText,
  feeShareText,
  landedText,
  LANDED_EXPLAIN,
  lineStateView,
  priceCompares,
  qtyPriceText,
} from "@/lib/invoice-view";
import type { InvoiceChargeRuleRow, InvoiceDocumentRow, InvoiceLineRow, InvoicePriceChangeRow, LineClass } from "@/lib/invoice-types";
import type { Ingredient } from "@/lib/types";
import { TouchButton } from "@/components/ordering/touch";
import { cx } from "@/components/ui";
import { MoveLabel, NeedsTag } from "./inv-parts";

export interface LineHandlers {
  onApprove: (l: InvoiceLineRow) => void;
  onSkip: (l: InvoiceLineRow) => void;
  onUnskip: (l: InvoiceLineRow) => void;
  onUndo: (c: InvoicePriceChangeRow) => void;
  busyId: string | null;
}

/** One product line: what was bought, what it cost landed, what it matched, how it compares with the app, what was decided and what a person can do. */
export function InvLine({
  line,
  ingredient,
  productName,
  venueSlug,
  poolClasses,
  changes,
  nameOf,
  h,
}: {
  line: InvoiceLineRow;
  ingredient: Ingredient | null;
  productName: string | null;
  venueSlug: string | null;
  poolClasses: readonly LineClass[];
  changes: InvoicePriceChangeRow[];
  nameOf: (email: string | null | undefined) => string | null;
  h: LineHandlers;
}) {
  const [open, setOpen] = useState(false);
  const state = lineStateView(line);
  const landed = landedText(line);
  const share = feeShareText(line, poolClasses);
  const compares = priceCompares(line);
  const busy = h.busyId === line.id;
  const total = line.line_total_ex;
  return (
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold leading-snug">{line.description}</p>
          <p className="mt-0.5 text-[15px] text-label-2 sm:text-[13px]">{[line.item_code ? `Code ${line.item_code}` : null, qtyPriceText(line) || null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[17px] font-semibold tnum sm:text-[15px]">{money(total)}</p>
          <p className="text-[13px] text-label-2">ex GST</p>
        </div>
      </div>

      {landed ? (
        share ? (
          <div>
            <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg text-[15px] font-medium text-accent sm:text-[13px]">
              {landed}
              <ChevronDown aria-hidden className={cx("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} strokeWidth={2.5} />
            </button>
            {open ? (
              <p className="rounded-xl bg-fill px-3 py-2 text-[15px] text-label-2 sm:text-[13px]">
                <span className="font-semibold text-label">{share}.</span> {LANDED_EXPLAIN}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[15px] font-medium text-label-2 sm:text-[13px]">{landed}</p>
        )
      ) : null}

      <div className="text-[15px] sm:text-[13px]">
        {line.ingredient_id && ingredient ? (
          <p>
            <span className="text-label-2">Matches </span>
            <Link href={`/ingredients/${ingredient.id}`} className="inline-flex min-h-[44px] items-center font-medium text-accent">
              {ingredient.name}
            </Link>
          </p>
        ) : line.product_id && productName ? (
          <p>
            <span className="text-label-2">Matches </span>
            {venueSlug ? (
              <Link href={`/ordering/${venueSlug}/setup/products/${line.product_id}`} className="inline-flex min-h-[44px] items-center font-medium text-accent">
                {productName}
              </Link>
            ) : (
              <span className="font-medium">{productName}</span>
            )}
          </p>
        ) : (
          <p className="text-label-2">{line.match_state === "ignored" ? "Ignored. Not costed." : "Not matched to an ingredient or product yet."}</p>
        )}
      </div>

      {compares.map((c) => (
        <div key={c.what} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 text-[15px] sm:text-[13px]">
          <span className="text-label-2">
            {c.what === "ingredient" ? "App price" : "Ordering price"} <span className="tnum font-medium text-label">{money(c.now)}</span>
            {c.what === "ingredient" && ingredient ? ` per ${packLabel(ingredient.pack_size, ingredient.pack_unit)}` : ""}
          </span>
          <span className="text-label-2">
            Invoice <span className="tnum font-medium text-label">{money(c.invoice)}</span>
          </span>
          <MoveLabel move={c.move} />
        </div>
      ))}

      <p className="text-[15px] text-label-2 sm:text-[13px]">{decisionText(line)}</p>

      <div className="flex flex-wrap items-center gap-2">
        {state.tone === "warn" ? <NeedsTag>{state.word}</NeedsTag> : <span className="rounded-md bg-fill px-2 py-0.5 text-[13px] font-semibold text-label-2">{state.word}</span>}
      </div>

      {changes.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-1.5">
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
        <div className="flex flex-wrap gap-2 pt-1">
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
export function ChargeLine({ line, doc, rules, supplierId }: { line: InvoiceLineRow; doc: Pick<InvoiceDocumentRow, "fee_pool_ex">; rules: InvoiceChargeRuleRow[]; supplierId: string | null }) {
  const t = chargeTreatment(line, Number(doc.fee_pool_ex ?? 0), rules, supplierId);
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
