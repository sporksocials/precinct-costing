"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronLeft, CircleCheck, TriangleAlert } from "lucide-react";
import { CONTAINS_IDS, allergenLabel, allergensReady, ingredientAllergenState, type AllergenId } from "@/lib/allergens";
import type { AllergenProposal } from "@/lib/allergen-assist";
import { requestAllergenSuggestions } from "@/lib/allergen-assist-client";
import {
  advance,
  confirmPayload,
  currentId,
  isFinished,
  leftOver,
  mainOnly,
  progressText,
  proposalOnly,
  skip,
  startWalk,
  startingTicks,
  stepBack,
  toggleTick,
  usedInText,
  type Walk,
} from "@/lib/ingredient-review";
import { useStore } from "@/lib/store";
import { toAssistIngredient, friendlyError, ReasonLines } from "../allergen-suggest";
import { cx } from "../ui";
import { useVenue } from "../venue";
import { useIngredientsToReview } from "./use-review-queue";

/** How many ingredients ahead of the person are sent for a smart suggestion in one call (the route's batch limit). */
const AHEAD = 20;
/** Fetch the next batch when any of this many upcoming ingredients has no answer yet. */
const NEAR = 5;

/**
 * Ingredient allergen review (Troy, 10 Oct 2026): one ingredient at a time, phone first. The 15 main allergen chips start from what a
 * person already ticked plus the name and Smart Tidy suggestions (dashed, "Suggested", until a person taps anything), and Confirm And
 * Next writes `allergens` and `allergens_reviewed: true` through the same store update the ingredient page uses. Ticking nothing is a
 * valid answer: the ingredient contains none of them. The queue is fixed when the page opens, so confirming never reshuffles it.
 */
export function IngredientReviewPage() {
  const store = useStore();
  const params = useSearchParams();
  const { venue } = useVenue();
  const dishId = params.get("dish");
  const dish = dishId ? store.items.find((x) => x.id === dishId) ?? null : null;
  const waiting = useIngredientsToReview({ dishId, venueId: venue?.id ?? null });

  // fixed when the page opens: the people and the order do not move while they work
  const [walk, setWalk] = useState<Walk | null>(null);
  const [fixed, setFixed] = useState<Record<string, (typeof waiting)[number]> | null>(null);
  useEffect(() => {
    if (walk || !store.ready) return;
    setFixed(Object.fromEntries(waiting.map((w) => [w.ingredientId, w])));
    setWalk(startWalk(waiting.map((w) => w.ingredientId)));
  }, [walk, store.ready, waiting]);

  const [edits, setEdits] = useState<Record<string, AllergenId[]>>({});
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [smart, setSmart] = useState<Record<string, AllergenProposal[]>>({});
  const [smartRound, setSmartRound] = useState(0);
  const requested = useRef(new Set<string>());
  const inflight = useRef(false);
  const alive = useRef(true);
  const top = useRef<HTMLDivElement>(null);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const curId = walk ? currentId(walk) : null;
  const ing = curId ? store.index.ingredients.get(curId) ?? null : null;
  const info = curId && fixed ? fixed[curId] ?? null : null;

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
    setProblem(null);
  }, [curId]);

  // Smart suggestions for the next few ingredients, a call ahead of the person. Failure is silent: the name check already filled the chips.
  useEffect(() => {
    if (!walk || isFinished(walk) || inflight.current) return;
    const wanted = (id: string) => {
      const x = storeRef.current.index.ingredients.get(id);
      return !!x && !x.allergens_reviewed && !requested.current.has(id);
    };
    if (!walk.order.slice(walk.i, walk.i + NEAR).some(wanted)) return;
    const batch = walk.order.slice(walk.i).filter(wanted).slice(0, AHEAD);
    if (!batch.length) return;
    batch.forEach((id) => requested.current.add(id));
    inflight.current = true;
    void (async () => {
      const asked = batch.flatMap((id) => {
        const x = storeRef.current.index.ingredients.get(id);
        return x ? [toAssistIngredient(x)] : [];
      });
      const res = await requestAllergenSuggestions(asked);
      inflight.current = false;
      if (!alive.current) return;
      if (res.source === "ai") {
        setSmart((all) => {
          const next = { ...all };
          for (const it of res.items) next[it.key] = it.allergens.filter((a) => (CONTAINS_IDS as string[]).includes(a.id));
          return next;
        });
      }
      setSmartRound((n) => n + 1);
    })();
  }, [walk, smartRound]);

  // what the chips show: a person's own edit, else what is ticked already plus the proposals
  const st = ing ? ingredientAllergenState(ing) : null;
  const confirmedIds = st ? mainOnly(st.confirmed) : [];
  const keyword = st ? st.suggested.filter((s) => (CONTAINS_IDS as string[]).includes(s.id)) : [];
  const aiProposals = ing && st && !st.reviewed ? (smart[ing.id] ?? []).filter((a) => !confirmedIds.includes(a.id)) : [];
  const proposed = mainOnly([...keyword.map((k) => k.id), ...aiProposals.map((a) => a.id)]);
  const edited = curId ? edits[curId] : undefined;
  const ticks: AllergenId[] = edited ?? startingTicks(confirmedIds, proposed);
  const dashed = edited ? [] : proposalOnly(confirmedIds, proposed);

  const patchTicks = (id: AllergenId) => {
    if (!curId) return;
    setEdits((all) => ({ ...all, [curId]: toggleTick(ticks, id) }));
  };

  const goBack = () => {
    if (walk) setWalk(stepBack(walk));
  };
  const doSkip = () => {
    if (walk) setWalk(skip(walk));
  };

  const confirm = async () => {
    if (!ing || !curId || !walk || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await store.updateIngredient(ing.id, confirmPayload(ing.allergens, ticks));
      setConfirmed((s) => new Set(s).add(curId));
      setEdits((all) => {
        const n = { ...all };
        delete n[curId];
        return n;
      });
      setWalk(advance(walk));
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const backHref = dish ? `/items/${dish.id}` : "/ingredients";
  const backLabel = dish ? dish.name : "Ingredients";

  if (!store.ready || !walk || !fixed) return <p className="py-10 text-center text-[15px] text-label-2">Loading the ingredients…</p>;

  if (isFinished(walk)) {
    const rest = leftOver(walk, confirmed);
    return (
      <div>
        <ReviewBack href={backHref} label={backLabel} />
        <div className="mx-auto max-w-md py-12 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
            <CircleCheck className="h-8 w-8" strokeWidth={2.25} aria-hidden />
          </span>
          {rest.length ? (
            <>
              <p className="mt-4 text-[24px] font-semibold tracking-tight">Nearly Done</p>
              <p className="mt-1.5 text-[15px] text-label-2">
                {confirmed.size} checked. {rest.length} {rest.length === 1 ? "ingredient was" : "ingredients were"} skipped, so the dishes that use {rest.length === 1 ? "it" : "them"} still cannot be confirmed.
              </p>
              <button
                type="button"
                className="btn-primary mt-6 inline-flex !min-h-[48px]"
                onClick={() => {
                  setWalk(startWalk(rest));
                }}
              >
                Check The {rest.length} Skipped
              </button>
            </>
          ) : (
            <>
              <p className="mt-4 text-[24px] font-semibold tracking-tight">All Ingredients Checked</p>
              <p className="mt-1.5 text-[15px] text-label-2">
                {confirmed.size
                  ? `${confirmed.size} ${confirmed.size === 1 ? "ingredient" : "ingredients"} checked. Dishes can now be confirmed from the Matrix To Do list.`
                  : dish
                    ? `Every ingredient in ${dish.name} has been checked.`
                    : "Every ingredient that active dishes use has been checked."}
              </p>
            </>
          )}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href={`/matrix/todo${venue ? `?venue=${venue.slug}` : ""}`} className={cx(rest.length ? "btn-plain" : "btn-primary", "!min-h-[48px]")}>
              Open Matrix To Do
            </Link>
            <Link href="/menu" className="btn-plain !min-h-[48px]">
              Open Menu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const total = walk.order.length;
  const ready = ing ? allergensReady(ing) : false;
  const nothing = ticks.length === 0;

  return (
    <div ref={top} className="mx-auto max-w-2xl scroll-mt-2">
      <ReviewBack href={backHref} label={backLabel} />
      <div className="px-1">
        <p className="text-[13px] font-medium text-label-2" aria-live="polite">
          {progressText(walk.i, total)}
          {dish ? `, ${dish.name}` : venue ? `, ${venue.name}` : ""}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(walk.i + 1, total)} aria-label="Review progress">
          <div className="h-full rounded-full bg-accent-fill transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(Math.min(walk.i + 1, total) / total) * 100}%` }} />
        </div>
      </div>

      {!ing || !st ? (
        <div className="py-10 text-center">
          <p className="text-[17px] font-semibold">This Ingredient Is No Longer There</p>
          <p className="mt-1 text-[15px] text-label-2">It was removed. Skip it.</p>
        </div>
      ) : (
        <>
          <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">{ing.name}</h1>
          <p className="mt-0.5 text-[15px] text-label-2">{ing.category}</p>
          <p className="mt-1.5 text-[15px] text-label">{info ? usedInText(info.dishes) : ""}</p>
          {st.reviewed ? (
            <p className="mt-2 flex items-center gap-1.5 text-[15px] font-medium text-good">
              <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> Checked already. You can change it and confirm again.
            </p>
          ) : null}

          <section className="mt-5 rounded-2xl border border-[color:var(--separator)] bg-accent-soft px-4 py-4" aria-label="Allergens">
            <h2 className="text-[17px] font-semibold">Contains</h2>
            <p className="mt-1 text-[15px] text-label sm:text-[13px]">Tick everything this ingredient contains. Tick nothing if it contains none of them.</p>
            {dashed.length ? (
              <p className="mt-2 flex items-start gap-2 text-[13px] font-medium text-warn" role="status">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
                Suggested: check every one. Dashed chips come from the name and the suggestion service. Tap anything to start your check.
              </p>
            ) : null}
            <div key={curId} className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Allergens this ingredient contains">
              {CONTAINS_IDS.map((id) => {
                const on = ticks.includes(id);
                const guess = on && dashed.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    disabled={!ready}
                    onClick={() => patchTicks(id)}
                    className={cx(
                      "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition-[background-color,color,transform] duration-200 ease-ios active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:opacity-50",
                      on ? (guess ? "border border-dashed border-[color:var(--warn)] bg-warn-soft text-warn" : "bg-accent-fill text-accent-on") : "bg-fill text-label hover:bg-fill-2",
                    )}
                  >
                    {on ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
                    {allergenLabel(id)}
                    {guess ? <span className="text-[12px] font-semibold">Suggested</span> : null}
                  </button>
                );
              })}
            </div>

            {!st.reviewed && (keyword.length || aiProposals.length) ? (
              <div className="mt-3 space-y-1.5">
                {keyword.length ? (
                  <p className="text-[13px] leading-snug text-label-2">
                    <span className="font-medium text-label">Name suggests:</span> {keyword.map((k) => `${allergenLabel(k.id)} (${k.keyword})`).join(", ")}.
                  </p>
                ) : null}
                {aiProposals.length ? <ReasonLines proposals={{ allergens: aiProposals, diet: [] }} /> : null}
              </div>
            ) : null}

            <p className={cx("mt-4 flex items-start gap-2 text-[15px] font-medium sm:text-[13px]", nothing ? "text-label" : "text-label-2")} role="status">
              {nothing ? (
                <>
                  <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={3} />
                  Nothing ticked: this ingredient contains none of the allergens.
                </>
              ) : (
                <>Ticked: {ticks.map((id) => allergenLabel(id)).join(", ")}.</>
              )}
            </p>
          </section>

          {!ready ? <p className="mt-3 rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">Allergen ticks can’t be saved until the database has its allergen update.</p> : null}
          {problem ? (
            <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[15px] font-medium text-danger sm:text-[13px]" role="alert">
              {problem}
            </p>
          ) : null}
        </>
      )}

      {/* the action bar: Back, Skip and Confirm And Next, fixed at the bottom on every width (the tab bar is hidden on this page) */}
      <div className="fixed inset-x-0 bottom-0 z-30 bar-blur pb-safe hairline-t lg:left-[248px]">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5 lg:px-0">
          <button type="button" className="btn-plain !min-h-[48px] !px-4" onClick={goBack} disabled={busy || walk.i === 0}>
            Back
          </button>
          <button type="button" className="btn-plain !min-h-[48px] !px-4" onClick={doSkip} disabled={busy}>
            Skip
          </button>
          <button type="button" className="btn-primary !min-h-[48px] min-w-0 flex-1" onClick={() => void confirm()} disabled={busy || !ing || !ready}>
            {busy ? "Saving…" : "Confirm And Next"}
          </button>
        </div>
      </div>
      <div className="h-24" aria-hidden />
    </div>
  );
}

function ReviewBack({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="btn-text -ml-2 !min-h-[44px] !gap-0 !text-accent">
      <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
      <span className="max-w-[60vw] truncate">{label}</span>
    </Link>
  );
}
