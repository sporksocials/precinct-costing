"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import { AddAllergen, BlockerNotice, ContainsChips, SourceList } from "@/components/editor/dish-allergens";
import { DIET_MARKS, dietMarkDef, type DietMarkId } from "@/lib/diet-legend";
import { CHECK_ALL_INGREDIENTS_HREF, dishCheck, readDishAllergens, signOffState, sourceLines, staleSignOffText } from "@/lib/dish-allergens";
import { dateWithYear } from "@/lib/record-created";
import { parentKey } from "@/lib/costing";
import { allTodos, waitingText } from "@/lib/matrix-todo";
import {
  REVIEW_CHANGED_TEXT,
  REVIEW_GONE_TEXT,
  REVIEW_UNREVIEWED_TEXT,
  confirmPatch,
  initialReviewDraft,
  progressText,
  reviewContains,
  reviewQueue,
  toggleReviewExtra,
  toggleReviewMark,
  venueBreak,
  type ReviewDraft,
  type ReviewItem,
} from "@/lib/matrix-review";
import { useStore } from "@/lib/store";
import type { MenuItem } from "@/lib/types";
import { cx, Empty, useToast } from "../ui";
import { useAllergenIndex } from "../allergen-picker";
import { useVenue } from "../venue";

type Phase = { kind: "dish" } | { kind: "break"; done: string; next: string; count: number } | { kind: "finished" };

/**
 * Review mode (Troy, 10 Oct 2026): steps through the dishes that need allergen approval and can be confirmed now (every ingredient
 * reviewed), one at a time, on a phone, an iPad or a desktop. Ingredient first: shows the dish and its ingredients (names only), the
 * allergens the ingredients give as read-only chips with where each comes from, an Add An Allergen control for extras, the
 * can-be-made-without notes, the three marks and a link to the editor for options. A dish that has an unreviewed ingredient shows
 * why and links to the ingredient review instead of letting it be confirmed. Confirm And Next accepts the computed result and writes
 * the dish's allergens section (with the sign-off, its components and the ticks snapshot) after re-reading the dish and its
 * ingredients from the database; if anything changed underneath, nothing is written and the person is told to reload it. With every
 * venue chosen it works through them one after another and offers the next when one is finished.
 */
export function MatrixReviewPage() {
  const store = useStore();
  const idx = useAllergenIndex();
  const toast = useToast();
  const params = useSearchParams();
  const { venue } = useVenue();
  const section = params.get("section") ?? "*";

  // the queue is fixed when the page opens, so confirming a dish never moves the one you are on
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  // dishes that need approval but wait on ingredients nobody has reviewed (not in the queue: they cannot be confirmed here)
  const [waiting, setWaiting] = useState<{ dishes: number; ingredients: number }>({ dishes: 0, ingredients: 0 });
  useEffect(() => {
    if (queue || !store.ready) return;
    const todos = allTodos(store.venues, store.items, idx, null);
    const mine = todos.filter((t) => venue?.id == null || t.venue.id === venue.id);
    setWaiting({ dishes: mine.reduce((n, t) => n + t.blocked.length, 0), ingredients: new Set(mine.flatMap((t) => t.blockedIngredients.map((u) => u.id))).size });
    setQueue(reviewQueue(todos, { venueId: venue?.id ?? null, section }));
  }, [queue, store.ready, store.venues, store.items, idx, venue?.id, section]);

  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "dish" });
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; reload: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const cur = queue?.[i] ?? null;
  const item: MenuItem | null = cur ? store.items.find((x) => x.id === cur.dishId) ?? null : null;
  // what the ingredients give for this dish right now (never ticked by hand)
  const check = useMemo(() => (item ? dishCheck(item, idx) : null), [item, idx]);
  const draft: ReviewDraft | null = useMemo(() => {
    if (!cur || !item || !check) return null;
    return drafts[cur.dishId] ?? initialReviewDraft(item, check.derived);
  }, [cur, item, check, drafts]);
  const ingredientNames = useMemo(() => {
    if (!item) return [];
    return (store.index.linesByParent.get(parentKey("item", item.id)) ?? [])
      .filter((l) => l.component_id)
      .map((l) => (l.component_type === "prep" ? store.index.preps.get(l.component_id)?.name : store.index.ingredients.get(l.component_id)?.name) ?? "Unknown");
  }, [item, store.index]);

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
    setProblem(null);
    setNote(null);
  }, [i, phase.kind]);

  const patchDraft = (fn: (d: ReviewDraft) => ReviewDraft) => {
    if (!cur || !draft) return;
    setDrafts((all) => ({ ...all, [cur.dishId]: fn(draft) }));
  };

  const goNext = (from: number) => {
    if (!queue) return;
    const brk = venueBreak(queue, from);
    if (from + 1 >= queue.length) setPhase({ kind: "finished" });
    else if (brk) {
      setI(from + 1);
      setPhase({ kind: "break", ...brk });
    } else setI(from + 1);
  };

  const skip = () => {
    if (!queue) return;
    goNext(i);
  };
  const back = () => {
    setPhase({ kind: "dish" });
    if (phase.kind === "dish" && i > 0) setI(i - 1);
  };

  const confirm = async () => {
    if (!cur || !item || !draft || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const own = (store.index.linesByParent.get(parentKey("item", item.id)) ?? []).filter((l) => l.component_id).map((l) => `${l.component_type}:${l.component_id}`);
      if (!check || check.blocked) return;
      const verdict = await store.confirmDish(item.id, { updatedAt: item.updated_at ?? null, ownComponents: own, derived: check.derived, ticks: check.live.ticks }, (fresh, row) =>
        confirmPatch({ item: row, draft, email: store.userEmail, nowIso: new Date().toISOString(), check: fresh }),
      );
      if (!verdict.ok) {
        setProblem({
          text: verdict.reason === "gone" ? REVIEW_GONE_TEXT : verdict.reason === "unreviewed" ? REVIEW_UNREVIEWED_TEXT : REVIEW_CHANGED_TEXT,
          reload: verdict.reason !== "gone",
        });
        return;
      }
      setConfirmed((s) => new Set(s).add(cur.dishId));
      toast.show({ message: `${item.name} confirmed` });
      goNext(i);
    } catch (e) {
      setProblem({ text: `Not saved. ${e instanceof Error ? e.message : "Check the connection and try again."}`, reload: false });
    } finally {
      setBusy(false);
    }
  };

  /** Reload: drops the draft for this dish and re-reads everything from the database. */
  const reload = async () => {
    if (!cur) return;
    setDrafts((all) => {
      const n = { ...all };
      delete n[cur.dishId];
      return n;
    });
    await store.reload();
    setProblem(null);
    setNote("Reloaded. Check the dish again.");
  };

  const backHref = venue ? `/matrix/todo?venue=${venue.slug}` : "/matrix/todo";

  if (!store.ready || !queue) return <p className="py-10 text-center text-[15px] text-label-2">Loading the dishes…</p>;
  if (!queue.length)
    return (
      <div>
        <ReviewBack href={backHref} />
        {waiting.dishes > 0 ? (
          <Empty
            title="Waiting On Ingredients"
            body={`${waiting.dishes} ${waiting.dishes === 1 ? "dish needs" : "dishes need"} approval but ${waiting.dishes === 1 ? "has" : "have"} ingredients nobody has checked yet (${waitingText(waiting.dishes, waiting.ingredients)}). Check the ingredients first, then come back.`}
            action={<Link href={CHECK_ALL_INGREDIENTS_HREF} className="btn-primary">Check Ingredients</Link>}
          />
        ) : (
          <Empty title="Nothing To Review" body="Every dish here is confirmed. Check the To Do list for anything else." action={<Link href={backHref} className="btn-primary">Back To To Do</Link>} />
        )}
      </div>
    );

  if (phase.kind === "finished") {
    return (
      <div>
        <ReviewBack href={backHref} />
        <div className="mx-auto max-w-md py-12 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
            <CircleCheck className="h-8 w-8" strokeWidth={2.25} aria-hidden />
          </span>
          <p className="mt-4 text-[24px] font-semibold tracking-tight">Review Finished</p>
          <p className="mt-1.5 text-[15px] text-label-2">
            {confirmed.size} of {queue.length} {queue.length === 1 ? "dish" : "dishes"} confirmed
            {queue.length - confirmed.size ? `. ${queue.length - confirmed.size} skipped, they are still on the To Do list.` : "."}
          </p>
          <Link href={backHref} className="btn-primary mt-6 inline-flex !min-h-[48px]">
            Back To To Do
          </Link>
        </div>
      </div>
    );
  }

  if (phase.kind === "break") {
    return (
      <div>
        <ReviewBack href={backHref} />
        <div className="mx-auto max-w-md py-12 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
            <CircleCheck className="h-8 w-8" strokeWidth={2.25} aria-hidden />
          </span>
          <p className="mt-4 text-[24px] font-semibold tracking-tight">{phase.done} Is Done</p>
          <p className="mt-1.5 text-[15px] text-label-2">
            Next is {phase.next}, {phase.count} {phase.count === 1 ? "dish" : "dishes"} to review.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" className="btn-primary !min-h-[48px]" onClick={() => setPhase({ kind: "dish" })}>
              Continue To {phase.next}
            </button>
            <Link href={backHref} className="btn-plain !min-h-[48px]">
              Stop For Now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const total = queue.length;
  const contains = draft && check ? reviewContains(draft, check.derived) : [];
  const da = item ? readDishAllergens(item.dish_allergens) : null;
  const stale = item && check && da?.confirmedAt ? staleSignOffText(signOffState(da, check.live), dateWithYear(da.confirmedAt)) : null;

  return (
    <div ref={top} className="mx-auto max-w-2xl scroll-mt-2">
      <ReviewBack href={backHref} />
      <div className="px-1">
        <p className="text-[13px] font-medium text-label-2" aria-live="polite">
          {progressText(i, total, cur!)}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={i + 1} aria-label="Review progress">
          <div className="h-full rounded-full bg-accent-fill transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((i + 1) / total) * 100}%` }} />
        </div>
      </div>

      {!item || !draft || !check ? (
        <div className="py-10 text-center">
          <p className="text-[17px] font-semibold">This Dish Is No Longer There</p>
          <p className="mt-1 text-[15px] text-label-2">It was removed or switched off. Skip it.</p>
        </div>
      ) : (
        <>
          <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">{item.name}</h1>
          <p className="mt-0.5 text-[15px] text-label-2">{cur!.section}</p>
          {stale ? (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] font-medium text-warn">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              {stale}
            </p>
          ) : null}

          <section className="mt-5" aria-label="Ingredients">
            <h2 className="text-[13px] font-medium text-label-2">Ingredients ({ingredientNames.length})</h2>
            {ingredientNames.length ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {ingredientNames.map((n, k) => (
                  <li key={`${n}-${k}`} className="rounded-full bg-fill px-3 py-1.5 text-[15px] sm:text-[13px]">
                    {n}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[15px] text-label-2">No ingredients on this dish yet.</p>
            )}
            <Link href={`/items/${item.id}`} className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-accent">
              <ExternalLink aria-hidden className="h-4 w-4" strokeWidth={2.25} /> Open Dish To Set Options
            </Link>
          </section>

          <section className="mt-5 rounded-2xl border border-[color:var(--separator)] bg-accent-soft px-4 py-4" aria-label="Allergens">
            <h2 className="text-[17px] font-semibold">Contains</h2>
            <p className="mt-1 text-[13px] text-label-2">Worked out from the ingredients. Check it against the menu, then confirm.</p>
            <div className="mt-3">
              <BlockerNotice check={check} dishId={item.id} />
            </div>
            <div className="mt-3">
              <ContainsChips contains={contains} added={draft.added} blocked={check.blocked} onRemoveExtra={(id) => patchDraft((d) => toggleReviewExtra(d, id, check.derived))} />
              <SourceList lines={sourceLines(check.r, check.derived, draft.added)} />
            </div>
            <div className="mt-2">
              <AddAllergen contained={contains} onAdd={(id) => patchDraft((d) => toggleReviewExtra(d, id, check.derived))} />
            </div>

          </section>

          <section className="mt-5 overflow-hidden rounded-2xl border border-[color:var(--separator)] bg-accent-soft" aria-label="Menu labels">
            <div className="px-4 pt-4">
              <h2 className="text-[17px] font-semibold">Menu Labels</h2>
              <p className="text-[13px] text-label-2">GF, V and VG as served. Options are set on the dish.</p>
            </div>
            <div className="mt-1 divide-y divide-[color:var(--separator)] pb-1">
              {DIET_MARKS.map((m) => (
                <MarkRow
                  key={m.id}
                  id={m.id}
                  on={draft.marks.includes(m.id)}
                  onChange={() => {
                    const { draft: next, clearedOption } = toggleReviewMark(draft, m.id);
                    patchDraft(() => next);
                    if (clearedOption) setNote(`${dietMarkDef(m.id).name} cannot sit beside its option, so that option was turned off.`);
                  }}
                />
              ))}
            </div>
          </section>

          {note ? <p className="mt-3 text-[13px] font-medium text-label-2" role="status">{note}</p> : null}
          {problem ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-danger-soft px-3 py-2.5 text-[15px] font-medium text-danger sm:text-[13px]" role="alert">
              <span>{problem.text}</span>
              {problem.reload ? (
                <button type="button" className="min-h-[44px] rounded-lg px-3 font-semibold underline" onClick={() => void reload()}>
                  Reload
                </button>
              ) : null}
            </p>
          ) : null}
        </>
      )}

      {/* the action bar: Back, Skip and Confirm And Next, fixed at the bottom on every width (the tab bar is hidden on this page) */}
      <div className="fixed inset-x-0 bottom-0 z-30 bar-blur pb-safe hairline-t lg:left-[248px]">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5 lg:px-0">
          <button type="button" className="btn-plain !min-h-[48px] !px-4" onClick={back} disabled={busy || i === 0}>
            Back
          </button>
          <button type="button" className="btn-plain !min-h-[48px] !px-4" onClick={skip} disabled={busy}>
            Skip
          </button>
          <button type="button" className="btn-primary !min-h-[48px] min-w-0 flex-1" onClick={() => void confirm()} disabled={busy || !item || !draft || !check || check.blocked}>
            {busy ? "Saving…" : "Confirm And Next"}
          </button>
        </div>
      </div>
      <div className="h-24" aria-hidden />
    </div>
  );
}

function ReviewBack({ href }: { href: string }) {
  return (
    <Link href={href} className="btn-text -ml-2 !min-h-[44px] !gap-0 !text-accent">
      <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
      To Do
    </Link>
  );
}

function MarkRow({ id, on, onChange }: { id: DietMarkId; on: boolean; onChange: () => void }) {
  const m = dietMarkDef(id);
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className="flex min-h-[48px] w-full items-center gap-3 px-4 py-1.5 text-left active:bg-fill">
      <span className="min-w-0 flex-1 text-[17px] sm:text-[15px]">
        <span className="tnum font-semibold">{m.letter}</span> {m.name}
      </span>
      <span className={cx("relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200", on ? "bg-accent-fill" : "bg-fill-2")} aria-hidden>
        <span className={cx("inline-block h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ease-ios", on ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </span>
    </button>
  );
}
