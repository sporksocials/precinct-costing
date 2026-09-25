"use client";

import { useMemo, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  ALLERGENS,
  ALLERGEN_NOTICE,
  ANIMAL_FLAGS,
  ANIMAL_LABELS,
  allergenLabel,
  allergensReady,
  ingredientAllergenState,
  rollup,
  withDraft,
  type AllergenId,
  type AllergenIndex,
  type AnimalFlag,
  type DietTag,
} from "@/lib/allergens";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";
import { Banner, cx, Group, Sheet } from "./ui";

/** The costing index plus menu items by id, for allergen roll-ups (virtual gelato and beer items included). */
export function useAllergenIndex(): AllergenIndex {
  const { index, items } = useStore();
  return useMemo(() => ({ ...index, items: new Map(items.map((i) => [i.id, i])) }), [index, items]);
}

function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/column|schema cache|allergen|diet_flags/i.test(m)) return "Couldn’t save the allergens. The database still needs its allergen update, so nothing has changed.";
  return "Couldn’t save the allergens. Check your connection and try again.";
}

const PENDING_NOTE = "Allergen ticks can’t be saved until the database has its allergen update. Suggestions are shown for now.";

type ChipState = "on" | "suggested" | "off" | "locked";

/** A tick chip: filled = confirmed, dashed amber = suggested (one tap confirms), plain = not ticked. 44px on phones. */
function TickChip({ label, state, onClick, hint, disabled }: { label: string; state: ChipState; onClick?: () => void; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={state === "on" || state === "locked"}
      aria-label={state === "suggested" ? `${label}: suggested${hint ? ` from ${hint}` : ""}. Tap to confirm` : label}
      title={hint}
      disabled={disabled || state === "locked"}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition-[background-color,color,transform] duration-200 ease-ios active:scale-[0.97] disabled:cursor-default sm:min-h-[34px] sm:px-3 sm:text-[14px]",
        state === "on" && "bg-accent-fill text-accent-on",
        state === "locked" && "bg-accent-soft text-accent",
        state === "suggested" && "border border-dashed border-[color:var(--warn)] bg-warn-soft text-warn",
        state === "off" && "bg-fill text-label hover:bg-fill-2",
        disabled && state !== "on" && state !== "locked" && "opacity-50",
      )}
    >
      {state === "on" || state === "locked" ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
      {label}
      {state === "suggested" ? <span className="text-[12px] font-semibold">Suggested</span> : null}
    </button>
  );
}

function ChipGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="pb-2 text-[13px] font-medium text-label-2">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- ingredient */

/**
 * Tick an ingredient's allergens. Suggestions come from the name (and the supplier's description when known) and stay
 * "suggested" until someone confirms them. Mark As Reviewed says a person has looked: only then can a dish be "free from".
 */
export function IngredientAllergenEditor({ ing, description }: { ing: Ingredient; description?: string | null }) {
  const store = useStore();
  const [error, setError] = useState<string | null>(null);
  const ready = allergensReady(ing);
  const st = ingredientAllergenState(ing, description);
  const suggestedIds = st.suggested.map((s) => s.id);
  const kw = (id: AllergenId) => st.suggested.find((s) => s.id === id)?.keyword;
  const suggestedDiet = st.suggestedAnimal.filter((s) => s.flag === "meat" || s.flag === "honey");

  const save = async (patch: Partial<Ingredient>) => {
    setError(null);
    try {
      await store.updateIngredient(ing.id, patch);
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  const tick = (id: AllergenId) => void save({ allergens: st.confirmed.includes(id) ? st.confirmed.filter((x) => x !== id) : [...st.confirmed, id] });
  const tickFlag = (f: AnimalFlag) => void save({ diet_flags: st.tickedAnimal.includes(f) ? st.tickedAnimal.filter((x) => x !== f) : [...st.tickedAnimal, f] });
  const confirmAll = () =>
    void save({ allergens: [...new Set([...st.confirmed, ...suggestedIds])], diet_flags: [...new Set([...st.tickedAnimal, ...suggestedDiet.map((s) => s.flag)])] });

  const allergenChip = (id: AllergenId, label: string) => {
    const state: ChipState = st.confirmed.includes(id) ? "on" : suggestedIds.includes(id) ? "suggested" : "off";
    return <TickChip key={id} label={label} state={state} hint={state === "suggested" ? `“${kw(id)}”` : undefined} disabled={!ready} onClick={() => tick(id)} />;
  };
  const nSuggest = suggestedIds.length + suggestedDiet.length;

  return (
    <div>
      {!ready ? <p className="mb-3 rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">{PENDING_NOTE}</p> : null}
      {error ? <Banner>{error}</Banner> : null}
      <p className={cx("mb-3 flex items-center gap-1.5 text-[15px] font-medium", st.reviewed ? "text-good" : "text-warn")}>
        {st.reviewed ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : <TriangleAlert aria-hidden className="h-4 w-4" strokeWidth={2.5} />}
        {st.reviewed ? "Reviewed" : "Not reviewed yet"}
      </p>
      <ChipGroup title="Required">{ALLERGENS.filter((a) => a.group === "required").map((a) => allergenChip(a.id, a.label))}</ChipGroup>
      <ChipGroup title="Chef Extras">{ALLERGENS.filter((a) => a.group === "extra").map((a) => allergenChip(a.id, a.label))}</ChipGroup>
      <ChipGroup title="Diet">
        {ANIMAL_FLAGS.map((f) => {
          const implied = st.confirmedAnimal.includes(f) && !st.tickedAnimal.includes(f);
          const isSug = suggestedDiet.some((s) => s.flag === f);
          const state: ChipState = implied ? "locked" : st.tickedAnimal.includes(f) ? "on" : isSug ? "suggested" : "off";
          return <TickChip key={f} label={ANIMAL_LABELS[f]} state={state} hint={implied ? "Set by the allergen ticks" : undefined} disabled={!ready} onClick={() => tickFlag(f)} />;
        })}
      </ChipGroup>
      <p className="mt-2 text-[13px] text-label-2">Animal products decide Vegetarian and Vegan. Dairy, egg and fish follow the allergen ticks; tick Meat or Honey here.</p>

      {nSuggest > 0 && !st.reviewed ? (
        <p className="mt-3 text-[13px] text-label-2">
          Suggested from the name: {[...st.suggested.map((s) => `${allergenLabel(s.id)} (${s.keyword})`), ...suggestedDiet.map((s) => `${ANIMAL_LABELS[s.flag]} (${s.keyword})`)].join(", ")}. Tap a dashed chip to confirm it.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {nSuggest > 0 && !st.reviewed ? (
          <button type="button" className="btn-tinted w-full sm:w-auto" disabled={!ready} onClick={confirmAll}>
            Confirm All ({nSuggest})
          </button>
        ) : null}
        {st.reviewed ? (
          <button type="button" className="btn-plain w-full sm:w-auto" disabled={!ready} onClick={() => void save({ allergens_reviewed: false })}>
            Review Again
          </button>
        ) : (
          <button type="button" className="btn-primary w-full sm:w-auto" disabled={!ready} onClick={() => void save({ allergens_reviewed: true })}>
            Mark As Reviewed
          </button>
        )}
      </div>
      {!st.reviewed ? <p className="mt-2 text-[13px] text-label-2">Marking as reviewed means the ticks above are right, and clears any suggestion you did not confirm.</p> : null}
      <p className="mt-2 text-[13px] text-label-3">{ALLERGEN_NOTICE}</p>
    </div>
  );
}

/** The ingredient page's Allergens section. */
export function IngredientAllergensSection({ ing }: { ing: Ingredient }) {
  const { portalPrices, supplierById } = useStore();
  const description = useMemo(() => {
    if (!portalPrices || !ing.supplier_code) return null;
    const sup = (supplierById.get(ing.supplier_id ?? -1)?.name ?? "").toLowerCase();
    return portalPrices.find((p) => p.product_code === ing.supplier_code && (!sup || (p.supplier ?? "").toLowerCase() === sup))?.description ?? null;
  }, [portalPrices, supplierById, ing.supplier_code, ing.supplier_id]);
  return (
    <Group title="Allergens" className="mt-7 lg:mt-5">
      <div className="px-4 py-4">
        <IngredientAllergenEditor ing={ing} description={description} />
      </div>
    </Group>
  );
}

/* ---------------------------------------------------------------- dish / prep */

const pill = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold";

export function DietPill({ tag }: { tag: DietTag }) {
  const map = {
    yes: { cls: "bg-good-soft text-good", text: "Yes" },
    no: { cls: "bg-danger-soft text-danger", text: "No" },
    maybe: { cls: "border border-dashed border-[color:var(--warn)] bg-warn-soft text-warn", text: "Probably not" },
    unknown: { cls: "bg-fill text-label-2", text: "Not reviewed" },
  }[tag.state];
  return (
    <span className={cx(pill, map.cls)} title={tag.because.length ? `Because of ${tag.because.join(", ")}` : undefined}>
      {tag.label}: {map.text}
    </span>
  );
}

type Rec = MenuItem | Prep;

/**
 * Allergens for a dish or prep: rolled up from its ingredients (nested preps included), live as lines are added.
 * The chef can add or remove an allergen and write a "made without" note. Anything not reviewed is flagged, and
 * nothing here ever says "free from".
 */
export function RecipeAllergens({ kind, rec, lines, setDraft }: { kind: "item" | "prep"; rec: Rec; lines: RecipeLine[]; setDraft: (fn: (d: Rec) => Rec) => void }) {
  const store = useStore();
  const base = useAllergenIndex();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const ready = allergensReady(rec);
  const idx = useMemo(() => withDraft(base, kind, rec, lines), [base, kind, rec, lines]);
  const r = useMemo(() => rollup({ kind, id: rec.id }, idx), [idx, kind, rec.id]);

  const add = rec.allergen_add ?? [];
  const notes = rec.allergen_notes ?? {};
  const setAdd = (id: AllergenId, on: boolean) =>
    setDraft((d) => ({ ...d, allergen_add: on ? [...new Set([...(d.allergen_add ?? []), id])] : (d.allergen_add ?? []).filter((x) => x !== id), allergen_remove: (d.allergen_remove ?? []).filter((x) => x !== id) }));
  const setRemove = (id: AllergenId, on: boolean) =>
    setDraft((d) => ({ ...d, allergen_remove: on ? [...new Set([...(d.allergen_remove ?? []), id])] : (d.allergen_remove ?? []).filter((x) => x !== id), allergen_add: (d.allergen_add ?? []).filter((x) => x !== id) }));
  const setNote = (id: AllergenId, text: string) =>
    setDraft((d) => {
      const n = { ...(d.allergen_notes ?? {}) };
      if (text.trim()) n[id] = text.trim();
      else delete n[id];
      return { ...d, allergen_notes: n };
    });

  const rows = ALLERGENS.filter((a) => r.cells[a.id].state !== "none");
  const cleared = ALLERGENS.filter((a) => r.cells[a.id].state === "none" && r.cells[a.id].chef === "removed");
  const addable = ALLERGENS.filter((a) => r.cells[a.id].state === "none" && r.cells[a.id].chef !== "removed");
  const toReview = r.unreviewedIngredients;
  const shown = showAll ? toReview : toReview.slice(0, 6);
  const btn = "btn-plain !min-h-[44px] !px-3 !text-[14px] sm:!min-h-[34px]";

  return (
    <Group
      title="Allergens"
      className="mt-6"
      trailing={r.reviewed ? <span className="pb-0.5 text-[13px] font-medium text-good">All ingredients reviewed</span> : null}
      footer={ALLERGEN_NOTICE}
    >
      <div className="space-y-4 px-4 py-4">
        {!ready ? <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">{PENDING_NOTE}</p> : null}

        {r.ingredientCount === 0 ? (
          <p className="text-[15px] text-label-2">Add ingredients and their allergens appear here as you build. Nothing is marked free from until every ingredient is reviewed.</p>
        ) : !r.reviewed ? (
          <div className="flex items-start gap-2.5 rounded-xl bg-warn-soft px-3 py-2.5 text-warn">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
            <div className="min-w-0 text-[14px]">
              <p className="font-semibold">
                {r.unreviewedCount} {r.unreviewedCount === 1 ? "ingredient" : "ingredients"} not reviewed
              </p>
              <p className="mt-0.5 text-[13px]">
                {r.unreviewed.slice(0, 5).join(", ")}
                {r.unreviewed.length > 5 ? ` and ${r.unreviewed.length - 5} more` : ""}. Anything not listed below may still apply.
              </p>
            </div>
          </div>
        ) : null}

        {rows.length ? (
          <ul className="divide-y divide-[color:var(--separator)]">
            {rows.map((a) => {
              const c = r.cells[a.id];
              const chefAdded = add.includes(a.id);
              return (
                <li key={a.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[17px] font-medium sm:text-[15px]">{a.label}</span>
                        <span className={cx(pill, c.state === "contains" ? "bg-danger-soft text-danger" : "border border-dashed border-[color:var(--warn)] bg-warn-soft text-warn")}>
                          {c.state === "contains" ? "Contains" : "May contain (unconfirmed)"}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[13px] text-label-2">{c.sources.length ? `From ${c.sources.map((s) => (s === "Chef" ? "the chef" : s)).join(", ")}` : ""}</span>
                    </span>
                    <span className="flex gap-2">
                      {c.state === "may_contain" ? (
                        <button type="button" className={btn} disabled={!ready} onClick={() => setAdd(a.id, true)}>
                          Confirm
                        </button>
                      ) : null}
                      {chefAdded ? (
                        <button type="button" className={btn} disabled={!ready} onClick={() => setAdd(a.id, false)}>
                          Undo Add
                        </button>
                      ) : (
                        <button type="button" className={btn} disabled={!ready} onClick={() => setRemove(a.id, true)}>
                          {c.state === "may_contain" ? "Clear" : "Remove"}
                        </button>
                      )}
                    </span>
                  </div>
                  <NoteField label={a.label} value={notes[a.id] ?? ""} disabled={!ready} onCommit={(t) => setNote(a.id, t)} />
                </li>
              );
            })}
          </ul>
        ) : r.ingredientCount > 0 ? (
          <p className="text-[15px] text-label-2">{r.reviewed ? "No allergens ticked on any ingredient." : "No allergens found so far."}</p>
        ) : null}

        {cleared.length ? (
          <div>
            <p className="pb-1.5 text-[13px] font-medium text-label-2">Cleared By The Chef</p>
            {cleared.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                <span className="min-w-0 flex-1 text-[15px]">
                  <span className="line-through decoration-label-3">{a.label}</span>
                  <span className="text-[13px] text-label-2">{r.cells[a.id].was.length ? ` · was from ${r.cells[a.id].was.join(", ")}` : ""}</span>
                </span>
                <button type="button" className={btn} disabled={!ready} onClick={() => setRemove(a.id, false)}>
                  Undo
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div>
          <p className="pb-2 text-[13px] font-medium text-label-2">Add An Allergen</p>
          <div className="flex flex-wrap gap-2">
            {addable.map((a) => (
              <TickChip key={a.id} label={a.label} state="off" disabled={!ready} onClick={() => setAdd(a.id, true)} />
            ))}
            {addable.length === 0 ? <span className="text-[13px] text-label-2">Every allergen is already listed above.</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <DietPill tag={r.diet.vegetarian} />
          <DietPill tag={r.diet.vegan} />
        </div>

        {toReview.length ? (
          <div>
            <p className="pb-1.5 text-[13px] font-medium text-label-2">Ingredients To Review</p>
            <ul className="divide-y divide-[color:var(--separator)] rounded-xl bg-fill">
              {shown.map((i) => {
                const ing = store.index.ingredients.get(i.id);
                return ing ? <ReviewRow key={i.id} ing={ing} ready={ready} onReview={() => setReviewing(i.id)} /> : null;
              })}
            </ul>
            {toReview.length > 6 ? (
              <button type="button" className="btn-text mt-1" onClick={() => setShowAll((x) => !x)}>
                {showAll ? "Show Fewer" : `Show All (${toReview.length})`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {reviewing && store.index.ingredients.get(reviewing) ? (
        <Sheet open onClose={() => setReviewing(null)} title={store.index.ingredients.get(reviewing)!.name} cancelLabel="Done">
          <div className="pb-2 pt-3">
            <IngredientAllergenEditor ing={store.index.ingredients.get(reviewing)!} />
          </div>
        </Sheet>
      ) : null}
    </Group>
  );
}

/** An ingredient still to review: its suggestions as dashed chips (one tap confirms) and a Review button. */
function ReviewRow({ ing, ready, onReview }: { ing: Ingredient; ready: boolean; onReview: () => void }) {
  const store = useStore();
  const [error, setError] = useState<string | null>(null);
  const st = ingredientAllergenState(ing);
  const confirm = async (id: AllergenId) => {
    setError(null);
    try {
      await store.updateIngredient(ing.id, { allergens: [...new Set([...st.confirmed, id])] });
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{ing.name}</span>
          <span className="block text-[13px] text-label-2">{st.suggested.length ? "Suggested from the name. Tap to confirm." : "No suggestions from the name."}</span>
        </span>
        <button type="button" className="btn-tinted !min-h-[44px] !px-3 !text-[14px] sm:!min-h-[34px]" onClick={onReview}>
          Review
        </button>
      </div>
      {st.suggested.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {st.suggested.map((s) => (
            <TickChip key={s.id} label={allergenLabel(s.id)} state="suggested" hint={`“${s.keyword}”`} disabled={!ready} onClick={() => void confirm(s.id)} />
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </li>
  );
}

function NoteField({ label, value, onCommit, disabled }: { label: string; value: string; onCommit: (t: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      className="field mt-2 !py-2.5"
      placeholder="Made without, e.g. no aioli"
      aria-label={`Made without note for ${label}`}
      value={text}
      disabled={disabled}
      enterKeyHint="done"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
