"use client";

import React, { useCallback, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { updateProduct } from "@/lib/ordering-data";
import { planLinkedRenames, plannedCount, type LinkedProduct, type LinkedRenamePlan } from "@/lib/rename-linked";
import type { Ingredient, Venue } from "@/lib/types";
import { Sheet } from "./ui";

/**
 * Rename everywhere (Troy, 13 Oct 2026). When an ingredient is renamed, the dishes named after it (a spirit's nip) and the ordering
 * products that point at it change too, after a preview that lists every name and one Undo that puts all of it back. The rules are
 * in lib/rename-linked.ts; this is the preview sheet and the writing. Dishes go through the store's own updateItem (history, edit
 * stamps, offline behaviour as ever); ordering products through the ordering data layer. Every other path is unchanged: choosing
 * "Only Rename The Ingredient" keeps today's behaviour.
 */

type Choice = "all" | "only" | "cancel";

interface Applied {
  ingredientId: string;
  oldName: string;
  dishes: { id: string; from: string }[];
  products: { id: string; from: string; link: boolean }[];
}

async function loadProducts(): Promise<LinkedProduct[]> {
  try {
    const { data, error } = await getSupabaseBrowser().from("ordering_products").select("id,venue_id,category_id,name,ingredient_id");
    if (error || !data) return [];
    return data as LinkedProduct[];
  } catch {
    return []; // ordering not set up, offline: the rename still works, it just carries to dishes only
  }
}

export function useLinkedRename(ing: Pick<Ingredient, "id" | "name">) {
  const store = useStore();
  const [ask, setAsk] = useState<{ plan: LinkedRenamePlan; resolve: (c: Choice) => void } | null>(null);
  const applied = useRef<Applied | null>(null);

  const onSave = useCallback(
    async (next: string): Promise<false | string> => {
      const oldName = ing.name;
      applied.current = null;
      const products = await loadProducts();
      const plan = planLinkedRenames({ ingredientId: ing.id, oldName, newName: next, ingredients: store.ingredients, items: store.items, lines: store.lines, products });
      let choice: Choice = "only";
      if (plannedCount(plan) > 0 || plan.skipped.length > 0) choice = await new Promise<Choice>((resolve) => setAsk({ plan, resolve }));
      setAsk(null);
      if (choice === "cancel") return false;
      await store.updateIngredient(ing.id, { name: next });
      if (choice === "only" || plannedCount(plan) === 0) return `Renamed to ${next}`;

      const done: Applied = { ingredientId: ing.id, oldName, dishes: [], products: [] };
      let failed = 0;
      for (const d of plan.dishes) {
        try {
          await store.updateItem(d.id, { name: d.to });
          done.dishes.push({ id: d.id, from: d.from });
        } catch {
          failed++;
        }
      }
      const sb = getSupabaseBrowser();
      for (const p of plan.products) {
        try {
          await updateProduct(sb, p.id, p.link ? { name: p.to, ingredient_id: ing.id } : { name: p.to });
          done.products.push({ id: p.id, from: p.from, link: p.link });
        } catch {
          failed++;
        }
      }
      applied.current = done;
      const n = done.dishes.length + done.products.length;
      return `Renamed to ${next} and ${n} linked ${n === 1 ? "name" : "names"}${failed ? `. ${failed} could not be changed.` : ""}`;
    },
    [ing.id, ing.name, store],
  );

  /** Undo puts the ingredient and everything this rename changed back; a plain rename (nothing linked) just renames back. */
  const onUndo = useCallback(
    async (oldName: string): Promise<void> => {
      const done = applied.current;
      applied.current = null;
      await store.updateIngredient(ing.id, { name: oldName });
      if (!done) return;
      const sb = getSupabaseBrowser();
      for (const d of done.dishes) await store.updateItem(d.id, { name: d.from }).catch(() => undefined);
      for (const p of done.products) await updateProduct(sb, p.id, p.link ? { name: p.from, ingredient_id: null } : { name: p.from }).catch(() => undefined);
    },
    [ing.id, store],
  );

  const sheet = ask ? <LinkedRenameSheet plan={ask.plan} venues={store.venues} onChoose={(c) => ask.resolve(c)} /> : null;
  return { onSave, onUndo, sheet };
}

function LinkedRenameSheet({ plan, venues, onChoose }: { plan: LinkedRenamePlan; venues: Venue[]; onChoose: (c: Choice) => void }) {
  const venueName = (id: number | null) => venues.find((v) => v.id === id)?.name ?? "";
  const n = plannedCount(plan);
  return (
    <Sheet open onClose={() => onChoose("cancel")} title="Rename Linked Names?" action={n > 0 ? { label: "Rename All", onClick: () => onChoose("all") } : undefined}>
      <div className="space-y-5 pb-2">
        <p className="text-[15px] text-label-2">
          {n > 0
            ? `These are named after “${plan.oldBase}”. They can change to “${plan.newBase}” as well, so the dishes, the ordering lists and the ingredient all agree. One Undo puts everything back.`
            : "Nothing else can be renamed to match."}
        </p>
        {plan.dishes.length > 0 ? <Section title="Dishes" rows={plan.dishes.map((d) => ({ key: d.id, where: venueName(d.venue_id), from: d.from, to: d.to }))} /> : null}
        {plan.products.length > 0 ? (
          <Section title="Ordering Products" rows={plan.products.map((p) => ({ key: p.id, where: venueName(p.venue_id), from: p.from, to: p.to, note: p.link ? "Also linked to this ingredient" : undefined }))} />
        ) : null}
        {plan.skipped.length > 0 ? (
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-label-3">Left As They Are</h3>
            <ul className="mt-1.5 space-y-1.5">
              {plan.skipped.map((s) => (
                <li key={`${s.kind}${s.from}${s.venue_id}`} className="text-[15px] text-label-2 sm:text-[14px]">
                  {s.from}
                  {s.venue_id != null ? ` (${venueName(s.venue_id)})` : ""}: {s.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <button type="button" className="btn-tinted w-full !min-h-[44px]" onClick={() => onChoose("only")}>
          Only Rename The Ingredient
        </button>
      </div>
    </Sheet>
  );
}

function Section({ title, rows }: { title: string; rows: { key: string; where: string; from: string; to: string; note?: string }[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-label-3">{title}</h3>
      <ul className="mt-1.5 divide-y divide-[color:var(--separator)] rounded-2xl bg-fill px-3.5">
        {rows.map((r) => (
          <li key={r.key} className="py-2.5">
            {r.where ? <p className="text-[12px] font-medium text-label-3">{r.where}</p> : null}
            <p className="text-[15px] text-label-2 line-through decoration-label-3 sm:text-[14px]">{r.from}</p>
            <p className="flex items-start gap-1.5 text-[16px] font-medium text-label sm:text-[15px]">
              <ArrowRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-accent" strokeWidth={2.25} />
              <span>{r.to}</span>
            </p>
            {r.note ? <p className="mt-0.5 text-[12px] text-label-3">{r.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
