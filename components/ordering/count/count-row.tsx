"use client";

import { memo } from "react";
import { Check, Circle } from "lucide-react";
import { cx } from "@/components/ui";
import { STORE_LABEL, rowAnchor, rowStatus, unitPlural } from "@/lib/ordering-count-ui";
import type { OrderingProduct } from "@/lib/ordering-types";
import { PlaceControl } from "./place-control";

export interface CountRowProps {
  product: OrderingProduct;
  /** the category's second place ("Coldroom", "Bar"), or null when it is counted in the Store only */
  secondLabel: string | null;
  store: number | null;
  second: number | null;
  /** a finalised count is read-only until Edit Count */
  readOnly: boolean;
  /** briefly marked after a jump from the review sheet */
  flash: boolean;
  onSet: (product: OrderingProduct, place: "store" | "second", value: number | null) => void;
}

const dash = (n: number | null) => (n == null ? "-" : String(n));

/**
 * One product on the count screen. Takes plain numbers (not objects) so a tap re-renders only its own row, even with 300 products.
 * An uncounted row says "Not counted" in words with a hollow dot, a counted row says "Counted" with a tick: never colour alone.
 */
export const CountRow = memo(function CountRow({ product, secondLabel, store, second, readOnly, flash, onSet }: CountRowProps) {
  const status = rowStatus({ store, second }, secondLabel);
  const counted = status.state === "counted";
  const over = counted && status.total != null && status.total > product.par ? status.total - product.par : 0;
  return (
    <li id={rowAnchor(product.id)} data-product-id={product.id} data-state={status.state} className={cx("relative scroll-mt-[calc(var(--count-head,0px)+52px)] px-4 py-3", !counted && "bg-fill", flash && "ring-2 ring-inset ring-[color:var(--accent-fill)]")}>
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-[3px]", counted ? "bg-accent-fill" : "bg-transparent")} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 sm:flex-1">
          <p className="break-words text-[17px] font-semibold leading-snug">{product.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-label-2">
            <span>{unitPlural(product.unit_name)}</span>
            <span className="inline-flex items-center rounded-md bg-fill-2 px-2 py-0.5 text-[14px] font-semibold text-label">
              Build To <span className="tnum ml-1">{product.par}</span>
            </span>
            {counted ? (
              <span className="inline-flex items-center gap-1 font-medium text-good">
                <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                Counted{secondLabel && status.total != null ? `, ${status.total} total` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-label">
                <Circle className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                Not counted
              </span>
            )}
          </p>
        </div>
        {readOnly ? (
          <dl className="flex shrink-0 gap-6 text-label">
            <div>
              <dt className="text-[12px] font-medium uppercase tracking-wide text-label-2">{STORE_LABEL}</dt>
              <dd className="text-[20px] font-semibold tnum">{dash(store)}</dd>
            </div>
            {secondLabel ? (
              <div>
                <dt className="text-[12px] font-medium uppercase tracking-wide text-label-2">{secondLabel}</dt>
                <dd className="text-[20px] font-semibold tnum">{dash(second)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <div className="flex gap-2 sm:shrink-0 sm:gap-4">
            <PlaceControl label={STORE_LABEL} productName={product.name} value={store} onChange={(v) => onSet(product, "store", v)} />
            {secondLabel ? <PlaceControl label={secondLabel} productName={product.name} value={second} onChange={(v) => onSet(product, "second", v)} /> : null}
          </div>
        )}
      </div>
      {/* notes sit BELOW the controls so a tap never moves the buttons the finger is on */}
      {over > 0 || status.blank ? (
        <p className="mt-2 flex flex-wrap gap-x-3 text-[13px] font-medium text-warn">
          {over > 0 ? <span>Over by {over}</span> : null}
          {status.blank ? <span>{status.blank} blank, counted as none</span> : null}
        </p>
      ) : null}
    </li>
  );
});
