"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { money } from "@/lib/format";
import { itemMeta, seenOn, type GroupSuggestion, type ItemGroup } from "@/lib/invoice-todo-match";
import type { Decision, IngredientDoc, IngredientLite } from "@/lib/invoice-questions-view";
import { TouchButton } from "@/components/ordering/touch";
import { cx } from "@/components/ui";
import { LinePicker } from "./q-picker";

/** The grid shared by the header and every row on a wide screen. */
export const ROW_GRID = "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,0.5fr)_minmax(0,2.4fr)]";

/**
 * One supplier item to match. Wide screens lay it out as a table row (item, seen on, last price, "In The App As" with its
 * actions beneath); a phone stacks the same parts. A suggestion is only a suggestion: it waits for "Use Suggestion" (or Accept
 * All Suggestions) and the item counts as chosen only once a person has chosen. Nothing here saves; Save Matches does.
 */
export function ItemRow({
  group,
  decision,
  suggestion,
  suggestedIngredient,
  chosenIngredient,
  candidates,
  docs,
  problem,
  disabled,
  today,
  detail,
  onDecide,
  onAddNew,
}: {
  group: ItemGroup;
  decision: Decision | undefined;
  suggestion: GroupSuggestion["suggestion"];
  /** the ingredient the suggestion names, when it is still in the app */
  suggestedIngredient: IngredientLite | null;
  /** the ingredient the person chose, when it is in the app's list */
  chosenIngredient: IngredientLite | null;
  candidates: readonly IngredientLite[];
  docs: readonly IngredientDoc[];
  problem: string | null;
  disabled: boolean;
  today: string;
  /** the conversion and new-name block, shown under the picker once an ingredient is chosen */
  detail?: ReactNode;
  onDecide: (d: Decision | null) => void;
  onAddNew: () => void;
}) {
  const usable = suggestion && suggestedIngredient ? suggestion : null;
  const shown = decision?.t === "ingredient" ? chosenIngredient : decision ? null : usable ? suggestedIngredient : null;
  const tag = decision?.t === "ingredient" ? (decision.via === "new" ? "New" : "Matched") : !decision && usable ? "Suggested" : null;
  const meta = itemMeta(group);
  const price = group.lastPriceEx != null ? `${money(group.lastPriceEx)}${group.unit ? ` per ${group.unit.toLowerCase()}` : ""}` : null;

  return (
    <li className={cx("grid gap-3 px-4 py-4 lg:gap-5", ROW_GRID)} aria-label={group.description}>
      <div className="min-w-0">
        <p className="break-words text-[17px] font-semibold leading-snug">{group.description}</p>
        {meta ? <p className="mt-0.5 break-words text-[13px] leading-snug text-label-2 tnum">{meta}</p> : null}
        {/* on a phone the two quiet facts sit under the name; wide screens give them their own columns */}
        <p className="mt-1 text-[13px] leading-snug text-label-2 lg:hidden">{[seenOn(group, today), price ? `${price}, ex GST` : null].filter(Boolean).join(" · ")}</p>
      </div>

      <p className="hidden text-[15px] leading-snug text-label-2 lg:block">{seenOn(group, today)}</p>
      <p className="hidden text-[15px] leading-snug text-label-2 tnum lg:block">{price ? <>{price}<span className="block text-[13px]">ex GST</span></> : "No price"}</p>

      <div className="min-w-0">
        {decision?.t === "none" ? (
          <div className="flex min-h-[56px] items-center rounded-xl bg-fill px-4 py-2 text-[17px] font-semibold text-label-2">Not In The App</div>
        ) : (
          <LinePicker
            shown={shown}
            tag={tag}
            candidates={candidates}
            docs={docs}
            label={group.description}
            disabled={disabled}
            onPick={(ing) => onDecide({ t: "ingredient", ingredientId: ing.id, name: ing.name, via: "pick" })}
          />
        )}
        {detail}
        {!decision && usable?.source === "ai" && usable.reason ? <p className="mt-1.5 px-1 text-[13px] leading-snug text-label-2">{usable.reason}</p> : null}

        <div className="mt-2">
          <div className="flex flex-wrap gap-2">
            {!decision && usable && suggestedIngredient ? (
              <TouchButton variant="primary" className="!px-3 !text-[15px]" disabled={disabled} onClick={() => onDecide({ t: "ingredient", ingredientId: suggestedIngredient.id, name: suggestedIngredient.name, via: "suggestion" })}>
                Use Suggestion
              </TouchButton>
            ) : null}
            {decision ? (
              <TouchButton variant="plain" className="!px-3 !text-[15px]" disabled={disabled} onClick={() => onDecide(null)}>
                Clear
              </TouchButton>
            ) : null}
            {decision?.t !== "none" ? (
              <TouchButton variant="plain" className="!px-3 !text-[15px]" disabled={disabled} onClick={() => onDecide({ t: "none" })}>
                Not In The App
              </TouchButton>
            ) : null}
            {decision?.t !== "ingredient" || decision.via !== "new" ? (
              <TouchButton variant="tinted" className="!px-3 !text-[15px]" disabled={disabled} onClick={onAddNew}>
                <Plus className="h-5 w-5" strokeWidth={2.25} aria-hidden />
                Add As New Ingredient
              </TouchButton>
            ) : null}
          </div>
        </div>
      </div>

      {problem ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger lg:col-span-4">
          {problem}
        </p>
      ) : null}
    </li>
  );
}
