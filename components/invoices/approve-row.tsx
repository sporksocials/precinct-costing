"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { money, packLabel } from "@/lib/format";
import { dayLabel, landedText, priceMove } from "@/lib/invoice-view";
import { lineDiscountText } from "@/lib/invoice-discounts";
import { tidyLabel } from "@/lib/invoice-names";
import { FLAG_WORD, type ApproveRow } from "@/lib/invoice-todo-approve";
import type { Ingredient } from "@/lib/types";
import { TouchButton } from "@/components/ordering/touch";
import { cx } from "@/components/ui";

/** The columns of the table on a wide screen. Below lg every row stacks. */
export const APPROVE_COLUMNS = "lg:grid-cols-[44px_minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1fr)_76px]";

/** "+$0.60" or "-$0.60" */
export function signedMoney(n: number | null): string {
  if (n === null) return "";
  return `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`;
}

/** What the number is: "per 1 kg, ex GST" for an ingredient pack, "inc GST, as ordered" for an ordering price. */
export function priceBasis(row: Pick<ApproveRow, "target">, ing: Pick<Ingredient, "pack_size" | "pack_unit" | "price_inc_gst" | "gst_free"> | null): string {
  if (row.target === "product") return "Ordering price, inc GST";
  if (!ing) return "Pack price";
  const gst = ing.gst_free ? "GST free" : ing.price_inc_gst ? "inc GST" : "ex GST";
  return `Per ${packLabel(ing.pack_size, ing.pack_unit)}, ${gst}`;
}

/** The change as arrow, words and dollars. Amber (with the word Big Change and its icon) only for a row that needs a closer look. */
export function ChangeCell({ row }: { row: ApproveRow }) {
  const move = priceMove(row.pct);
  const Icon = move.dir === "up" ? ArrowUp : move.dir === "down" ? ArrowDown : Minus;
  return (
    <div className="min-w-0">
      {move.dir === "none" ? (
        <p className="text-[15px] font-medium text-label-2">New price</p>
      ) : (
        <p className="inline-flex items-center gap-1 text-[17px] font-semibold tnum sm:text-[15px]">
          <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          {move.text}
          <span className="sr-only">, </span>
          <span className="font-normal text-label-2"> {signedMoney(row.dollars)}</span>
        </p>
      )}
      {row.flag ? (
        <p className="mt-1">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-0.5 text-[13px] font-semibold text-warn">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
            {FLAG_WORD[row.flag]}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export interface ApproveRowProps {
  row: ApproveRow;
  ingredient: Ingredient | null;
  selected: boolean;
  /** the app's price has moved since the invoice was read: approving would be refused, so the box is off */
  stale: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSkip: () => void;
}

/** One price. A single grid: stacked on a phone, a table row from lg up (the cells below line up with the table header). */
export function ApprovePriceRow({ row, ingredient, selected, stale, disabled, onToggle, onSkip }: ApproveRowProps) {
  const l = row.line;
  const name = ingredient?.name ?? tidyLabel(l.description);
  const landed = landedText(l);
  const discount = lineDiscountText(l);
  const basis = priceBasis(row, ingredient);
  const quiet = [tidyLabel(l.description) !== name ? tidyLabel(l.description) : null, l.item_code ? `Code ${l.item_code}` : null].filter(Boolean).join(" · ");
  const inv = `Invoice ${row.doc.invoice_number?.trim() || "(no number)"}`;
  const date = dayLabel(row.doc.invoice_date);
  return (
    <li className={cx("grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-1.5 px-3 py-3 lg:items-center lg:gap-x-3", APPROVE_COLUMNS)}>
      <label className="row-span-4 flex h-11 w-11 cursor-pointer items-center justify-center lg:row-span-1">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled || stale}
          onChange={onToggle}
          aria-label={`Approve ${name}: ${money(row.oldPrice)} to ${money(row.newPrice)}`}
          className="h-6 w-6 cursor-pointer disabled:cursor-not-allowed"
          style={{ accentColor: "var(--accent-fill)" }}
        />
      </label>

      <div className="min-w-0">
        <p className="break-words text-[17px] font-semibold leading-snug sm:text-[15px]">{name}</p>
        {quiet ? <p className="break-words text-[13px] leading-snug text-label-2">{quiet}</p> : null}
        {landed || discount ? <p className="text-[13px] leading-snug text-label-2">{[landed, discount].filter(Boolean).join(" · ")}</p> : null}
        {stale ? (
          <p className="mt-1 flex items-start gap-1.5 text-[13px] font-medium leading-snug text-warn">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            The price in the app changed after this invoice was read. Open the invoice to check it.
          </p>
        ) : null}
      </div>

      <div className="col-start-2 grid grid-cols-2 gap-x-3 gap-y-1.5 lg:contents">
        <div className="lg:text-right">
          <p className="text-[13px] text-label-2 lg:hidden">Was</p>
          <p className="text-[17px] tnum text-label-2 sm:text-[15px]">{row.oldPrice === null ? "None" : money(row.oldPrice)}</p>
        </div>
        <div className="lg:text-right">
          <p className="text-[13px] text-label-2 lg:hidden">Now</p>
          <p className="text-[17px] font-semibold tnum sm:text-[15px]">{money(row.newPrice)}</p>
          <p className="text-[13px] leading-snug text-label-2">{basis}</p>
          {row.other ? (
            <p className="text-[13px] leading-snug text-label-2 tnum">
              {row.other.label}: {row.other.oldPrice === null ? "None" : money(row.other.oldPrice)} to {money(row.other.newPrice)}
            </p>
          ) : null}
        </div>
        <div className="col-span-2 lg:col-span-1">
          <ChangeCell row={row} />
        </div>
      </div>

      <div className="col-start-2 flex items-center justify-between gap-2 lg:contents">
        <Link href={`/invoices/${row.doc.id}`} className="inline-flex min-h-[44px] min-w-0 flex-col justify-center text-[13px] leading-snug text-label-2">
          <span className="truncate font-medium text-accent">{inv}</span>
          {date ? <span>{date}</span> : null}
        </Link>
        <div className="lg:justify-self-end">
          <TouchButton disabled={disabled} onClick={onSkip} aria-label={`Skip ${name}. Leave the app's price as it is.`} className="!px-3 !text-[15px]">
            Skip
          </TouchButton>
        </div>
      </div>
    </li>
  );
}

/** The header of the table: wide screens only (rows say Was and Now for themselves on a phone). */
export function ApproveHeader() {
  return (
    <div aria-hidden className={cx("hidden gap-x-3 border-b border-separator px-3 py-2 text-[13px] font-medium text-label-2 lg:grid", APPROVE_COLUMNS)}>
      <span />
      <span>Item</span>
      <span className="text-right">Old Price</span>
      <span className="text-right">New Price</span>
      <span>Change</span>
      <span>Invoice</span>
      <span />
    </div>
  );
}
