"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { orderSelected, printHref, printLabel, selectAllShown as selectAll, toggleSelected } from "@/lib/print-job";
import type { PrintKind } from "@/lib/print-recipe";

/**
 * Select mode for a list of records (Menu, Ingredients > Preps): tick the real records, then print them one per A4 page.
 * `shownIds` is the list as it is shown now, in order; the print follows that order. Virtual rows (tap beers, gelato
 * flavours) are simply never passed in, so they cannot be ticked. Pure rules and the 60 cap live in lib/print-job.ts.
 */
export interface PrintSelect {
  kind: PrintKind;
  on: boolean;
  /** the ticked ids in the order the list shows them */
  ids: string[];
  count: number;
  message: string | null;
  allShownTicked: boolean;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  start: () => void;
  cancel: () => void;
  selectAllShown: () => void;
  clear: () => void;
  /** the preview address for what is ticked */
  href: string;
  /** props for a Row (ui.tsx) while picking; undefined otherwise */
  row: (id: string, label: string) => { checked: boolean; onChange: () => void; label: string } | undefined;
  /** props for a DataTable (table.tsx) while picking; undefined otherwise */
  table: () => { isSelected: (key: string) => boolean; toggle: (key: string) => void; onOrder: (keys: string[]) => void } | undefined;
}

export function usePrintSelect(kind: PrintKind, shownIds: string[]): PrintSelect {
  const [on, setOn] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  // the order a sorted desktop table shows its rows in, when it has been sorted by a column
  const [tableOrder, setTableOrder] = useState<string[] | null>(null);

  const shownKey = shownIds.join(",");
  const order = tableOrder ?? shownIds;
  const ids = useMemo(() => orderSelected(order, selected), [order, selected]);
  const set = useMemo(() => new Set(selected), [selected]);

  const toggle = useCallback(
    (id: string) => {
      const r = toggleSelected(selected, id);
      setSelected(r.selected);
      setMessage(r.message);
    },
    [selected],
  );
  const selectAllShown = useCallback(() => {
    const shown = shownKey ? shownKey.split(",") : [];
    if (shown.length > 0 && shown.every((id) => selected.includes(id))) {
      setSelected(selected.filter((id) => !shown.includes(id)));
      setMessage(null);
      return;
    }
    const r = selectAll(selected, shown);
    setSelected(r.selected);
    setMessage(r.message);
  }, [shownKey, selected]);
  const clear = useCallback(() => {
    setSelected([]);
    setMessage(null);
  }, []);
  const start = useCallback(() => setOn(true), []);
  const cancel = useCallback(() => {
    setOn(false);
    setSelected([]);
    setMessage(null);
    setTableOrder(null);
  }, []);

  const allShownTicked = shownIds.length > 0 && shownIds.every((id) => set.has(id));

  return {
    kind,
    on,
    ids,
    count: selected.length,
    message,
    allShownTicked,
    has: (id) => set.has(id),
    toggle,
    start,
    cancel,
    selectAllShown,
    clear,
    href: printHref(kind, ids),
    row: (id, label) => (on ? { checked: set.has(id), onChange: () => toggle(id), label } : undefined),
    table: () => (on ? { isSelected: (key) => set.has(key), toggle, onOrder: (keys) => setTableOrder((cur) => (cur && cur.join(",") === keys.join(",") ? cur : keys)) } : undefined),
  };
}

const BTN = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[17px] font-semibold transition active:scale-[0.98] active:opacity-80";

/**
 * The bar fixed to the bottom while picking: Print N Recipes, Select All Shown, Cancel. On a phone it sits above the tab bar and
 * wraps to two rows; from lg up it sits clear of the sidebar. A spacer keeps the last rows from hiding behind it.
 */
export function PrintSelectBar({ sel }: { sel: PrintSelect }) {
  if (!sel.on) return null;
  return (
    <>
      <div aria-hidden className="h-[120px] sm:h-[84px]" />
      <div
        role="region"
        aria-label="Print Selection"
        className="bar-blur fixed inset-x-0 bottom-[calc(50px+env(safe-area-inset-bottom))] z-[45] px-4 pb-3 pt-2.5 lg:bottom-0 lg:left-[248px]"
        style={{ boxShadow: "inset 0 0.5px 0 var(--separator)" }}
      >
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 lg:px-6">
          {sel.message ? (
            <p role="status" className="basis-full text-[13px] leading-snug text-warn">
              {sel.message}
            </p>
          ) : null}
          {sel.count ? (
            <Link href={sel.href} className={`${BTN} basis-full bg-accent-fill text-accent-on sm:order-3 sm:ml-auto sm:basis-auto`}>
              <Printer className="h-5 w-5" strokeWidth={2.25} aria-hidden />
              {printLabel(sel.count)}
            </Link>
          ) : (
            <button type="button" disabled className={`${BTN} basis-full bg-accent-fill text-accent-on opacity-40 sm:order-3 sm:ml-auto sm:basis-auto`}>
              <Printer className="h-5 w-5" strokeWidth={2.25} aria-hidden />
              {printLabel(0)}
            </button>
          )}
          <button type="button" onClick={sel.selectAllShown} className={`${BTN} flex-1 bg-fill text-label sm:order-1 sm:flex-none`}>
            {sel.allShownTicked ? "Clear All Shown" : "Select All Shown"}
          </button>
          <button type="button" onClick={sel.cancel} className={`${BTN} flex-1 bg-fill text-label sm:order-2 sm:flex-none`}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
