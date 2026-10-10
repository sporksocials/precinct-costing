"use client";

import { useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { ANIMAL_LABELS, allergenLabel, ingredientAllergenState, type AllergenId, type AnimalFlag } from "@/lib/allergens";
import { allergenNote, proposalPatch, remainingProposals, type AllergenAssistItem, type AllergenAssistResult, type AssistIngredient } from "@/lib/allergen-assist";
import { DRINK_ALLERGEN_IDS } from "@/lib/allergen-badges";
import { DISH_MAX, requestAllergenSuggestionsBatched } from "@/lib/allergen-assist-client";
import { BADGE_LABELS } from "@/lib/diet-legend";
import type { Ingredient, PortalPrice, Supplier } from "@/lib/types";
import { cx, useToast } from "./ui";

/** Allergen ticks can fail to save for two plain reasons; say which one. */
export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/column|schema cache|allergen|diet_flags/i.test(m)) return "Couldn’t save the allergens. The database still needs its allergen update, so nothing has changed.";
  return "Couldn’t save the allergens. Check your connection and try again.";
}

/** The supplier's own description of this ingredient's product, when the portal price list has one. */
export function portalDescription(ing: Pick<Ingredient, "supplier_code" | "supplier_id">, portalPrices: readonly PortalPrice[] | null | undefined, supplierById: Map<number, Supplier>): string | null {
  if (!portalPrices || !ing.supplier_code) return null;
  const sup = (supplierById.get(ing.supplier_id ?? -1)?.name ?? "").toLowerCase();
  return portalPrices.find((p) => p.product_code === ing.supplier_code && (!sup || (p.supplier ?? "").toLowerCase() === sup))?.description ?? null;
}

/** What the route is told about an ingredient: its name, category, supplier description and what a person has already ticked. */
export function toAssistIngredient(ing: Ingredient, description?: string | null): AssistIngredient {
  const st = ingredientAllergenState(ing);
  return { key: ing.id, name: ing.name, category: ing.category ?? "", description: description ?? undefined, allergens: st.confirmed, dietFlags: st.tickedAnimal };
}

/** Label for an allergen id in the editor: alcohol reads as "Contains Alcohol", like its chip. */
export const proposalLabel = (id: AllergenId): string => (id === "alcohol" ? BADGE_LABELS.containsAlcohol : allergenLabel(id));

type Proposals = Pick<AllergenAssistItem, "allergens" | "diet">;

/** Each proposal's reason on its own line: label in bold, then the sentence. */
export function ReasonLines({ proposals, className }: { proposals: Proposals; className?: string }) {
  return (
    <ul className={cx("space-y-1 text-[13px] leading-snug text-label-2", className)}>
      {proposals.allergens.map((a) => (
        <li key={a.id}>
          <span className="font-medium text-label">{proposalLabel(a.id)}</span>: {a.reason}
        </li>
      ))}
      {proposals.diet.map((d) => (
        <li key={d.flag}>
          <span className="font-medium text-label">{ANIMAL_LABELS[d.flag]}</span>: {d.reason}
        </li>
      ))}
    </ul>
  );
}

/** A proposal as a small dashed amber pill (the same look as a suggested chip, but not a button). */
function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-dashed border-[color:var(--warn)] bg-warn-soft px-2.5 py-0.5 text-[12px] font-semibold text-warn">{children}</span>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Flow = { step: "idle" } | { step: "loading"; total: number } | { step: "done"; result: AllergenAssistResult; truncated: number };

/**
 * The dish card's "Suggest For Unreviewed Ingredients": one batch call for every ingredient nobody has reviewed, then a
 * preview per ingredient (proposed allergens as small chips, the reason, Accept or Review). Accepting only adds ticks:
 * it never marks an ingredient as reviewed, and the toast can undo it.
 */
export function UnreviewedSuggestions({ ingredients, ready, drink, onReview }: { ingredients: Ingredient[]; ready: boolean; drink?: boolean; onReview: (id: string) => void }) {
  const store = useStore();
  const toast = useToast();
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const storeRef = useRef(store);
  storeRef.current = store;
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const ask = async () => {
    const token = ++run.current;
    setError(null);
    const asked = ingredients.slice(0, DISH_MAX);
    setFlow({ step: "loading", total: asked.length });
    const result = await requestAllergenSuggestionsBatched(
      asked.map((i) => toAssistIngredient(i, portalDescription(i, store.portalPrices, store.supplierById))),
    );
    if (run.current !== token) return; // cancelled, or asked again
    setFlow({ step: "done", result, truncated: Math.max(0, ingredients.length - asked.length) });
  };
  const cancel = () => {
    run.current++;
    setFlow({ step: "idle" });
  };

  // what is still worth proposing, now: a person may have ticked some since the answer arrived
  const rows = useMemo(() => {
    if (flow.step !== "done") return [];
    return flow.result.items.flatMap((item0) => {
      // on a drink only DRINK_ALLERGEN_IDS (egg, milk, nuts, sulphites) are proposed: what is shown is exactly what Accept ticks
      const item = drink ? { ...item0, allergens: item0.allergens.filter((a) => DRINK_ALLERGEN_IDS.includes(a.id)), diet: [] } : item0;
      const ing = byId.get(item.key);
      if (!ing) return [];
      return [{ ing, item, left: remainingProposals(ing, item), had: item.allergens.length + item.diet.length > 0 }];
    });
  }, [flow, byId, drink]);
  const withProposals = rows.filter((r) => r.left.allergens.length + r.left.diet.length > 0);
  const nothing = rows.filter((r) => !r.had);
  const accepted = rows.filter((r) => r.had && r.left.allergens.length + r.left.diet.length === 0).length;
  const nTicks = withProposals.reduce((n, r) => n + r.left.allergens.length + r.left.diet.length, 0);

  const accept = async (picks: { ing: Ingredient; item: AllergenAssistItem }[]) => {
    setBusy(true);
    setError(null);
    const done: { id: string; name: string; previous: { allergens: string[]; diet_flags: string[] } }[] = [];
    try {
      for (const { ing, item } of picks) {
        const p = proposalPatch(ing, item);
        if (!p) continue;
        await store.updateIngredient(ing.id, p.patch);
        done.push({ id: ing.id, name: ing.name, previous: { allergens: p.previous.allergens ?? [], diet_flags: p.previous.diet_flags ?? [] } });
      }
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
    if (!done.length) return;
    toast.show(
      {
        message: done.length === 1 ? `Ticks added to ${done[0].name}` : `Ticks added to ${plural(done.length, "ingredient", "ingredients")}`,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              try {
                for (const d of done) await storeRef.current.updateIngredient(d.id, d.previous);
              } catch (e) {
                setError(friendlyError(e));
              }
            })();
          },
        },
      },
      8000,
    );
  };

  return (
    <div className="mb-3">
      <button type="button" className="btn-tinted w-full sm:w-auto" disabled={!ready || flow.step === "loading"} onClick={() => void ask()}>
        Suggest For Unreviewed Ingredients
      </button>
      <p className="mt-1.5 text-[13px] text-label-2">Smart Tidy reads each name and proposes allergens with a reason. Nothing is saved until you accept, and nothing is marked as reviewed.</p>

      {flow.step === "loading" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="status">
          <p className="min-w-0 flex-1 text-[15px] text-label-2">Checking {plural(flow.total, "ingredient", "ingredients")}…</p>
          <button type="button" className="btn-plain" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : null}

      {flow.step === "done" ? (
        <div className="mt-3 rounded-xl bg-fill px-3 py-3" aria-live="polite" data-testid="suggest-results">
          <p className="text-[13px] font-medium text-label-2">{allergenNote(flow.result)}</p>
          {flow.truncated ? <p className="mt-1 text-[13px] text-label-2">Checked the first {DISH_MAX} of {ingredients.length}. Review the rest one by one below.</p> : null}

          {withProposals.length ? (
            <>
              <ul className="mt-2 divide-y divide-[color:var(--separator)]">
                {withProposals.map(({ ing, item, left }) => (
                  <li key={ing.id} className="py-3 first:pt-1">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-[14rem]">
                        <p className="break-words text-[15px] font-medium">{ing.name}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {left.allergens.map((a) => (
                            <Pill key={a.id}>{proposalLabel(a.id)}</Pill>
                          ))}
                          {left.diet.map((d) => (
                            <Pill key={d.flag}>{ANIMAL_LABELS[d.flag as AnimalFlag]}</Pill>
                          ))}
                        </div>
                        <ReasonLines proposals={left} className="mt-2" />
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" className="btn-tinted !min-h-[44px] !px-3 !text-[14px] sm:!min-h-[34px]" disabled={busy || !ready} onClick={() => void accept([{ ing, item }])}>
                          Accept
                        </button>
                        <button type="button" className="btn-plain !min-h-[44px] !px-3 !text-[14px] sm:!min-h-[34px]" onClick={() => onReview(ing.id)}>
                          Review
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[13px] text-label-2">
                Accept All adds {plural(nTicks, "tick", "ticks")} across {plural(withProposals.length, "ingredient", "ingredients")}, so the allergen badges on every dish that uses them will change. None are marked as reviewed.
              </p>
            </>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-[15px] text-label">
              {accepted ? <Check aria-hidden className="h-4 w-4 text-good" strokeWidth={3} /> : null}
              {accepted ? "Every suggestion has been accepted. A person still needs to mark each ingredient as reviewed." : "Nothing new to suggest from the names. Open each ingredient to check it yourself."}
            </p>
          )}

          {nothing.length ? (
            <p className="mt-2 text-[13px] text-label-2">
              Nothing to suggest for {nothing.slice(0, 6).map((r) => r.ing.name).join(", ")}
              {nothing.length > 6 ? ` and ${nothing.length - 6} more` : ""}.
            </p>
          ) : null}
          {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {withProposals.length > 1 ? (
              <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy || !ready} onClick={() => void accept(withProposals)}>
                Accept All ({withProposals.length})
              </button>
            ) : null}
            <button type="button" className="btn-plain w-full sm:w-auto" onClick={cancel}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
