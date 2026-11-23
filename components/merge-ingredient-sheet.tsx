"use client";

import { useEffect, useMemo, useState } from "react";
import { costPerBaseFromIndex } from "@/lib/costing";
import { packLabel } from "@/lib/format";
import { findSimilarIngredients } from "@/lib/ingredient-duplicates";
import { MERGE_NO_UNDO, perBaseText, planMerge, type MergeOrderProduct, type MergeResult } from "@/lib/merge-ingredient";
import { tokenize, normalise } from "@/lib/search";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Ingredient } from "@/lib/types";
import { Banner, Row, SearchField, Sheet } from "./ui";

const LIST_MAX = 30;

/**
 * Merge Into Another Ingredient (Troy, 23 Nov 2026; rules in lib/merge-ingredient.ts, the write is the database function
 * `cost_merge_ingredient`). One sheet, three things in order, the house pattern of the supplier "Move Items" sheet: pick the
 * ingredient to KEEP (search the active ingredients; the look-alikes are offered first), read the IMPACT (what moves, the cost
 * difference, which allergen sign-offs survive, any reason it is refused), then one button "Merge Into <Name>". Nothing is written
 * until that button, and there is no undo, which the sheet says in one sentence.
 */
export function MergeIngredientSheet({ ing, onClose, onMerged }: { ing: Ingredient; onClose: () => void; onMerged: (target: Ingredient, result: MergeResult) => void }) {
  const store = useStore();
  const [q, setQ] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // order list items linked to either ingredient: undefined = still reading, null = could not be read
  const [orderProducts, setOrderProducts] = useState<MergeOrderProduct[] | null | undefined>(undefined);
  const gst = store.settings.gst_rate;

  const pool = useMemo(() => store.ingredients.filter((i) => i.id !== ing.id && i.active !== false), [store.ingredients, ing.id]);
  const target = pool.find((i) => i.id === targetId) ?? null;
  const { usedIn } = store;
  const lookAlikes = useMemo(
    () =>
      findSimilarIngredients(ing.name, pool, {
        selfId: ing.id,
        limit: 5,
        usage: (id) => {
          const u = usedIn("ingredient", id);
          return u.items.length + u.preps.length;
        },
      }),
    [ing.name, ing.id, pool, usedIn],
  );
  const matches = useMemo(() => {
    const tokens = tokenize(q);
    if (!tokens.length) return [];
    return pool
      .filter((i) => {
        const n = normalise(i.name);
        return tokens.every((t) => n.includes(t));
      })
      .sort((a, b) => a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" }));
  }, [q, pool]);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    setOrderProducts(undefined);
    (async () => {
      try {
        const { data, error: e } = await getSupabaseBrowser().from("ordering_products").select("id,venue_id,name,active,ingredient_id").in("ingredient_id", [ing.id, targetId]);
        if (cancelled) return;
        setOrderProducts(e ? null : ((data ?? []) as MergeOrderProduct[]));
      } catch {
        if (!cancelled) setOrderProducts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ing.id, targetId]);

  const plan = useMemo(
    () =>
      target
        ? planMerge(ing, target, {
            lines: store.lines,
            items: store.storedItems,
            preps: store.preps,
            ingredients: store.ingredients,
            deals: store.deals,
            beers: store.beers,
            gelatoServeLines: store.gelatoServeLines,
            orderProducts: orderProducts ?? null,
            venues: store.venues,
            gst,
            today: store.today,
          })
        : null,
    [target, ing, store.lines, store.storedItems, store.preps, store.ingredients, store.deals, store.beers, store.gelatoServeLines, store.venues, store.today, orderProducts, gst],
  );
  const reading = !!target && orderProducts === undefined;

  async function merge() {
    if (!target || !plan?.canMerge || busy || reading) return;
    setBusy(true);
    setError(null);
    try {
      const result = await store.mergeIngredient(ing.id, target.id);
      onMerged(target, result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const sub = (i: Ingredient) =>
    [store.supplierById.get(i.supplier_id ?? -1)?.name ?? "No supplier", `${packLabel(Number(i.pack_size), i.pack_unit)} pack`, perBaseText(costPerBaseFromIndex(store.index, i, gst), i.pack_unit)].join(" · ");
  const pick = (i: Ingredient) => {
    setError(null);
    setTargetId(i.id);
  };

  return (
    <Sheet open onClose={() => (busy ? undefined : onClose())} title="Merge Ingredient">
      <div className="space-y-4 pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <p className="px-1 text-[15px] text-label-2 sm:text-[13px]">
          Use this when <span className="font-semibold text-label">{ing.name}</span> is the same product as another ingredient. Everything that uses it moves to the one you keep.
        </p>

        {!target ? (
          <>
            <div>
              <p className="section-label !px-1">Ingredient To Keep</p>
              <SearchField value={q} onChange={setQ} placeholder="Search ingredients" />
            </div>
            {q.trim() ? (
              matches.length ? (
                <div>
                  <div className="group-list">
                    {matches.slice(0, LIST_MAX).map((i) => (
                      <Row key={i.id} title={i.name} sub={sub(i)} onClick={() => pick(i)} chevron />
                    ))}
                  </div>
                  {matches.length > LIST_MAX ? <p className="px-1 pt-2 text-[13px] text-label-2">Showing the first {LIST_MAX}. Type more of the name to narrow the list.</p> : null}
                </div>
              ) : (
                <p className="px-1 text-[15px] text-label-2 sm:text-[13px]">No active ingredient matches that name.</p>
              )
            ) : lookAlikes.length ? (
              <div>
                <p className="section-label !px-1">Looks Like The Same Product</p>
                <div className="group-list">
                  {lookAlikes.map((i) => (
                    <Row key={i.id} title={i.name} sub={sub(i)} onClick={() => pick(i)} chevron />
                  ))}
                </div>
              </div>
            ) : (
              <p className="px-1 text-[15px] text-label-2 sm:text-[13px]">Search for the ingredient you are keeping. You will see what changes before anything moves.</p>
            )}
          </>
        ) : null}

        {target && plan ? (
          <>
            <div>
              <p className="section-label !px-1">Ingredient To Keep</p>
              <div className="group-list">
                <Row title={target.name} sub={sub(target)} trailing={<span className="text-accent">Change</span>} onClick={() => (busy ? undefined : setTargetId(null))} />
              </div>
            </div>

            {plan.blockers.length ? (
              <div className="rounded-2xl bg-danger-soft px-4 py-3" role="alert">
                <p className="text-[17px] font-semibold text-danger sm:text-[15px]">These Cannot Be Merged</p>
                {plan.blockers.map((b) => (
                  <p key={b} className="mt-1 text-[15px] text-label sm:text-[13px]">
                    {b}
                  </p>
                ))}
              </div>
            ) : (
              <>
                <div className="rounded-2xl bg-surface-2 px-4 py-3">
                  <p className="text-[17px] font-semibold sm:text-[15px]">{plan.recipesText}</p>
                  <p className="mt-1.5 text-[15px] text-label-2 tnum sm:text-[13px]">{plan.price.text}</p>
                  {reading ? <p className="mt-1.5 text-[15px] text-label-2 sm:text-[13px]">Checking the order lists…</p> : null}
                  {(reading ? [] : plan.orderText).concat(plan.otherText).map((t) => (
                    <p key={t} className="mt-1.5 text-[15px] text-label-2 sm:text-[13px]">
                      {t}
                    </p>
                  ))}
                </div>
                {plan.signOffText.length ? (
                  <div className={plan.recheck.length ? "rounded-2xl bg-warn-soft px-4 py-3" : "rounded-2xl bg-surface-2 px-4 py-3"}>
                    <p className="text-[17px] font-semibold sm:text-[15px]">{plan.recheck.length ? "Allergens: Re-check Needed" : "Allergens: Sign-offs Kept"}</p>
                    {plan.signOffText.map((t) => (
                      <p key={t} className="mt-1 text-[15px] text-label-2 sm:text-[13px]">
                        {t}
                      </p>
                    ))}
                  </div>
                ) : null}
                <p className="px-1 text-[15px] text-label-2 sm:text-[13px]">{plan.sourceText}</p>
                <p className="px-1 text-[15px] font-medium text-label sm:text-[13px]">{MERGE_NO_UNDO}</p>
              </>
            )}

            <button type="button" className="btn-primary !h-auto w-full !min-h-[44px] whitespace-normal py-2 text-center" disabled={!plan.canMerge || busy || reading} onClick={() => void merge()}>
              {busy ? "Merging…" : `Merge Into ${target.name}`}
            </button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
