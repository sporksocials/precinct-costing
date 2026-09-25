"use client";

import { useCallback, useMemo, useState } from "react";
import { useStore, type StoreValue } from "@/lib/store";
import { parseVirtualItemId } from "@/lib/gelato";
import { parseBeerItemId } from "@/lib/beer";
import { gp, money } from "@/lib/format";
import { gpFromPrice, priceLadder, type ItemCost } from "@/lib/costing";
import { parsePriceInput } from "@/lib/solver";
import { cx, Sheet, useToast } from "./ui";

/** Write one sell price through the right path: gelato serve, tap-beer serve price, or the menu item. */
async function writePrice(store: StoreValue, c: ItemCost, price: number | null): Promise<void> {
  const g = parseVirtualItemId(c.item.id);
  const b = parseBeerItemId(c.item.id);
  if (g) await store.updateServe(g.serveId, { sell_price_inc: price });
  else if (b) await store.setBeerPrice(b.beerId, b.serveId, { sell_price_inc: price });
  else await store.updateItem(c.item.id, { sell_price_inc: price });
}

/** What a price applies to, for messages: a gelato flavour x serve is the serve. */
function labelOf(c: ItemCost): string {
  return parseVirtualItemId(c.item.id) ? (c.item.section ?? c.item.name) : c.item.name;
}

/**
 * One-tap "use the suggested price". A gelato flavour × serve sets the serve's price (shared by
 * every flavour); anything else sets the menu item's price. Always undoable from the toast.
 */
export function useApplyPrice() {
  const store = useStore();
  const toast = useToast();
  return useCallback(
    async (c: ItemCost, price: number) => {
      const before = c.sellInc;
      try {
        await writePrice(store, c, price);
        toast.show({
          message: `${labelOf(c)} now ${money(price)}`,
          action: { label: "Undo", onClick: () => void writePrice(store, c, before) },
        });
      } catch (e) {
        toast.show({ message: `Couldn’t update the price — ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [store, toast],
  );
}

/**
 * Apply several prices in one go (Review & Apply), one after another through the same write paths.
 * ONE toast, and its Undo puts every price that was written back to what it was.
 */
export function useApplyPrices() {
  const store = useStore();
  const toast = useToast();
  return useCallback(
    async (plan: { c: ItemCost; price: number }[]) => {
      const done: { c: ItemCost; before: number | null }[] = [];
      let failed: string | null = null;
      for (const { c, price } of plan) {
        try {
          await writePrice(store, c, price);
          done.push({ c, before: c.sellInc });
        } catch (e) {
          failed = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      const n = done.length;
      const msg = failed
        ? `${n} of ${plan.length} prices updated. Stopped: ${failed}`
        : `${n} ${n === 1 ? "price" : "prices"} updated`;
      toast.show(
        {
          message: msg,
          action: n
            ? {
                label: "Undo",
                onClick: () => {
                  void (async () => {
                    for (const d of done) {
                      try {
                        await writePrice(store, d.c, d.before);
                      } catch {
                        /* keep going: revert as many as possible */
                      }
                    }
                  })();
                },
              }
            : undefined,
        },
        8000,
      );
      return n;
    },
    [store, toast],
  );
}

/** Small pill button: "Set $27.60 · 72%" (price and the GP it gives). Stops the row's own navigation. */
export function SetPriceButton({ c, className }: { c: ItemCost; className?: string }) {
  const store = useStore();
  const apply = useApplyPrice();
  const g = parseVirtualItemId(c.item.id);
  if (!(c.suggestedInc > 0)) return null;
  const after = gpFromPrice(c.costPerPortion, c.suggestedInc, store.settings.gst_rate).gpPct;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void apply(c, c.suggestedInc);
      }}
      title={g ? "Sets the serve price for every flavour" : "Use the suggested price"}
      className={cx(
        "inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full bg-accent-soft px-4 text-[15px] font-semibold text-accent tnum transition active:scale-[0.96] hover:brightness-110 lg:min-h-[36px] lg:px-3.5 lg:text-[14px]",
        className,
      )}
    >
      Set {money(c.suggestedInc)} · {gp(after, 0)}
    </button>
  );
}

/**
 * Pick a different price for one item: the ladder around the suggestion plus a typed price, with
 * the GP it gives shown before anything is written. Gelato serves and beers use the same write paths.
 */
export function PriceSheet({ c, onClose }: { c: ItemCost; onClose: () => void }) {
  const store = useStore();
  const apply = useApplyPrice();
  const gst = store.settings.gst_rate;
  const [text, setText] = useState(c.suggestedInc > 0 ? c.suggestedInc.toFixed(2) : "");
  const [busy, setBusy] = useState(false);
  const ladder = useMemo(() => priceLadder(c.costPerPortion, c.targetGp, gst, store.settings.round_to), [c.costPerPortion, c.targetGp, gst, store.settings.round_to]);
  const price = parsePriceInput(text);
  const valid = price != null && price > 0;
  const now = c.sellInc;
  const newGp = valid ? gpFromPrice(c.costPerPortion, price, gst).gpPct : null;
  const meets = newGp != null && newGp >= c.targetGp - 1e-9;
  const shared = !!parseVirtualItemId(c.item.id);
  const same = valid && now != null && Math.abs(now - price) < 0.005;

  async function save() {
    if (!valid || busy || same) return;
    setBusy(true);
    await apply(c, price);
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Change Price" action={{ label: "Set Price", onClick: () => void save(), disabled: !valid || busy || same }}>
      <div className="pb-2 pt-3">
        <p className="text-center text-[17px] font-semibold">{labelOf(c)}</p>
        <p className="mt-0.5 text-center text-[13px] text-label-2 tnum">
          Cost {money(c.costPerPortion)} · target {gp(c.targetGp, 0)} · now {money(now)} ({gp(c.gpPct)})
        </p>
        {shared ? <p className="mt-1 text-center text-[13px] text-label-2">Applies to every flavour. Cost shown is the dearest flavour, {c.item.name.split(" - ")[0]}.</p> : null}

        {ladder.length ? (
          <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Candidate prices">
            {ladder.map((s) => {
              const selected = valid && Math.abs(price - s.price) < 0.005;
              return (
                <button
                  key={s.price}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setText(s.price.toFixed(2))}
                  className={cx(
                    "flex min-h-[56px] min-w-[84px] shrink-0 flex-col items-center justify-center rounded-xl px-3 py-1.5 active:opacity-70",
                    s.meetsTarget ? "bg-good-soft text-good" : "bg-danger-soft text-danger",
                    selected && "ring-2 ring-accent",
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase leading-none tracking-wide">{s.isSuggested ? "Suggested" : s.meetsTarget ? " " : "Below Target"}</span>
                  <span className="mt-1 text-[17px] font-semibold leading-tight tnum">{money(s.price)}</span>
                  <span className="text-[13px] leading-tight tnum">GP {gp(s.gpPct, 0)}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <label className="mt-4 flex items-center justify-center gap-1 rounded-2xl bg-surface px-4 py-4">
          <span className="text-[28px] font-semibold text-label-3">$</span>
          <input
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="Price Including GST"
            placeholder="0.00"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            style={{ width: `${Math.max(text.length, 4) + 0.3}ch` }}
            className="min-w-0 max-w-[9ch] bg-transparent text-[40px] font-semibold leading-none tnum outline-none placeholder:text-label-3"
          />
        </label>
        <p className="mt-2 text-center text-[13px] text-label-2">Prices include GST.</p>

        <div className={cx("mt-3 rounded-2xl px-4 py-3 text-center", newGp == null ? "bg-surface" : meets ? "bg-good-soft" : "bg-danger-soft")}>
          {newGp == null ? (
            <p className="text-[15px] text-label-2">Type a price to see the GP.</p>
          ) : (
            <>
              <p className={cx("text-[17px] font-semibold tnum", meets ? "text-good" : "text-danger")}>
                GP {gp(c.gpPct, 0)} → {gp(newGp, 1)}
              </p>
              <p className="mt-0.5 text-[13px] text-label-2">{meets ? `Meets the ${gp(c.targetGp, 0)} target.` : `Still below the ${gp(c.targetGp, 0)} target.`}</p>
            </>
          )}
        </div>

        <button type="button" className="btn-primary mt-4 w-full" disabled={!valid || busy || same} onClick={() => void save()}>
          {valid ? `Set ${money(price)}${newGp != null ? ` · ${gp(newGp, 0)} GP` : ""}` : "Set Price"}
        </button>
      </div>
    </Sheet>
  );
}
