"use client";

import React, { useMemo, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { allergenLabel, withDraft, type AllergenId, type Rollup } from "@/lib/allergens";
import { sameValue } from "@/lib/draft-changes";
import {
  DISH_ALLERGEN_IDS,
  NOTE_MAX,
  applyProposal,
  chipHintLines,
  confirmAllergens,
  currentComponents,
  proposeContains,
  readDishAllergens,
  reviewMissing,
  reviewWarningText,
  setWithoutNote,
  signOffState,
  staleSignOffText,
  toggleAllergen,
  type EditResult,
  type SignOffState,
} from "@/lib/dish-allergens";
import { dateWithYear } from "@/lib/record-created";
import { useStore } from "@/lib/store";
import type { MenuItem, RecipeLine } from "@/lib/types";
import { cx, Disclosure, useToast } from "../ui";
import { usePersonName } from "../use-person-name";
import { RecipeAllergens, useAllergenIndex, useBadgeModel } from "../allergen-picker";
import { DietOptionsGroup } from "./diet-options";
import { SAFETY_CARD_ID, SafetyBlock, SafetyCard, SafetyStatus } from "./safety-card";

/** The id the Finish Setting Up checklist and the post-save nudge scroll to: the shared Allergens And Dietary card. */
export const DISH_ALLERGENS_ID = SAFETY_CARD_ID;

type Sign = ReturnType<typeof useDishSignOff>;

/**
 * Where a food dish's allergen sign-off stands RIGHT NOW in the editor: its own section, the components the draft is made from
 * (through every nested prep), and whether the sign-off is valid, changed since, legacy, or never made. One place, so the panel,
 * the checklist and the Active switch lock always agree (lib/dish-allergens.ts has the rule).
 */
export function useDishSignOff(item: MenuItem | null, lines: RecipeLine[]) {
  const base = useAllergenIndex();
  const linesByParent = useMemo(() => (item ? withDraft(base, "item", item, lines).linesByParent : base.linesByParent), [base, item, lines]);
  const components = useMemo(() => (item ? currentComponents("item", item.id, linesByParent) : []), [item, linesByParent]);
  const da = readDishAllergens(item?.dish_allergens);
  const state: SignOffState = signOffState(da, components);
  return { da, components, state };
}

/**
 * Dish Allergens (Troy, 10 Oct 2026): the dish's OWN allergens section, hand-listed by the chef when the dish is built. This is the
 * ONE allergen section on a food dish. The Allergy Matrix (/matrix, the printed sheet and the kitchen iPad) reads only this, the
 * dish's marks and its options. It never works anything out from ingredients, and there is no way to change a cell anywhere but here.
 *
 * Edits go through the recipe editor's draft (manual Save, leave guard, conflict check) like every other field. Any edit to the
 * ticks or a "can be made without" note after the dish was confirmed takes the confirmation away, in the draft, and says so.
 * A sign-off also stops counting when the dish's ingredients change (swap, add, remove, anywhere in the nesting): the panel then
 * says "Ingredients changed since <date>. Re-check and confirm again." and the dish reads Not Checked until it is confirmed again.
 * Ingredients are used only as hints and prompts: the faint "from: Soy Sauce" line under a chip, Start From Ingredients (fills the
 * ticks as a proposal the chef then edits) and the quiet "Ingredients have changed" line. None of them can change the matrix.
 * Below the panel, "What The Ingredients Say" keeps the worked-out roll-up as a collapsed read-only reference.
 */
function DishAllergensBlock({ item, saved, lines, onPatch, sign }: { item: MenuItem; saved: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void; sign: Sign }) {
  const store = useStore();
  const toast = useToast();
  const ready = "dish_allergens" in item || "dish_allergens" in saved;
  const { r } = useBadgeModel("item", item, lines);
  const { da, components, state } = sign;
  const confirmed = state === "valid";
  // the sign-off was taken away by an edit in this visit (so the panel can say why it reads Not confirmed)
  const [cleared, setCleared] = useState(false);
  const missing = confirmed ? reviewMissing(da, r) : [];
  const dirty = !sameValue(item.dish_allergens ?? null, saved.dish_allergens ?? null);

  const write = (res: EditResult) => {
    onPatch({ dish_allergens: res.next });
    if (res.clearedConfirmation) {
      setCleared(true);
      toast.show({ message: "Allergens changed, so the confirmation was cleared. Confirm Allergens again when you are done." });
    }
  };

  const startFromIngredients = () => {
    const prop = proposeContains(r);
    const before = item.dish_allergens ?? null;
    if (!prop.ids.length) {
      toast.show({ message: "The ingredients list no allergens yet. Tick them below if the dish has any." });
      return;
    }
    write(applyProposal(before, prop.ids));
    toast.show({
      message: prop.suggestedOnly.length
        ? `Filled in ${prop.ids.length} from the ingredients. ${prop.suggestedOnly.length} ${prop.suggestedOnly.length === 1 ? "is" : "are"} only a guess from the name. Check them.`
        : `Filled in ${prop.ids.length} from the ingredients. Check them, then confirm.`,
      action: { label: "Undo", onClick: () => onPatch({ dish_allergens: before }) },
    });
  };

  const confirm = () => {
    onPatch({ dish_allergens: confirmAllergens(item.dish_allergens, store.userEmail, new Date().toISOString(), components) });
    setCleared(false);
    toast.show({ message: "Confirmed. Save to put it on the matrix." });
  };

  const signedOn = da?.confirmedAt ? dateWithYear(da.confirmedAt) : "";
  const stale = staleSignOffText(state, signedOn);

  return (
    <SafetyBlock title="Dish Allergens" explain="What the menu says this dish contains. Signed off by a person." footer="Listed by hand when the dish is built, as the menu describes it. The Allergy Matrix reads this and nothing else, so the matrix never guesses from the ingredients.">
      <div className="space-y-5 px-4">
        {!ready ? <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">Dish allergens can’t be saved until the database has its dish allergens update.</p> : null}

        {stale ? (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] font-medium text-warn" role="status">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span>{stale}</span>
          </p>
        ) : cleared && !confirmed ? (
          <p className="text-[13px] font-medium text-warn">Changed. Confirm again when you are done.</p>
        ) : null}
        <p className="text-[13px] text-label-2">
          {confirmed ? (dirty ? "Save to keep this on the matrix." : "This dish shows its real answers on the matrix.") : "Until it is confirmed, this dish shows Not Checked on the matrix."}
        </p>

        {missing.length ? (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] font-medium text-warn" role="status">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span>{reviewWarningText(missing)}</span>
          </p>
        ) : null}

        <div>
          <p className="pb-2 text-[13px] font-medium text-label-2">Contains</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Allergens this dish contains">
            {DISH_ALLERGEN_IDS.map((id) => {
              const on = !!da?.contains.includes(id);
              return <AllergenChip key={id} id={id} on={on} disabled={!ready} onClick={() => write(toggleAllergen(item.dish_allergens, id, !on))} />;
            })}
          </div>
          <HintList r={r} />
        </div>

        {da && da.contains.length ? (
          <div>
            <p className="text-[13px] font-medium text-label-2">Can Be Made Without</p>
            <p className="pb-1 text-[13px] text-label-2">If the kitchen can leave one out, say how. That cell turns yellow on the matrix with your words in it.</p>
            <ul className="divide-y divide-[color:var(--separator)]">
              {da.contains.map((id) => (
                <li key={id} className="py-2.5">
                  <WithoutField id={id} value={da.without[id] ?? ""} disabled={!ready} onCommit={(t) => write(setWithoutNote(item.dish_allergens, id, t))} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {confirmed || !da || da.contains.length === 0 ? null : <p className="text-[13px] text-label-2">Check the ticks above against the menu, then confirm.</p>}
        {!da?.contains.length && ready ? <p className="text-[13px] text-label-2">Nothing is ticked. Confirming now says this dish contains none of them, and the matrix shows Yes for every allergen.</p> : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-plain !min-h-[44px] !px-4 !text-[15px]" disabled={!ready} onClick={startFromIngredients}>
            Start From Ingredients
          </button>
          {!confirmed ? (
            <button type="button" className="btn-primary !min-h-[44px] !px-4 !text-[15px]" disabled={!ready} onClick={confirm}>
              {stale ? "Confirm Again" : "Confirm Allergens"}
            </button>
          ) : null}
        </div>
        <p className="text-[13px] text-label-2">Start From Ingredients fills the ticks as a first guess for you to correct. It saves nothing and never confirms. The list under the chips says which ingredients point at an allergen.</p>
      </div>
    </SafetyBlock>
  );
}

/**
 * The whole food safety section of a food dish (Troy, 10 Oct 2026): ONE shared card, "Allergens And Dietary", holding Dish Allergens,
 * Dietary Marks and Dietary Options as sibling blocks (same headings, spacing, helper text and 44px controls), with a status line in
 * the header that says whether the section is done. Nothing is collapsed. Below it, "What The Ingredients Say" keeps the worked-out
 * roll-up as a collapsed read-only reference (the only collapsed thing).
 */
export function AllergensDietaryCard({ item, saved, lines, onPatch }: { item: MenuItem; saved: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void }) {
  const nameOf = usePersonName();
  const sign = useDishSignOff(item, lines);
  const { da, state } = sign;
  const signedOn = da?.confirmedAt ? dateWithYear(da.confirmedAt) : "";
  const who = da?.confirmedBy ? nameOf(da.confirmedBy) ?? da.confirmedBy : null;
  // the header says who and when once confirmed; when ingredients changed, the Dish Allergens block spells out the date and what to do
  const detail = state === "valid" ? `Confirmed${who ? ` by ${who}` : ""} on ${signedOn}` : null;
  return (
    <>
      <SafetyCard className="mt-7" status={<SafetyStatus state={state} detail={detail} />}>
        <DishAllergensBlock item={item} saved={saved} lines={lines} onPatch={onPatch} sign={sign} />
        <DietOptionsGroup item={item} lines={lines} onPatch={onPatch} card />
      </SafetyCard>
      <Disclosure title="What The Ingredients Say" hint="Worked out from the ingredients. A reference only: it does not change the matrix.">
        <RecipeAllergens kind="item" rec={item} lines={lines} readOnly embedded />
      </Disclosure>
    </>
  );
}

/**
 * "Where These Come From": under the chips, one plain line for each allergen the ingredients point at. Ticked = a person ticked it on
 * that ingredient. Name suggests = only the ingredient's name looks like it and nobody has checked. Replaces the faint text that sat
 * under each chip and pushed the chips out of line. Nothing here changes an answer.
 */
export function HintList({ r }: { r: Pick<Rollup, "cells"> }) {
  const lines = chipHintLines(r, DISH_ALLERGEN_IDS);
  if (!lines.length) return null;
  return (
    <div className="mt-3 rounded-xl bg-fill px-3 py-2.5">
      <p className="text-[13px] font-medium text-label-2">Where These Come From</p>
      <ul className="mt-1 space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="text-[13px] leading-snug text-label-2">
            <span className="font-semibold text-label">{l.label}</span>
            <span className="text-label-3"> · </span>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A tick chip, 44px at every width: filled with a check when on. */
function AllergenChip({ id, on, disabled, onClick }: { id: AllergenId; on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition-[background-color,color,transform] duration-200 ease-ios active:scale-[0.97] disabled:opacity-50",
        on ? "bg-accent-fill text-accent-on" : "bg-fill text-label hover:bg-fill-2",
      )}
    >
      {on ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
      {allergenLabel(id)}
    </button>
  );
}

/** "Can be made without" for one ticked allergen: commits on blur or Enter, like the other inline fields. */
function WithoutField({ id, value, disabled, onCommit }: { id: AllergenId; value: string; disabled?: boolean; onCommit: (t: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const label = allergenLabel(id);
  return (
    <label className="block">
      <span className="block pb-1 text-[15px] font-medium sm:text-[13px]">{label}</span>
      <input
        className="field !min-h-[44px]"
        placeholder="For example: no aioli"
        aria-label={`${label}: can be made without`}
        maxLength={NOTE_MAX}
        value={text}
        disabled={disabled}
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() !== value.trim()) onCommit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}
