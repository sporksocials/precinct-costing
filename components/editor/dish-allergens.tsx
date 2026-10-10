"use client";

import React, { useState } from "react";
import { Check, CircleCheck, TriangleAlert } from "lucide-react";
import { allergenLabel, type AllergenId } from "@/lib/allergens";
import { sameValue } from "@/lib/draft-changes";
import {
  DISH_ALLERGEN_IDS,
  NOTE_MAX,
  applyProposal,
  confirmAllergens,
  isConfirmed,
  proposeContains,
  readDishAllergens,
  reviewMissing,
  reviewWarningText,
  setWithoutNote,
  toggleAllergen,
  type EditResult,
} from "@/lib/dish-allergens";
import { dateWithYear } from "@/lib/record-created";
import { useStore } from "@/lib/store";
import type { MenuItem, RecipeLine } from "@/lib/types";
import { cx, Group, useToast } from "../ui";
import { usePersonName } from "../use-person-name";
import { useBadgeModel } from "../allergen-picker";

/**
 * Dish Allergens (Troy, 10 Oct 2026): the dish's OWN allergens section, hand-listed by the chef when the dish is built. The
 * Allergy Matrix (/matrix, the printed sheet and the kitchen iPad) reads only this, the dish's marks and its options. It never
 * works anything out from ingredients, and there is no way to change a cell anywhere but here.
 *
 * Edits go through the recipe editor's draft (manual Save, leave guard, conflict check) like every other field. Any edit to
 * the ticks or a "can be made without" note after the dish was confirmed takes the confirmation away, in the draft, and says
 * so: the dish reads Not checked on the matrix until Confirm Allergens is pressed again and saved. Ingredients are used in
 * exactly two places, both prompts: Start From Ingredients (fills the ticks as a proposal the chef then edits) and the quiet
 * "Ingredients have changed" line. Neither can change the matrix by itself.
 */
export function DishAllergensGroup({ item, saved, lines, onPatch }: { item: MenuItem; saved: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void }) {
  const store = useStore();
  const toast = useToast();
  const nameOf = usePersonName();
  const ready = "dish_allergens" in item || "dish_allergens" in saved;
  const { r } = useBadgeModel("item", item, lines);
  const da = readDishAllergens(item.dish_allergens);
  const confirmed = isConfirmed(da);
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
    onPatch({ dish_allergens: confirmAllergens(item.dish_allergens, store.userEmail, new Date().toISOString()) });
    setCleared(false);
    toast.show({ message: "Confirmed. Save to put it on the matrix." });
  };

  const who = da?.confirmedBy ? nameOf(da.confirmedBy) ?? da.confirmedBy : null;
  const status = confirmed && da?.confirmedAt ? `Confirmed${who ? ` by ${who}` : ""} on ${dateWithYear(da.confirmedAt)}` : cleared ? "Changed. Not confirmed yet" : "Not confirmed yet";

  return (
    <Group
      title="Dish Allergens"
      className="mt-6"
      trailing={
        confirmed ? (
          <span className="inline-flex items-center gap-1 pb-0.5 text-[13px] font-medium text-good">
            <CircleCheck aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} /> Confirmed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 pb-0.5 text-[13px] font-medium text-warn">
            <TriangleAlert aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} /> Not confirmed
          </span>
        )
      }
      footer="Listed by hand when the dish is built, as the menu describes it. The Allergy Matrix reads this and nothing else, so the matrix never guesses from the ingredients."
    >
      <div className="space-y-5 px-4 py-4">
        {!ready ? <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">Dish allergens can’t be saved until the database has its dish allergens update.</p> : null}

        <div>
          <p className="text-[15px] font-medium sm:text-[13px]">{status}</p>
          <p className="mt-0.5 text-[13px] text-label-2">
            {confirmed ? (dirty ? "Save to keep this on the matrix." : "This dish shows its real answers on the matrix.") : "Until it is confirmed, this dish shows Not Checked on the matrix."}
          </p>
        </div>

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
              Confirm Allergens
            </button>
          ) : null}
        </div>
        <p className="text-[13px] text-label-2">Start From Ingredients fills the ticks as a first guess for you to correct. It saves nothing and never confirms.</p>
      </div>
    </Group>
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
