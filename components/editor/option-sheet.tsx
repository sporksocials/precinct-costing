"use client";

import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import { Check, Target, TrendingDown } from "lucide-react";
import { useStore } from "@/lib/store";
import { gpStatus } from "@/lib/dashboard";
import { describeOptionDiff, optionCost, optionWording, suggestedSurcharge } from "@/lib/diet-option-cost";
import { dietMarkDef, dietOptionDef, type DietOptionDef, type DietOptionId } from "@/lib/diet-legend";
import { addedLineId, optionHasContent, optionOnClearsMark, type OptionRead } from "@/lib/diet-options";
import { gp, money } from "@/lib/format";
import { formatQty } from "@/lib/parse-qty";
import { parsePriceInput } from "@/lib/solver";
import type { DietOptionAdded, DietOptionEntry, DietOptions, MenuItem, RecipeLine } from "@/lib/types";
import { cx, FieldRow, InlineInput, Sheet, useToast } from "../ui";
import { LineEditor, type LinePatch } from "./line-editor";
import { PrepBadge, SmartAdd, type AddSpec } from "./smart-add";

/**
 * The guided sheet for a dietary option (GFO, VO, VGO, DFO), Troy 10 Oct 2026: "when I select this, it needs to come up in a
 * cleaner step: show a list of the ingredients and tick one or multiple that have to change, then another step for any additions."
 *
 * One scrolling sheet, four numbered steps in the order a person thinks: 1 Leave Out (tick the dish's own ingredients), 2 Add
 * (what the option uses instead), 3 Price (optional surcharge, a one tap suggestion, the live costing) and 4 Note (the wording
 * the kitchen sees, built from the swap, plus an optional extra note). The sheet works on a COPY: Done writes the option to the
 * recipe editor's DRAFT (so Save, Discard, the leave guard and the conflict check apply, nothing goes to the database here) and
 * Cancel leaves the draft exactly as it was. The costing is display only and never reaches Home, alerts, averages or the Menu
 * list. Nothing here claims the option is gluten free or safe: it is costing and ingredient changes only.
 */

/* ------------------------------------------------------------------ the editor context (one sheet for the whole dish page) */

export interface OptionEditorApi {
  /** open the sheet for an option (a new one when the draft does not hold it yet) */
  edit: (id: DietOptionId) => void;
  /** take the option out of the draft, keeping its swap for this visit so switching it back on restores it */
  turnOff: (id: DietOptionId) => void;
  /** remember an entry that was pushed out (by a mark) so switching the option back on restores it */
  keep: (id: DietOptionId, entry: DietOptionEntry | undefined) => void;
}

const OptionEditorContext = createContext<OptionEditorApi | null>(null);
export function useOptionEditor(): OptionEditorApi | null {
  return useContext(OptionEditorContext);
}

type Options = NonNullable<MenuItem["diet_options"]>;

export function OptionEditorProvider({ item, lines, onPatch, children }: { item: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void; children: React.ReactNode }) {
  const [openId, setOpenId] = useState<DietOptionId | null>(null);
  const stash = useRef(new Map<DietOptionId, DietOptionEntry>());
  const toast = useToast();
  const saved: Options = item.diet_options && typeof item.diet_options === "object" && !Array.isArray(item.diet_options) ? item.diet_options : {};
  const has = (id: DietOptionId) => Object.prototype.hasOwnProperty.call(saved, id);

  const api = useMemo<OptionEditorApi>(
    () => ({
      edit: (id) => setOpenId(id),
      turnOff: (id) => {
        const e = saved[id];
        if (e) stash.current.set(id, e);
        const next = { ...saved };
        delete next[id];
        onPatch({ diet_options: next });
      },
      keep: (id, entry) => {
        if (entry) stash.current.set(id, entry);
      },
    }),
    // `saved` and `onPatch` change with every draft edit; the api is cheap to rebuild
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved, onPatch],
  );

  const done = (id: DietOptionId, entry: DietOptionEntry) => {
    // a new option turns off the mark that cannot sit beside it (GFO and GF, ...), with a plain note saying so
    const fresh = !has(id);
    const { next, clearedMark } = fresh ? optionOnClearsMark(saved, id) : { next: { ...saved } as DietOptions, clearedMark: null };
    stash.current.delete(id);
    onPatch({ diet_options: { ...next, [id]: entry } });
    setOpenId(null);
    if (clearedMark) toast.show({ message: `${dietMarkDef(clearedMark).name} turned off. A dish marked ${dietMarkDef(clearedMark).name} cannot also offer ${dietOptionDef(id).name}.` });
  };

  return (
    <OptionEditorContext.Provider value={api}>
      {children}
      {openId ? (
        <OptionSheet
          key={openId}
          item={item}
          lines={lines}
          def={dietOptionDef(openId)}
          initial={saved[openId] ?? stash.current.get(openId) ?? null}
          onCancel={() => setOpenId(null)}
          onDone={(entry) => done(openId, entry)}
        />
      ) : null}
    </OptionEditorContext.Provider>
  );
}

/* ------------------------------------------------------------------ the sheet */

interface Working {
  note: string;
  removed: string[];
  added: DietOptionAdded[];
  surcharge: number;
}

/** The working copy a sheet starts from: the saved entry (stale left-out lines dropped), or an empty option. */
function startWorking(initial: DietOptionEntry | null, lines: readonly RecipeLine[]): Working {
  const live = new Set(lines.map((l) => l.id));
  const removed = Array.isArray(initial?.removed) ? [...new Set(initial.removed.filter((x) => typeof x === "string" && live.has(x)))] : [];
  const added = Array.isArray(initial?.added) ? initial.added.map((a) => ({ ...a })) : [];
  const s = Number(initial?.surcharge_inc);
  return { note: typeof initial?.note === "string" ? initial.note : "", removed, added, surcharge: Number.isFinite(s) && s > 0 ? s : 0 };
}

/** The entry to store: unknown keys of the earlier entry are kept, empty swap fields are removed, never stored as empty. */
function toEntry(initial: DietOptionEntry | null, w: Working): DietOptionEntry {
  const entry: Record<string, unknown> = { ...(initial ?? {}), note: w.note.trim() };
  if (w.removed.length) entry.removed = w.removed;
  else delete entry.removed;
  if (w.added.length) entry.added = w.added;
  else delete entry.added;
  if (w.surcharge > 0) entry.surcharge_inc = Math.round(w.surcharge * 100) / 100;
  else delete entry.surcharge_inc;
  return entry as unknown as DietOptionEntry;
}

function Step({ n, title, help, children }: { n: number; title: string; help: string; children: React.ReactNode }) {
  return (
    <section className="pt-5 first:pt-2" aria-label={`Step ${n}: ${title}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px] font-bold text-accent tnum">
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-tight sm:text-[15px]">{title}</h3>
          <p className="text-[13px] text-label-2">{help}</p>
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export const OPTION_EMPTY_REASON = "Tick what to leave out, add something, or write a note.";

function OptionSheet({
  item,
  lines,
  def,
  initial,
  onCancel,
  onDone,
}: {
  item: MenuItem;
  lines: RecipeLine[];
  def: DietOptionDef;
  initial: DietOptionEntry | null;
  onCancel: () => void;
  onDone: (entry: DietOptionEntry) => void;
}) {
  const store = useStore();
  const own = useMemo(() => lines.filter((l) => l.component_id), [lines]);
  const [w, setW] = useState<Working>(() => startWorking(initial, lines));
  const [openAdd, setOpenAdd] = useState<number | null>(null);
  /** the surcharge before the one tap suggestion was used, so it can be undone */
  const [beforeSuggestion, setBeforeSuggestion] = useState<number | null>(null);

  const read = useMemo<OptionRead>(() => ({ id: def.id, note: w.note.trim(), removed: w.removed, added: w.added, surcharge: w.surcharge }), [def.id, w]);
  const oc = useMemo(() => optionCost(item, own, read, { index: store.index, settings: store.settings, targets: store.targets }), [item, own, read, store.index, store.settings, store.targets]);
  const nameOfLine = useMemo(() => new Map((oc?.standard.recipe.lines ?? []).map((c) => [c.line.id, c.componentName])), [oc]);
  const addedCosts = useMemo(() => new Map((oc?.cost.recipe.lines ?? []).map((c) => [c.line.id, c])), [oc]);
  const wording = oc ? optionWording(oc) : "";
  const canDone = optionHasContent(read);

  const out = new Set(w.removed);
  const toggleLine = (id: string) => setW((c) => ({ ...c, removed: c.removed.includes(id) ? c.removed.filter((x) => x !== id) : [...c.removed, id] }));
  const setAdded = (fn: (a: DietOptionAdded[]) => DietOptionAdded[]) => setW((c) => ({ ...c, added: fn(c.added) }));
  const addLine = (s: AddSpec) => {
    setOpenAdd(s.qty == null ? w.added.length : null);
    setAdded((a) => [...a, { component_type: s.component_type, component_id: s.component_id, qty: s.qty ?? 0, unit: s.unit }]);
  };
  const patchAdded = (i: number, p: LinePatch) =>
    setAdded((all) =>
      all.map((a, k) => {
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
    setAdded((all) => all.filter((_, k) => k !== i));
  };

  const status = oc && oc.gpPct != null ? gpStatus(oc.gpPct, oc.targetGp) : null;
  const diff = oc ? describeOptionDiff(oc, money) : null;
  const sug = oc ? suggestedSurcharge(oc, item.sell_price_inc, store.settings) : null;
  const targetText = oc ? gp(oc.targetGp, 0) : "";

  return (
    <Sheet open onClose={onCancel} title={def.name} size="lg" cancelLabel="Cancel">
      <div data-testid={`option-sheet-${def.id}`}>
        {/* 1 Leave Out */}
        <Step n={1} title="Leave Out" help="Tick the ingredients this option does not use.">
          {own.length ? (
            <div className="group-list !bg-fill [--inset:0.875rem]">
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
            <p className="text-[13px] text-label-2">Add ingredients to this dish first, then tick the ones this option leaves out.</p>
          )}
        </Step>

        {/* 2 Add */}
        <Step n={2} title="Add" help="Add anything this option uses instead.">
          <div className="group-list !bg-fill [--inset:0.875rem]">
            {w.added.map((a, i) => {
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
            <SmartAdd onAdd={addLine} placeholder="Add e.g. 1 gluten free pizza base" />
          </div>
        </Step>

        {/* 3 Price */}
        <Step n={3} title="Price" help="Optional. Add a surcharge if this option costs more.">
          <div className="group-list !bg-fill [--inset:0.875rem]">
            <FieldRow label="Surcharge" sub="Leave blank for the same price">
              <InlineInput
                ariaLabel={`Surcharge for ${def.name}`}
                value={w.surcharge > 0 ? w.surcharge.toFixed(2) : ""}
                placeholder="None"
                prefix="$"
                onCommit={(t) => {
                  const n = parsePriceInput(t);
                  setBeforeSuggestion(null);
                  setW((c) => ({ ...c, surcharge: n != null && n > 0 ? Math.round(n * 100) / 100 : 0 }));
                }}
              />
            </FieldRow>
            {oc ? (
              <div className="flex min-h-[44px] items-center gap-3 px-4 py-2" data-testid="surcharge-suggestion">
                {sug == null ? (
                  <p className="text-[13px] text-label-2">Set a price on the dish to get a suggested surcharge.</p>
                ) : beforeSuggestion != null ? (
                  <>
                    <p className="min-w-0 flex-1 text-[13px] text-label-2">Surcharge set to {money(w.surcharge)}.</p>
                    <button
                      type="button"
                      className="btn-plain !min-h-[44px] shrink-0"
                      onClick={() => {
                        setW((c) => ({ ...c, surcharge: beforeSuggestion }));
                        setBeforeSuggestion(null);
                      }}
                    >
                      Undo
                    </button>
                  </>
                ) : sug.surcharge === 0 ? (
                  <p className="text-[13px] text-label-2">At or over the {targetText} target with no surcharge.</p>
                ) : Math.abs(sug.surcharge - w.surcharge) < 0.005 ? (
                  <p className="text-[13px] text-label-2">A {money(sug.surcharge)} surcharge reaches the {targetText} target.</p>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 text-[13px] text-label-2">
                      To reach the {targetText} target this option needs a {money(sug.surcharge)} surcharge, a price of {money(sug.price)}.
                    </p>
                    <button
                      type="button"
                      className="btn-tinted !min-h-[44px] shrink-0"
                      onClick={() => {
                        setBeforeSuggestion(w.surcharge);
                        setW((c) => ({ ...c, surcharge: sug.surcharge }));
                      }}
                    >
                      Set {money(sug.surcharge)}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {oc ? (
            <section aria-label={`${def.name} costing`} className="mt-3 rounded-2xl bg-surface-2 p-4" data-testid={`option-costing-${def.id}`}>
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
        </Step>

        {/* 4 Note */}
        <Step n={4} title="Note (Optional)" help="The kitchen sees this wording. Add your own note if it helps.">
          <div className="rounded-2xl bg-fill px-3.5 py-3" data-testid="option-wording">
            <p className="text-[13px] text-label-2">The kitchen sees</p>
            <p className="mt-0.5 text-[17px] leading-snug sm:text-[15px]">{wording || <span className="text-label-2">Nothing yet.</span>}</p>
          </div>
          <textarea
            rows={2}
            className="field mt-2 resize-none"
            placeholder="Extra note, e.g. Ask for no cheese"
            aria-label={`Extra note for ${def.name}`}
            value={w.note}
            enterKeyHint="done"
            onChange={(e) => setW((c) => ({ ...c, note: e.target.value.replace(/\n/g, " ") }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
        </Step>

        {/* the one primary action */}
        {/* sticks to the very bottom of the sheet: the negative offset cancels the scroll area's own bottom padding so nothing shows beneath it */}
        <div
          className="sticky -mx-4 mt-6 border-t-[0.5px] border-sep bg-[color:var(--sheet-bg)] px-4 pt-3"
          style={{ bottom: "calc(-1 * max(1rem, env(safe-area-inset-bottom)))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          data-testid="option-sheet-footer"
        >
          {!canDone ? <p className="mb-2 text-[13px] text-label-2">{OPTION_EMPTY_REASON}</p> : null}
          <button type="button" className="btn-primary !min-h-[44px] w-full" disabled={!canDone} onClick={() => onDone(toEntry(initial, w))}>
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
