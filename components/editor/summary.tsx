"use client";

import { useEffect, useState } from "react";
import { gp, money, unitShort } from "@/lib/format";
import { gpForPrice, parseGpInput, parsePriceInput, priceForGp } from "@/lib/solver";
import type { ItemCost } from "@/lib/costing";
import type { CostingSettings, PackUnit } from "@/lib/types";
import { cx } from "../ui";

/** Text input that shows a formatted value until focused, then the raw editable number. */
function ValueInput({
  display,
  raw,
  onCommit,
  className,
  ariaLabel,
  placeholder,
}: {
  display: string;
  raw: string;
  onCommit: (text: string) => void;
  className?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(raw);
  useEffect(() => {
    if (!focused) setText(raw);
  }, [raw, focused]);
  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      placeholder={placeholder}
      value={focused ? text : display}
      onFocus={(e) => {
        setFocused(true);
        setText(raw);
        const el = e.currentTarget;
        window.setTimeout(() => el.select(), 0);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (text !== raw) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(raw);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cx("min-w-0 tnum outline-none", className)}
    />
  );
}

export interface PriceModel {
  cost: ItemCost;
  settings: CostingSettings;
  setPrice: (p: number | null) => void;
}

function useLinked({ cost, settings, setPrice }: PriceModel) {
  const gst = settings.gst_rate;
  const price = cost.sellInc;
  const gpPct = gpForPrice(cost.costPerPortion, price, gst);
  const target = cost.targetGp;
  const targetPrice = priceForGp(cost.costPerPortion, target, gst, settings.round_to);
  return {
    price,
    gpPct,
    target,
    under: cost.underTarget,
    targetPrice,
    commitPrice: (t: string) => setPrice(parsePriceInput(t)),
    commitGp: (t: string) => {
      const g = parseGpInput(t);
      if (g == null) return;
      const p = priceForGp(cost.costPerPortion, g, gst, settings.round_to);
      if (p != null) setPrice(p);
    },
  };
}

function TargetChip({ price, target, onUse }: { price: number | null; target: number; onUse: () => void }) {
  if (price == null) return null;
  return (
    <button type="button" onClick={onUse} className="inline-flex min-h-[32px] items-center rounded-full bg-danger-soft px-3 text-[13px] font-semibold text-danger active:opacity-70">
      Use {money(price)} for {gp(target, 0)} target
    </button>
  );
}

/** Sticky summary card (desktop, right column). */
export function ItemSummaryCard(m: PriceModel) {
  const l = useLinked(m);
  return (
    <div className="rounded-2xl bg-surface p-5">
      <p className="eyebrow text-[11px] text-label-2">GP</p>
      <div className={cx("flex items-baseline gap-1", l.under ? "text-danger" : "text-accent")}>
        <ValueInput
          ariaLabel="GP percent"
          display={l.gpPct == null ? "—" : gp(l.gpPct)}
          raw={l.gpPct == null ? "" : (l.gpPct * 100).toFixed(1)}
          onCommit={l.commitGp}
          placeholder="—"
          className="display w-full rounded-lg bg-transparent text-[60px] hover:bg-fill focus:bg-fill"
        />
      </div>
      <p className="mt-0.5 text-[13px] text-label-2">Target {gp(l.target, 0)}</p>
      {l.under ? (
        <div className="mt-3">
          <TargetChip price={l.targetPrice} target={l.target} onUse={() => l.targetPrice != null && m.setPrice(l.targetPrice)} />
        </div>
      ) : null}
      <div className="mt-5 space-y-3 border-t-[0.5px] border-sep pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-label-2">Sell price</span>
          <span className="flex items-center rounded-lg bg-fill px-2 text-[17px] font-semibold">
            <ValueInput
              ariaLabel="Sell price including GST"
              display={l.price == null ? "Add price" : money(l.price)}
              raw={l.price == null ? "" : String(l.price)}
              onCommit={l.commitPrice}
              placeholder="$0.00"
              className="h-9 w-28 bg-transparent text-right"
            />
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-label-2">Cost per portion</span>
          <span className="text-[17px] tnum">{money(m.cost.costPerPortion)}</span>
        </div>
        <p className="text-[12px] text-label-3">Prices include GST</p>
      </div>
    </div>
  );
}

/** Fixed bottom bar (phones). */
export function ItemSummaryBar(m: PriceModel) {
  const l = useLinked(m);
  return (
    <div className="bar-blur fixed inset-x-0 bottom-0 z-40 pb-safe hairline-t lg:hidden">
      {l.under ? (
        <div className="flex justify-center px-4 pt-2">
          <TargetChip price={l.targetPrice} target={l.target} onUse={() => l.targetPrice != null && m.setPrice(l.targetPrice)} />
        </div>
      ) : null}
      <div className="grid grid-cols-3 items-end gap-2 px-4 pb-2 pt-2">
        <div>
          <p className="text-[12px] text-label-2">Cost</p>
          <p className="h-10 text-[20px] font-semibold leading-10 tnum">{money(m.cost.costPerPortion)}</p>
        </div>
        <div>
          <p className="text-[12px] text-label-2">Price</p>
          <ValueInput
            ariaLabel="Sell price including GST"
            display={l.price == null ? "Add" : money(l.price)}
            raw={l.price == null ? "" : String(l.price)}
            onCommit={l.commitPrice}
            className={cx("h-10 w-full rounded-lg bg-fill px-2 text-[20px] font-semibold", l.price == null && "text-accent")}
          />
        </div>
        <div className="text-right">
          <p className="text-[12px] text-label-2">GP · target {gp(l.target, 0)}</p>
          <ValueInput
            ariaLabel="GP percent"
            display={l.gpPct == null ? "—" : gp(l.gpPct)}
            raw={l.gpPct == null ? "" : (l.gpPct * 100).toFixed(1)}
            onCommit={l.commitGp}
            className={cx("h-10 w-full rounded-lg bg-fill px-2 text-right text-[24px] font-bold", l.under ? "text-danger" : "text-label")}
          />
        </div>
      </div>
    </div>
  );
}

export function PrepSummary({ batchCost, costPerUnit, unit, variant }: { batchCost: number; costPerUnit: number; unit: PackUnit; variant: "card" | "bar" }) {
  if (variant === "bar")
    return (
      <div className="bar-blur fixed inset-x-0 bottom-0 z-40 pb-safe hairline-t lg:hidden">
        <div className="grid grid-cols-2 gap-2 px-4 py-2.5">
          <div>
            <p className="text-[12px] text-label-2">Batch cost</p>
            <p className="text-[20px] font-semibold tnum">{money(batchCost)}</p>
          </div>
          <div className="text-right">
            <p className="text-[12px] text-label-2">Cost per {unitShort(unit)}</p>
            <p className="text-[24px] font-bold tnum">{money(costPerUnit)}</p>
          </div>
        </div>
      </div>
    );
  return (
    <div className="rounded-2xl bg-surface p-5">
      <p className="text-[13px] text-label-2">Cost per {unitShort(unit)}</p>
      <p className="display mt-1 text-[60px] tnum text-accent">{money(costPerUnit)}</p>
      <div className="mt-5 flex items-center justify-between border-t-[0.5px] border-sep pt-4">
        <span className="text-[15px] text-label-2">Batch cost</span>
        <span className="text-[17px] tnum">{money(batchCost)}</span>
      </div>
      <p className="mt-3 text-[12px] text-label-3">Ex GST</p>
    </div>
  );
}
