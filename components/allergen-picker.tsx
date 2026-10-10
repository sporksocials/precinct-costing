"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  ALLERGENS,
  ALLERGEN_NOTICE,
  CONTAINS_IDS,
  ANIMAL_FLAGS,
  ANIMAL_LABELS,
  allergenLabel,
  allergensReady,
  ingredientAllergenState,
  isSeafoodAllergen,
  rollup,
  withDraft,
  type AllergenId,
  type AllergenIndex,
  type AnimalFlag,
  type Rollup,
} from "@/lib/allergens";
import { allergenNote, remainingProposals, type AllergenAssistResult } from "@/lib/allergen-assist";
import { requestAllergenSuggestions } from "@/lib/allergen-assist-client";
import { badgeModel, DRINK_ALLERGEN_IDS, isDrinkItem, showsAllergen, type BadgeModel } from "@/lib/allergen-badges";
import { BADGE_LABELS } from "@/lib/diet-legend";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";
import { BadgePanel } from "./allergen-badges";
import { friendlyError, portalDescription, proposalLabel, ReasonLines, toAssistIngredient, UnreviewedSuggestions } from "./allergen-suggest";
import { Banner, cx, Group, Segmented, Sheet, Toggle, useToast } from "./ui";

/** The costing index plus menu items by id, for allergen roll-ups (virtual gelato and beer items included). */
export function useAllergenIndex(): AllergenIndex {
  const { index, items } = useStore();
  return useMemo(() => ({ ...index, items: new Map(items.map((i) => [i.id, i])) }), [index, items]);
}

/** The roll-up and badge model for the recipe being edited (live as lines change). */
export function useBadgeModel(kind: "item" | "prep", rec: MenuItem | Prep, lines: RecipeLine[]): { r: Rollup; model: BadgeModel } {
  const base = useAllergenIndex();
  const idx = useMemo(() => withDraft(base, kind, rec, lines), [base, kind, rec, lines]);
  const r = useMemo(() => rollup({ kind, id: rec.id }, idx), [idx, kind, rec.id]);
  const model = useMemo(() => badgeModel(r, kind === "item" ? (rec as MenuItem) : null), [r, kind, rec]);
  return { r, model };
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
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [smart, setSmart] = useState<AllergenAssistResult | null>(null);
  const [asking, setAsking] = useState(false);
  const run = useRef(0);
  const results = useRef<HTMLDivElement>(null);
  const ready = allergensReady(ing);
  const st0 = ingredientAllergenState(ing, description);
  // alcohol is not an allergen: never suggested (sulphites and nitrites are main allergens and are)
  const st = { ...st0, suggested: st0.suggested.filter((x) => CONTAINS_IDS.includes(x.id)) };
  const heurIds = st.suggested.map((s) => s.id);
  const heurDiet = st.suggestedAnimal.filter((s) => s.flag === "meat" || s.flag === "honey");
  // Smart Tidy's proposals for this ingredient (only what is still unticked). They only PROPOSE: they show as suggested chips and nothing is saved until a person confirms.
  const asked = smart && smart.items[0]?.key === ing.id ? smart : null;
  const proposals = asked ? remainingProposals(ing, asked.items[0]) : { allergens: [], diet: [] };
  const smartReason = (id: AllergenId) => proposals.allergens.find((a) => a.id === id)?.reason;
  const suggestedIds = [...new Set([...heurIds, ...proposals.allergens.map((a) => a.id)])];
  const suggestedFlags = [...new Set([...heurDiet.map((s) => s.flag), ...proposals.diet.map((d) => d.flag)])];
  const kw = (id: AllergenId) => st.suggested.find((s) => s.id === id)?.keyword;

  const save = async (patch: Partial<Ingredient>): Promise<boolean> => {
    setError(null);
    try {
      await store.updateIngredient(ing.id, patch);
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    }
  };
  const tick = (id: AllergenId) => void save({ allergens: st.confirmed.includes(id) ? st.confirmed.filter((x) => x !== id) : [...st.confirmed, id] });
  const tickFlag = (f: AnimalFlag) => void save({ diet_flags: st.tickedAnimal.includes(f) ? st.tickedAnimal.filter((x) => x !== f) : [...st.tickedAnimal, f] });
  const labelsOf = (ids: AllergenId[], flags: AnimalFlag[]) => [...ids.map(proposalLabel), ...flags.map((f) => ANIMAL_LABELS[f])];
  const confirmAll = async () => {
    const previous = { allergens: ing.allergens ?? [], diet_flags: ing.diet_flags ?? [] };
    const ok = await save({ allergens: [...new Set([...st.confirmed, ...suggestedIds])], diet_flags: [...new Set([...(ing.diet_flags ?? []), ...suggestedFlags])] });
    if (!ok) return;
    const update = store.updateIngredient;
    toast.show(
      {
        message: `Ticked ${labelsOf(suggestedIds, suggestedFlags).join(", ")} on ${ing.name}`,
        action: { label: "Undo", onClick: () => void update(ing.id, previous).catch((e) => setError(friendlyError(e))) },
      },
      8000,
    );
  };
  const suggest = async () => {
    const token = ++run.current;
    setError(null);
    setAsking(true);
    const res = await requestAllergenSuggestions([toAssistIngredient(ing, description)]);
    if (run.current !== token) return;
    setAsking(false);
    setSmart(res);
  };
  useEffect(() => {
    if (asked) results.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [asked]);

  const allergenChip = (id: AllergenId, label: string) => {
    const state: ChipState = st.confirmed.includes(id) ? "on" : suggestedIds.includes(id) ? "suggested" : "off";
    const hint = state !== "suggested" ? undefined : kw(id) ? `“${kw(id)}”` : smartReason(id);
    return <TickChip key={id} label={label} state={state} hint={hint} disabled={!ready} onClick={() => tick(id)} />;
  };
  const nSuggest = suggestedIds.length + suggestedFlags.length;
  const used = store.usedIn("ingredient", ing.id);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const hasSeafood = st.confirmed.some(isSeafoodAllergen);
  const seafoodReady = ready && ("seafood_origin" in ing || "seafood_exempt" in ing);

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
      {hasSeafood ? <SeafoodOriginEditor ing={ing} ready={seafoodReady} save={save} /> : null}
      <ChipGroup title="Diet">
        {ANIMAL_FLAGS.map((f) => {
          const implied = st.confirmedAnimal.includes(f) && !st.tickedAnimal.includes(f);
          const isSug = suggestedFlags.includes(f);
          const state: ChipState = implied ? "locked" : st.tickedAnimal.includes(f) ? "on" : isSug ? "suggested" : "off";
          return <TickChip key={f} label={ANIMAL_LABELS[f]} state={state} hint={implied ? "Set by the allergen ticks" : undefined} disabled={!ready} onClick={() => tickFlag(f)} />;
        })}
      </ChipGroup>
      <p className="mt-2 text-[13px] text-label-2">Animal products decide Vegetarian and Vegan. Dairy, egg and fish follow the allergen ticks; tick Meat or Honey here.</p>

      {st.suggested.length + heurDiet.length > 0 && !st.reviewed ? (
        <p className="mt-3 text-[13px] text-label-2">
          Suggested from the name: {[...st.suggested.map((s) => `${allergenLabel(s.id)} (${s.keyword})`), ...heurDiet.map((s) => `${ANIMAL_LABELS[s.flag]} (${s.keyword})`)].join(", ")}. Tap a dashed chip to confirm it.
        </p>
      ) : null}

      {asking ? (
        <p role="status" className="mt-4 text-[15px] text-label-2">
          Checking the name…
        </p>
      ) : null}
      {asked ? (
        <div ref={results} className="mt-4 rounded-xl bg-fill px-3 py-3" aria-live="polite" data-testid="suggest-results">
          <p className="text-[13px] font-medium text-label-2">{allergenNote(asked)}</p>
          {proposals.allergens.length + proposals.diet.length ? (
            <>
              <ReasonLines proposals={proposals} className="mt-2" />
              <p className="mt-2 text-[13px] text-label-2">
                Confirm All ticks {labelsOf(suggestedIds, suggestedFlags).join(", ")} on this ingredient. It is used in {plural(used.items.length, "dish", "dishes")} and {plural(used.preps.length, "prep", "preps")}, so their allergen badges will change. Nothing is saved until you confirm, and this ingredient is not marked as reviewed.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[15px] text-label">Nothing new to suggest from the name. The ticks above are all the name points to.</p>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className="btn-tinted w-full sm:w-auto sm:whitespace-nowrap" disabled={!ready || asking} onClick={() => void suggest()}>
          Suggest Allergens
        </button>
        {nSuggest > 0 ? (
          <button type="button" className="btn-tinted w-full sm:w-auto sm:whitespace-nowrap" disabled={!ready} onClick={() => void confirmAll()}>
            Confirm All ({nSuggest})
          </button>
        ) : null}
        {st.reviewed ? (
          <button type="button" className="btn-plain w-full sm:w-auto sm:whitespace-nowrap" disabled={!ready} onClick={() => void save({ allergens_reviewed: false })}>
            Review Again
          </button>
        ) : (
          <button type="button" className="btn-primary w-full sm:w-auto sm:whitespace-nowrap" disabled={!ready} onClick={() => void save({ allergens_reviewed: true })}>
            Mark As Reviewed
          </button>
        )}
      </div>
      {!st.reviewed ? <p className="mt-2 text-[13px] text-label-2">Marking as reviewed means the ticks above are right, and clears any suggestion you did not confirm.</p> : null}
      <p className="mt-2 text-[13px] text-label-3">{ALLERGEN_NOTICE}</p>
    </div>
  );
}

/**
 * Seafood origin for an ingredient with fish, crustacea or molluscs ticked: Australian, Imported (New Zealand counts as
 * imported) or Not Set, plus an exemption for seafood the origin standard leaves out (fish sauce, canned tuna, bonito powder).
 */
function SeafoodOriginEditor({ ing, ready, save }: { ing: Ingredient; ready: boolean; save: (patch: Partial<Ingredient>) => Promise<unknown> }) {
  const exempt = !!ing.seafood_exempt;
  const origin = ing.seafood_origin === "A" || ing.seafood_origin === "I" ? ing.seafood_origin : "none";
  return (
    <div className="mt-4" role="group" aria-label="Seafood origin">
      <p className="pb-2 text-[13px] font-medium text-label-2">{BADGE_LABELS.seafoodOrigin}</p>
      {exempt ? (
        <p className="rounded-xl bg-fill px-3 py-2 text-[14px] text-label-2">No origin letter is needed while this is exempt.</p>
      ) : (
        <>
          <Segmented
            ariaLabel="Seafood origin"
            value={origin}
            onChange={(v) => {
              if (ready) void save({ seafood_origin: v === "none" ? null : v });
            }}
            options={[
              { value: "A", label: "Australian" },
              { value: "I", label: "Imported" },
              { value: "none", label: "Not Set" },
            ]}
          />
          <p className="mt-1.5 text-[13px] text-label-2">Where it was harvested, not where it was packed. New Zealand seafood is imported.</p>
        </>
      )}
      <div className="-mx-4 mt-1">
        <Toggle
          label="Exempt From Origin Label"
          sub="Liquid, powder or shelf-stable chopped seafood, such as fish sauce, canned tuna or bonito powder."
          checked={exempt}
          onChange={(v) => {
            if (ready) void save({ seafood_exempt: v });
          }}
        />
      </div>
    </div>
  );
}

/** The ingredient page's Allergens section. */
export function IngredientAllergensSection({ ing }: { ing: Ingredient }) {
  const { portalPrices, supplierById } = useStore();
  const description = useMemo(() => portalDescription(ing, portalPrices, supplierById), [ing, portalPrices, supplierById]);
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

type Rec = MenuItem | Prep;

/**
 * Allergens for a dish or prep: rolled up from its ingredients (nested preps included), live as lines are added.
 * The badge panel on top is the answer (tiers in a fixed order); below it the chef can add or remove an allergen and
 * write a "made without" note. Anything not reviewed is flagged first, and nothing here ever says "gluten free".
 */
export function RecipeAllergens({ kind, rec, lines, setDraft, readOnly, embedded }: { kind: "item" | "prep"; rec: Rec; lines: RecipeLine[]; setDraft?: (fn: (d: Rec) => Rec) => void; readOnly?: boolean; embedded?: boolean }) {
  const store = useStore();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const ready = allergensReady(rec);
  const { r, model } = useBadgeModel(kind, rec, lines);

  const add = rec.allergen_add ?? [];
  const notes = rec.allergen_notes ?? {};
  // readOnly (a food dish's "What The Ingredients Say" reference): nothing here edits the dish, so the edit helpers do nothing
  const draftFn = setDraft ?? (() => undefined);
  const setAdd = (id: AllergenId, on: boolean) =>
    draftFn((d) => ({ ...d, allergen_add: on ? [...new Set([...(d.allergen_add ?? []), id])] : (d.allergen_add ?? []).filter((x) => x !== id), allergen_remove: (d.allergen_remove ?? []).filter((x) => x !== id) }));
  const setRemove = (id: AllergenId, on: boolean) =>
    draftFn((d) => ({ ...d, allergen_remove: on ? [...new Set([...(d.allergen_remove ?? []), id])] : (d.allergen_remove ?? []).filter((x) => x !== id), allergen_add: (d.allergen_add ?? []).filter((x) => x !== id) }));
  const setNote = (id: AllergenId, text: string) =>
    draftFn((d) => {
      const n = { ...(d.allergen_notes ?? {}) };
      if (text.trim()) n[id] = text.trim();
      else delete n[id];
      return { ...d, allergen_notes: n };
    });

  // drinks mark only DRINK_ALLERGEN_IDS (egg, milk, nuts, sulphites): nothing else is listed, cleared or offered (Troy, 4 Oct 2026; sulphites added 10 Oct 2026)
  const drink = kind === "item" && isDrinkItem(rec as MenuItem);
  const marked = ALLERGENS.filter((a) => showsAllergen(kind === "item" ? (rec as MenuItem) : null, a.id));
  const rows = marked.filter((a) => r.cells[a.id].state !== "none");
  const cleared = marked.filter((a) => r.cells[a.id].state === "none" && r.cells[a.id].chef === "removed");
  const addable = marked.filter((a) => r.cells[a.id].state === "none" && r.cells[a.id].chef !== "removed");
  const toReview = useMemo(() => (model.listsAllergens ? r.unreviewedIngredients : []), [model.listsAllergens, r.unreviewedIngredients]);
  const unreviewed = useMemo(() => toReview.flatMap((i) => store.index.ingredients.get(i.id) ?? []), [toReview, store.index.ingredients]);
  const shown = showAll ? toReview : toReview.slice(0, 6);
  const btn = "btn-plain !min-h-[44px] !px-3 !text-[14px] sm:!min-h-[34px]";
  const item = kind === "item" ? (rec as MenuItem) : null;
  const pillFor = (a: (typeof ALLERGENS)[number], state: "contains" | "may_contain" | "none") => {
    if (a.group === "attribute") return { cls: "border border-[color:var(--label-3)] text-label-2", text: state === "contains" ? BADGE_LABELS.containsAlcohol : `${BADGE_LABELS.containsAlcohol} (unconfirmed)` };
    return state === "contains" ? { cls: "bg-danger-soft text-danger", text: "Contains" } : { cls: "border border-dashed border-[color:var(--warn)] bg-warn-soft text-warn", text: "May contain (unconfirmed)" };
  };

  // drinks carry no menu labels at all (GF, V, VG, GFO, VO, VGO, DFO and the seafood letters are for food), so there is nothing to show
  if (drink && !model.listsAllergens) return null;

  return (
    <Group
      title={embedded ? undefined : model.listsAllergens ? "Allergens" : "Menu Labels"}
      className={embedded ? "!mt-0" : "mt-6"}
      trailing={model.listsAllergens && r.reviewed ? <span className="pb-0.5 text-[13px] font-medium text-good">All ingredients reviewed</span> : null}
      footer={model.listsAllergens ? ALLERGEN_NOTICE : undefined}
    >
      <div className="space-y-5 px-4 py-4">
        {model.listsAllergens && !ready ? <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">{PENDING_NOTE}</p> : null}

        <BadgePanel model={model} seafoodLabel={!!item?.seafood_label} />

        {rows.length ? (
          <div>
            <p className="text-[13px] font-medium text-label-2">Sources And Changes</p>
            <p className="pb-1 text-[13px] text-label-2">Where each one comes from. Clear one the dish is made without, or add a note.</p>
            <ul className="divide-y divide-[color:var(--separator)]">
              {rows.map((a) => {
                const c = r.cells[a.id];
                const chefAdded = add.includes(a.id);
                const pl = pillFor(a, c.state);
                return (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[17px] font-medium sm:text-[15px]">{a.label}</span>
                          <span className={cx(pill, pl.cls)}>{pl.text}</span>
                        </span>
                        <span className="mt-0.5 block text-[13px] text-label-2">{c.sources.length ? `From ${c.sources.map((s) => (s === "Chef" ? "the chef" : s)).join(", ")}` : ""}</span>
                      </span>
                      {readOnly ? null : (
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
                      )}
                    </div>
                    {readOnly ? notes[a.id] ? <p className="mt-1 text-[13px] text-label-2">Note: {notes[a.id]}</p> : null : <NoteField label={a.label} value={notes[a.id] ?? ""} disabled={!ready} onCommit={(t) => setNote(a.id, t)} />}
                  </li>
                );
              })}
            </ul>
          </div>
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
                {readOnly ? null : (
                  <button type="button" className={btn} disabled={!ready} onClick={() => setRemove(a.id, false)}>
                    Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {model.listsAllergens && !readOnly ? (
        <div>
          <p className="pb-2 text-[13px] font-medium text-label-2">Add Allergen</p>
          <div className="flex flex-wrap gap-2">
            {addable.map((a) => (
              <TickChip key={a.id} label={a.label} state="off" disabled={!ready} onClick={() => setAdd(a.id, true)} />
            ))}
            {addable.length === 0 ? <span className="text-[13px] text-label-2">Everything is already listed above.</span> : null}
          </div>
        </div>
        ) : null}

        {toReview.length ? (
          <div>
            <p className="pb-1.5 text-[13px] font-medium text-label-2">Ingredients To Review</p>
            <UnreviewedSuggestions ingredients={unreviewed} ready={ready} drink={drink} onReview={setReviewing} />
            <ul className="divide-y divide-[color:var(--separator)] rounded-xl bg-fill">
              {shown.map((i) => {
                const ing = store.index.ingredients.get(i.id);
                return ing ? <ReviewRow key={i.id} ing={ing} ready={ready} drink={drink} onReview={() => setReviewing(i.id)} /> : null;
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
function ReviewRow({ ing, ready, drink, onReview }: { ing: Ingredient; ready: boolean; drink?: boolean; onReview: () => void }) {
  const store = useStore();
  const [error, setError] = useState<string | null>(null);
  const st0 = ingredientAllergenState(ing);
  // on a drink only DRINK_ALLERGEN_IDS (egg, milk, nuts, sulphites) are suggested; the rest stay recorded but are not offered here
  const st = { ...st0, suggested: st0.suggested.filter((s) => (drink ? DRINK_ALLERGEN_IDS : CONTAINS_IDS).includes(s.id)) };
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
