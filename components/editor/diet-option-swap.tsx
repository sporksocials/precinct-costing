"use client";

import React, { useMemo, useState } from "react";
import { Check, Target, TrendingDown } from "lucide-react";
import { useStore } from "@/lib/store";
import { gpStatus } from "@/lib/dashboard";
import { describeOptionDiff, optionCost } from "@/lib/diet-option-cost";
import { addedLineId, readOption, type OptionRead } from "@/lib/diet-options";
import type { DietOptionDef } from "@/lib/diet-legend";
import { gp, money } from "@/lib/format";
import { formatQty } from "@/lib/parse-qty";
import { parsePriceInput } from "@/lib/solver";
import type { DietOptionAdded, DietOptionEntry, MenuItem, RecipeLine } from "@/lib/types";
import { cx, FieldRow, InlineInput } from "../ui";
import { LineEditor, type LinePatch } from "./line-editor";
import { PrepBadge, SmartAdd, type AddSpec } from "./smart-add";

/**
 * Inside one dietary option that is switched on (Troy, 10 Oct 2026): which of the dish's own ingredients the option leaves
 * out, which extra ones it adds, an optional surcharge, and the option's own costing against its own price. Everything goes
 * through the recipe editor's draft (`onPatch` -> `diet_options`), so Save, Discard, the leave guard and the conflict check
 * all apply. The costing is display only and never reaches Home, alerts, averages or the menu list. Nothing here claims the
 * option is gluten free or safe: it is costing and ingredient changes only.
 */
export function OptionSwapPanel({
  item,
  lines,
  def,
  entry,
  onPatch,
}: {
  item: MenuItem;
  lines: RecipeLine[];
  def: DietOptionDef;
  entry: DietOptionEntry;
  onPatch: (p: Partial<DietOptionEntry>) => void;
}) {
  const store = useStore();
  const own = useMemo(() => lines.filter((l) => l.component_id), [lines]);
  const read = useMemo<OptionRead>(() => readOption({ [def.id]: entry }, def.id) as OptionRead, [def.id, entry]);
  const [openAdd, setOpenAdd] = useState<number | null>(null);

  const oc = useMemo(() => optionCost(item, own, read, { index: store.index, settings: store.settings, targets: store.targets }), [item, own, read, store.index, store.settings, store.targets]);
  const nameOfLine = useMemo(() => new Map((oc?.standard.recipe.lines ?? []).map((c) => [c.line.id, c.componentName])), [oc]);
  const addedCosts = useMemo(() => new Map((oc?.cost.recipe.lines ?? []).map((c) => [c.line.id, c])), [oc]);

  const out = new Set(read.removed);
  const setRemoved = (ids: string[]) => onPatch({ removed: ids.length ? ids : undefined });
  const toggleLine = (id: string) => setRemoved(out.has(id) ? read.removed.filter((x) => x !== id) : [...read.removed, id]);

  const setAdded = (next: DietOptionAdded[]) => onPatch({ added: next.length ? next : undefined });
  const addLine = (s: AddSpec) => {
    const next = [...read.added, { component_type: s.component_type, component_id: s.component_id, qty: s.qty ?? 0, unit: s.unit }];
    setAdded(next);
    if (s.qty == null) setOpenAdd(next.length - 1);
  };
  const patchAdded = (i: number, p: LinePatch) =>
    setAdded(
      read.added.map((a, k) => {
        if (k !== i) return a;
        const n: DietOptionAdded = { ...a };
        if (p.qty != null) n.qty = p.qty;
        if (p.unit) n.unit = p.unit;
        if (p.component_type) n.component_type = p.component_type;
        if (p.component_id) n.component_id = p.component_id;
        if ("note" in p) {
          if (p.note) n.note = p.note;
          else delete n.note;
        }
        return n;
      }),
    );
  const removeAdded = (i: number) => {
    setOpenAdd(null);
    setAdded(read.added.filter((_, k) => k !== i));
  };

  const status = oc && oc.gpPct != null ? gpStatus(oc.gpPct, oc.targetGp) : null;
  const diff = oc ? describeOptionDiff(oc, money) : null;
  const staleCount = read.removed.filter((id) => !own.some((l) => l.id === id)).length;

  return (
    <div className="mt-4 space-y-5" data-testid={`option-swap-${def.id}`}>
      {/* Leave Out */}
      <div>
        <p className="text-[13px] font-medium text-label-2">Leave Out</p>
        {own.length ? (
          <div className="group-list mt-1.5 !bg-fill [--inset:0.875rem]">
            {own.map((l) => {
              const on = out.has(l.id);
              const name = nameOfLine.get(l.id) ?? "Ingredient";
              return (
                <button
                  key={l.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Leave out ${name}`}
                  onClick={() => toggleLine(l.id)}
                  className="flex min-h-[44px] w-full items-center gap-3 px-3.5 py-1.5 text-left active:bg-fill-2"
                >
                  <span aria-hidden className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2", on ? "border-[color:var(--accent-fill)] bg-accent-fill text-accent-on" : "border-[color:var(--label-3)]")}>
                    {on ? <Check className="h-4 w-4" strokeWidth={3.5} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx("block truncate text-[17px] sm:text-[15px]", on && "text-label-2 line-through")}>{name}</span>
                  </span>
                  {on ? <span className="shrink-0 text-[13px] font-semibold text-accent">Left out</span> : null}
                  <span className="shrink-0 text-[15px] text-label-2 tnum sm:text-[13px]">{Number(l.qty) ? formatQty(l.qty, l.unit) : ""}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-1.5 text-[13px] text-label-2">Add ingredients to this dish first, then tick the ones this option leaves out.</p>
        )}
        {staleCount ? <p className="mt-1.5 text-[13px] text-label-2">A line left out here has been removed from the dish. It is ignored and goes on the next save.</p> : null}
      </div>

      {/* Add For This Option */}
      <div>
        <p className="text-[13px] font-medium text-label-2">Add For This Option</p>
        <div className="group-list mt-1.5 !bg-fill [--inset:0.875rem]">
          {read.added.map((a, i) => {
            const lc = addedCosts.get(addedLineId(i));
            const line: RecipeLine = { id: addedLineId(i), parent_type: "item", parent_id: item.id, component_type: a.component_type, component_id: a.component_id, qty: a.qty, unit: a.unit, note: a.note ?? null, sort: 0 };
            const open = openAdd === i;
            return (
              <div key={`${i}-${a.component_id}`}>
                <button type="button" aria-expanded={open} onClick={() => setOpenAdd(open ? null : i)} className={cx("flex min-h-[44px] w-full items-center gap-3 px-3.5 py-1.5 text-left active:bg-fill-2", open && "bg-fill-2")}>
                  <span className="min-w-0 flex-1 truncate text-[17px] sm:text-[15px]">
                    {lc?.componentName ?? "Ingredient"}
                    {a.component_type === "prep" ? <PrepBadge /> : null}
                  </span>
                  <span className="shrink-0 text-[15px] text-label-2 tnum sm:text-[13px]">{a.qty ? formatQty(a.qty, a.unit) : <span className="text-accent">Add Quantity</span>}</span>
                </button>
                {open ? (
                  <div className="px-3.5 pb-4 pt-2">
                    <LineEditor key={`${i}-${a.component_id}`} line={line} cost={lc} warning={lc?.warning ? "This item can’t be costed. Swap it or fix its unit." : null} focusQty={!a.qty} onChange={(p) => patchAdded(i, p)} onDelete={() => removeAdded(i)} onDone={() => setOpenAdd(null)} />
                  </div>
                ) : null}
              </div>
            );
          })}
          <SmartAdd onAdd={addLine} placeholder="Add e.g. 15 ml tamari" />
        </div>
      </div>

      {/* Surcharge */}
      <div className="group-list !bg-fill [--inset:0.875rem]">
        <FieldRow label="Surcharge" sub="Leave blank for the same price">
          <InlineInput
            ariaLabel={`Surcharge for ${def.name}`}
            value={read.surcharge > 0 ? read.surcharge.toFixed(2) : ""}
            placeholder="None"
            prefix="$"
            onCommit={(t) => {
              const n = parsePriceInput(t);
              onPatch({ surcharge_inc: n != null && n > 0 ? Math.round(n * 100) / 100 : null });
            }}
          />
        </FieldRow>
      </div>

      {/* Costing */}
      {oc ? (
        <section aria-label={`${def.name} costing`} className="rounded-2xl bg-surface-2 p-4" data-testid={`option-costing-${def.id}`}>
          <p className="text-[15px] font-semibold">{def.name}</p>
          <p className="text-[13px] text-label-2">Costing For This Option</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-[13px] text-label-2">Cost (ex GST)</dt>
              <dd className="text-[20px] font-semibold tnum">{money(oc.costPerPortion)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-label-2">Price (inc GST)</dt>
              <dd className="text-[20px] font-semibold tnum">{oc.priceInc != null ? money(oc.priceInc) : "No price"}</dd>
              {oc.priceInc != null && oc.surcharge > 0 ? <dd className="text-[13px] text-label-2 tnum">includes {money(oc.surcharge)} surcharge</dd> : null}
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-[13px] text-label-2">GP</dt>
              {status && oc.gpPct != null ? (
                <dd className={cx("flex flex-wrap items-center gap-x-1.5 text-[20px] font-semibold tnum", status.level === "good" ? "text-good" : status.level === "warn" ? "text-warn" : "text-danger")}>
                  {status.level === "good" ? <Check aria-hidden className="h-5 w-5" strokeWidth={3} /> : status.level === "warn" ? <Target aria-hidden className="h-5 w-5" strokeWidth={2.75} /> : <TrendingDown aria-hidden className="h-5 w-5" strokeWidth={2.75} />}
                  {gp(oc.gpPct, 1, oc.targetGp)}
                  <span className="text-[15px] font-semibold">{status.word}</span>
                </dd>
              ) : (
                <dd className="text-[15px] text-label-2">Set a price on the dish to see GP</dd>
              )}
            </div>
          </dl>
          <div className="mt-3 space-y-0.5 text-[15px] sm:text-[13px]">
            {diff?.same ? <p className="text-label-2">Same as the standard dish</p> : null}
            {diff?.cost ? <p className="text-label">{diff.cost}</p> : null}
            {diff?.gp ? <p className="text-label">{diff.gp}</p> : null}
            {oc.notes.map((n) => (
              <p key={n} className="text-warn">
                {n}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
