"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { resolveTargetGp, type LineCost } from "@/lib/costing";
import { costServe } from "@/lib/gelato";
import { gp, money } from "@/lib/format";
import { formatQty } from "@/lib/parse-qty";
import { cx, Dot, Group, Segmented } from "../ui";

const BATCHES = ["3", "4.5", "5", "9"] as const;

/**
 * Live serve prices for a gelato flavour mix: what every serve costs and earns with the mix as
 * it stands in the editor (before it is saved), plus the mix scaled to a machine batch.
 */
export function GelatoFlavourPanel({ mixCost, batchKg, lines }: { mixCost: number; batchKg: number; lines: LineCost[] }) {
  const store = useStore();
  const venue = store.gelato.venue;
  const [all, setAll] = useState(false);
  const [batch, setBatch] = useState<(typeof BATCHES)[number]>("4.5");
  const perKg = batchKg > 0 ? mixCost / batchKg : 0;
  const target = venue ? resolveTargetGp({ venue_id: venue.id, category: "Gelato", target_override: null }, store.targets) : 0.72;

  const serves = useMemo(() => {
    const list = all ? store.gelato.serves : store.gelato.serves.filter((s) => s.on_menu);
    return (list.length ? list : store.gelato.serves).map((s) => costServe(s, store.gelatoServeLines, perKg, store.settings.gelato_wastage, store.index, store.settings, target));
  }, [all, store.gelato.serves, store.gelatoServeLines, perKg, store.settings, store.index, target]);

  const factor = batchKg > 0 ? Number(batch) / batchKg : 0;

  return (
    <>
      <Group
        title="Serves"
        className="mt-7"
        trailing={
          <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setAll((a) => !a)}>
            {all ? "Menu serves only" : `All ${store.gelato.serves.length} serves`}
          </button>
        }
        footer={
          <>
            Mix {money(perKg)}/kg · {gp(store.settings.gelato_wastage, 0)} wastage · target {gp(target, 0)}. Prices and packaging are set once for every flavour in{" "}
            <Link href="/gelato/serves" className="text-accent">
              Serves
            </Link>
            .
          </>
        }
      >
        {batchKg <= 0 ? (
          <p className="px-4 py-3 text-[15px] text-label-2">Add the mix ingredients (in g or kg) to see the serve prices.</p>
        ) : (
          serves.map((c) => (
            <div key={c.serve.id} className="flex min-h-[48px] items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] sm:text-[15px]">{c.serve.name}</span>
                <span className="block truncate text-[13px] text-label-2 tnum">
                  {Number(c.serve.grams)}g · gelato {money(c.mixCost)} + packaging {money(c.packagingCost)} = {money(c.cost)}
                  {c.underTarget ? ` · needs ${money(c.suggestedInc)}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right tnum">
                <span className="block text-[15px]">{c.serve.sell_price_inc != null ? money(Number(c.serve.sell_price_inc)) : "—"}</span>
                <span className={cx("flex items-center justify-end gap-1 text-[13px]", c.underTarget ? "font-semibold text-danger" : "text-label-2")}>
                  {c.underTarget ? <Dot className="bg-danger" /> : null}
                  {c.gpPct != null ? gp(c.gpPct) : "No price"}
                </span>
              </span>
            </div>
          ))
        )}
      </Group>

      {batchKg > 0 && lines.length ? (
        <Group title="Batch for the machine" trailing={<span className="text-[13px] text-label-2 tnum">{money(perKg * Number(batch))}</span>}>
          <div className="px-4 py-2">
            <Segmented size="sm" ariaLabel="Batch size" value={batch} onChange={setBatch} options={BATCHES.map((b) => ({ value: b, label: `${b} kg` }))} />
          </div>
          {lines.map((lc) => (
            <div key={lc.line.id} className="flex min-h-[40px] items-center gap-3 px-4 py-1.5 text-[15px]">
              <span className="min-w-0 flex-1 truncate">{lc.componentName}</span>
              <span className="shrink-0 tnum text-label-2">{formatQty(Math.round((Number(lc.line.qty) || 0) * factor * 10) / 10, lc.line.unit)}</span>
            </div>
          ))}
        </Group>
      ) : null}
    </>
  );
}
