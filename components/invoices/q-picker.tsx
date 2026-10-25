"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { findIngredients, ingredientPriceSentence, type IngredientDoc, type IngredientLite } from "@/lib/invoice-questions-view";
import { cx } from "@/components/ui";
import { TouchSearch } from "@/components/ordering/touch";

/**
 * "In The App As": one compact picker per invoice line. The closed button shows what the line is (or is suggested to be) with the
 * ingredient's current price; opening it shows the closest matches first and a search of every ingredient. The panel opens in the
 * flow of the page (not over it), so it never hides the row it belongs to or runs off a phone screen.
 */
export function LinePicker({
  shown,
  tag,
  candidates,
  docs,
  onPick,
  disabled,
  label,
}: {
  /** the ingredient the button shows: the choice, or the suggestion */
  shown: IngredientLite | null;
  /** a word beside the name: "Suggested" or "Matched" */
  tag: string | null;
  /** the closest matches, best first, offered before any typing */
  candidates: readonly IngredientLite[];
  docs: readonly IngredientDoc[];
  onPick: (ing: IngredientLite) => void;
  disabled?: boolean;
  /** names the control for screen readers: the invoice line it belongs to */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const query = useDeferredValue(text);
  const hits = useMemo(() => findIngredients(docs, query, 8), [docs, query]);
  const typed = query.trim().length >= 2;
  const panelId = useId();
  const box = useRef<HTMLDivElement>(null);

  // closing with Escape is what a keyboard user expects from an open list
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(ing: IngredientLite) {
    onPick(ing);
    setOpen(false);
    setText("");
  }

  const list = typed ? hits : candidates;
  return (
    <div ref={box}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Choose the ingredient for ${label}`}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex min-h-[56px] w-full items-center gap-3 rounded-xl px-4 py-2 text-left transition active:opacity-80 disabled:pointer-events-none disabled:opacity-50",
          shown ? "bg-accent-soft text-accent" : "bg-fill text-label",
        )}
      >
        <span className="min-w-0 flex-1">
          {shown ? (
            <>
              <span className="block break-words text-[17px] font-semibold leading-snug">
                {tag ? <span className="mr-2 rounded-md bg-surface px-1.5 py-0.5 align-middle text-[12px] font-semibold text-label-2">{tag}</span> : null}
                {shown.name}
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug opacity-80">{ingredientPriceSentence(shown)}</span>
            </>
          ) : (
            <span className="block text-[17px] font-semibold leading-snug text-label-2">Choose An Ingredient</span>
          )}
        </span>
        {open ? <ChevronUp className="h-5 w-5 shrink-0" strokeWidth={2.25} aria-hidden /> : <ChevronDown className="h-5 w-5 shrink-0" strokeWidth={2.25} aria-hidden />}
      </button>

      {open ? (
        <div id={panelId} className="mt-2 rounded-xl bg-surface-2 p-2">
          <TouchSearch value={text} onChange={setText} placeholder="Search Ingredients" label={`Search ingredients for ${label}`} />
          <p className="px-1 pb-1 pt-2 text-[13px] font-medium text-label-2">{typed ? "Matches From Your Search" : candidates.length ? "Closest Matches" : "Type At Least Two Letters"}</p>
          {list.length ? (
            <ul className="flex flex-col gap-1.5" aria-label={typed ? "Ingredients that match" : "Closest ingredients"}>
              {list.map((ing) => (
                <li key={ing.id}>
                  <button
                    type="button"
                    onClick={() => pick(ing)}
                    className="flex min-h-[56px] w-full flex-col justify-center rounded-xl bg-surface px-4 py-2 text-left transition active:scale-[0.99] active:opacity-80"
                  >
                    <span className="break-words text-[17px] font-semibold leading-snug">{ing.name}</span>
                    <span className="mt-0.5 text-[13px] leading-snug text-label-2">{ingredientPriceSentence(ing)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : typed ? (
            <p className="px-1 py-2 text-[15px] text-label-2">No ingredient matches that. Try a shorter word.</p>
          ) : null}
          <button type="button" onClick={() => setOpen(false)} className="mt-1 inline-flex min-h-[44px] items-center px-2 text-[15px] font-medium text-accent">
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
