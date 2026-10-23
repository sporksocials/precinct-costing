"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { findIngredients, ingredientPriceSentence, type IngredientDoc, type IngredientLite } from "@/lib/invoice-questions-view";
import { TouchSearch } from "@/components/ordering/touch";

/**
 * "Search Ingredients": for a line none of the offered answers fit. Sits ABOVE the answer buttons so the phone keyboard
 * never hides what you are typing. Picking a result is the answer (it names the ingredient and shows its current price first).
 */
export function IngredientPicker({ docs, onPick, disabled }: { docs: readonly IngredientDoc[]; onPick: (ing: IngredientLite) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const query = useDeferredValue(text);
  const hits = useMemo(() => findIngredients(docs, query, 6), [docs, query]);
  const typed = query.trim().length >= 2;
  return (
    <div>
      <TouchSearch value={text} onChange={setText} placeholder="Search Ingredients" label="Search Ingredients" />
      {typed ? (
        hits.length ? (
          <ul className="mt-2 flex flex-col gap-2" aria-label="Ingredients that match">
            {hits.map((ing) => (
              <li key={ing.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(ing)}
                  className="flex min-h-[56px] w-full flex-col justify-center rounded-xl bg-accent-soft px-4 py-2.5 text-left text-accent transition active:scale-[0.99] active:opacity-80 disabled:pointer-events-none disabled:opacity-40"
                >
                  <span className="text-[17px] font-semibold leading-snug">{ing.name}</span>
                  <span className="mt-0.5 text-[13px] leading-snug opacity-80">{ingredientPriceSentence(ing)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 px-1 text-[15px] text-label-2">No ingredient matches that. Try a shorter word.</p>
        )
      ) : null}
    </div>
  );
}
