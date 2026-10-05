"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { money, packLabel } from "@/lib/format";
import { isActive } from "@/lib/active";
import type { Ingredient } from "@/lib/types";
import { TouchSearch, TouchSheet } from "./touch";

/** "24 ea, $62.00 ex GST": how an ingredient's pack and price read in a list. */
export function ingredientPackText(i: Pick<Ingredient, "pack_size" | "pack_unit" | "pack_price" | "price_inc_gst" | "gst_free">): string {
  const gst = i.gst_free ? "GST free" : i.price_inc_gst ? "inc GST" : "ex GST";
  return `${packLabel(Number(i.pack_size) || 1, i.pack_unit)} pack, ${money(i.pack_price)} ${gst}`;
}

/** Words typed -> active ingredients whose name contains every word, best (shortest name) first. Pure. */
export function matchIngredients(list: readonly Ingredient[], query: string, limit = 40): Ingredient[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = list.filter((i) => isActive(i) && words.every((w) => i.name.toLowerCase().includes(w)));
  return pool.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, limit);
}

/** A search picker over the costing ingredients. Choosing one calls onPick; the link is optional and never changes a costing price. */
export function IngredientPickerSheet({ open, onClose, onPick, currentId }: { open: boolean; onClose: () => void; onPick: (i: Ingredient) => void; currentId?: string | null }) {
  const { ingredients } = useStore();
  const [q, setQ] = useState("");
  const results = useMemo(() => (q.trim() ? matchIngredients(ingredients, q) : []), [ingredients, q]);
  return (
    <TouchSheet open={open} onClose={onClose} title="Link Ingredient" size="lg">
      <div className="space-y-3 pb-2">
        <TouchSearch value={q} onChange={setQ} placeholder="Search costing ingredients" label="Search ingredients" />
        {!q.trim() ? <p className="text-[15px] text-label-2">Type part of the ingredient’s name, like “XXXX” or “Coke”.</p> : null}
        {q.trim() && results.length === 0 ? <p className="text-[15px] text-label-2">No active ingredient matches. Check the spelling, or leave it unlinked.</p> : null}
        {results.length > 0 ? (
          <ul className="group-list" aria-label="Matching ingredients">
            {results.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => onPick(i)} className="flex min-h-[60px] w-full flex-col justify-center px-4 py-2 text-left active:bg-fill hover:bg-fill">
                  <span className="block truncate text-[17px]">
                    {i.name}
                    {i.id === currentId ? <span className="ml-2 text-[13px] text-label-2">Linked now</span> : null}
                  </span>
                  <span className="block truncate text-[13px] text-label-2">{ingredientPackText(i)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </TouchSheet>
  );
}
