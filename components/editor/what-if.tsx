"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { ItemCost } from "@/lib/costing";
import { gp, money } from "@/lib/format";
import { gpForPrice, parsePriceInput, priceForGp } from "@/lib/solver";
import type { MenuItem, RecipeLine } from "@/lib/types";
import { Banner, cx, Segmented, Sheet } from "../ui";

const SCALES = ["0.8", "0.9", "1", "1.1", "1.25"] as const;
const SCALE_LABEL: Record<(typeof SCALES)[number], string> = { "0.8": "−20%", "0.9": "−10%", "1": "As Is", "1.1": "+10%", "1.25": "+25%" };

/**
 * Try a price and a portion size without touching the recipe. Apply it to this dish, or save the
 * result as a special: a recipe of its own ("… (Special)") that can be priced and changed later.
 */
export function WhatIfSheet({
  cost,
  item,
  lines,
  onClose,
  onApply,
}: {
  cost: ItemCost;
  item: MenuItem;
  lines: RecipeLine[];
  onClose: () => void;
  onApply: (price: number | null, scale: number) => void;
}) {
  const store = useStore();
  const router = useRouter();
  const gst = store.settings.gst_rate;
  const [priceText, setPriceText] = useState(cost.sellInc != null ? Number(cost.sellInc).toFixed(2) : "");
  const [scale, setScale] = useState<(typeof SCALES)[number]>("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const k = Number(scale);
  const price = parsePriceInput(priceText);
  const costNow = cost.costPerPortion * k;
  const gpNow = gpForPrice(costNow, price, gst);
  const under = gpNow != null && gpNow < cost.targetGp - 1e-9;
  const suggested = useMemo(() => priceForGp(costNow, cost.targetGp, gst, store.settings.round_to), [costNow, cost.targetGp, gst, store.settings.round_to]);
  const changed = k !== 1 || (price ?? null) !== (cost.sellInc ?? null);

  async function saveSpecial() {
    setBusy(true);
    setError(null);
    try {
      const { id: _i, ...rest } = item;
      void _i;
      const id = await store.insertItem(
        { ...rest, name: `${item.name} (Special)`, section: "Special", sell_price_inc: price, source: "what-if" },
        lines.filter((l) => l.component_id).map((l, i) => ({ component_type: l.component_type, component_id: l.component_id, qty: Math.round(Number(l.qty) * k * 1000) / 1000, unit: l.unit, note: l.note, sort: i + 1 })),
      );
      onClose();
      router.push(`/items/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="What If" action={{ label: "Apply", onClick: () => onApply(price, k), disabled: !changed }}>
      <div className="pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <p className="text-center text-[15px] text-label-2">{item.name}</p>

        <div className={cx("mt-4 rounded-2xl px-4 py-5 text-center", under ? "bg-danger-soft" : "bg-surface")}>
          <p className="text-[13px] text-label-2">GP · target {gp(cost.targetGp, 0)}</p>
          <p className={cx("display mt-1 text-[64px] tnum", under ? "text-danger" : "text-accent")}>{gpNow == null ? "—" : gp(gpNow)}</p>
          <p className="mt-1 text-[13px] text-label-2 tnum">
            Cost {money(costNow)}
            {cost.gpPct != null ? ` · now ${gp(cost.gpPct)}` : ""}
          </p>
        </div>

        <div className="group-list mt-4">
          <label className="flex min-h-[52px] items-center gap-3 px-4">
            <span className="flex-1 text-[17px] sm:text-[15px]">Price (inc GST)</span>
            <span className="flex items-center rounded-lg bg-fill px-2.5 text-[20px] font-semibold tnum">
              <span className="text-label-3">$</span>
              <input
                inputMode="decimal"
                aria-label="Try a Price"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 w-24 bg-transparent text-right outline-none"
              />
            </span>
          </label>
          {suggested != null && under ? (
            <div className="px-4 pb-3">
              <button type="button" onClick={() => setPriceText(suggested.toFixed(2))} className="inline-flex min-h-[32px] items-center rounded-full bg-accent-soft px-3 text-[13px] font-semibold text-accent">
                Try {money(suggested)} for {gp(cost.targetGp, 0)}
              </button>
            </div>
          ) : null}
          <div className="px-4 pb-3.5 pt-2">
            <p className="pb-2 text-[15px]">Portion Size</p>
            <Segmented ariaLabel="Portion size" value={scale} onChange={setScale} options={SCALES.map((s) => ({ value: s, label: SCALE_LABEL[s] }))} />
            <p className="pt-2 text-[13px] text-label-2">Scales every ingredient in the recipe.</p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <button type="button" className="btn-primary w-full" disabled={!changed} onClick={() => onApply(price, k)}>
            Apply to {item.name.length > 22 ? "This Dish" : item.name}
          </button>
          <button type="button" className="btn-plain w-full" disabled={busy} onClick={() => void saveSpecial()}>
            {busy ? "Saving…" : "Save as a Special"}
          </button>
          <p className="px-1 pt-1 text-center text-[13px] text-label-2">A special is saved as its own recipe, so this dish stays as it is.</p>
        </div>
      </div>
    </Sheet>
  );
}
