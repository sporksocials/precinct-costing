"use client";

import { useCallback } from "react";
import { useStore } from "@/lib/store";
import { parseVirtualItemId } from "@/lib/gelato";
import { parseBeerItemId } from "@/lib/beer";
import { money } from "@/lib/format";
import type { ItemCost } from "@/lib/costing";
import { cx, useToast } from "./ui";

/**
 * One-tap "use the suggested price". A gelato flavour × serve sets the serve's price (shared by
 * every flavour); anything else sets the menu item's price. Always undoable from the toast.
 */
export function useApplyPrice() {
  const store = useStore();
  const toast = useToast();
  return useCallback(
    async (c: ItemCost, price: number) => {
      const g = parseVirtualItemId(c.item.id);
      const b = parseBeerItemId(c.item.id);
      const before = c.sellInc;
      try {
        if (g) {
          await store.updateServe(g.serveId, { sell_price_inc: price });
        } else if (b) {
          await store.setBeerPrice(b.beerId, b.serveId, { sell_price_inc: price });
        } else {
          await store.updateItem(c.item.id, { sell_price_inc: price });
        }
        toast.show({
          message: `${g ? c.item.section : c.item.name} now ${money(price)}`,
          action: {
            label: "Undo",
            onClick: () => {
              void (g
                ? store.updateServe(g.serveId, { sell_price_inc: before })
                : b
                  ? store.setBeerPrice(b.beerId, b.serveId, { sell_price_inc: before })
                  : store.updateItem(c.item.id, { sell_price_inc: before }));
            },
          },
        });
      } catch (e) {
        toast.show({ message: `Couldn’t update the price — ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [store, toast],
  );
}

/** Small pill button: "Set $14.50". Stops the row's own navigation. */
export function SetPriceButton({ c, className }: { c: ItemCost; className?: string }) {
  const apply = useApplyPrice();
  const g = parseVirtualItemId(c.item.id);
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
        "inline-flex min-h-[36px] shrink-0 items-center rounded-full bg-accent-soft px-3.5 text-[14px] font-semibold text-accent tnum transition active:scale-[0.96] hover:brightness-110",
        className,
      )}
    >
      Set {money(c.suggestedInc)}
    </button>
  );
}
