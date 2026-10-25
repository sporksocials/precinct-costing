"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { answerQuestionsBatch } from "@/lib/invoice-answer";
import { buildSuggester, PRESET_SCORE, type Suggester } from "@/lib/invoice-suggest";
import {
  acceptableCount,
  acceptSuggestions,
  buildBatch,
  ignoreList,
  rowSuggestion,
  saveLabel,
  splitReview,
  type Decision,
  type IngredientDoc,
  type IngredientLite,
  type OptionLookups,
  type QuestionGroup,
  type RowSuggestion,
} from "@/lib/invoice-questions-view";
import { useUnsavedGuard } from "@/components/unsaved-guard";
import { TouchButton, TouchSheet } from "@/components/ordering/touch";
import { Banner, useToast } from "@/components/ui";
import { VenueTag } from "@/components/brand";
import { MatchRow } from "./q-match-row";
import { OtherRow } from "./q-other-row";
import { NewIngredientFromLine } from "./q-new-ingredient";
import { PdfLink } from "./q-pdf-link";

type Bundle = QuestionGroup["bundles"][number];

/** How many of the closest matches a row offers before anyone types. */
const CANDIDATES_SHOWN = 6;

/**
 * Match Lines: ONE review for ONE invoice. Every "which ingredient is this line?" question is a row; pick an ingredient, take a
 * suggestion, add a new ingredient, or mark the line Not In The App. The other questions on the invoice (pack sizes, big price
 * changes, totals) sit above, answered the same way. Nothing is saved until Save Matches, which sends every choice in one go and
 * looks at the invoice once. A line that could not be saved stays on screen with the reason; the rest are done.
 */
export function InvoiceReview({
  group,
  look,
  searchDocs,
  ingredients,
  sb,
  actor,
  venueSlug,
  venueName,
  showVenue,
  onSaved,
  onResolved,
}: {
  group: QuestionGroup;
  look: OptionLookups;
  searchDocs: readonly IngredientDoc[];
  ingredients: readonly IngredientLite[];
  sb: SupabaseClient;
  actor: string;
  venueSlug: string | null;
  venueName: string | null;
  showVenue: boolean;
  /** told once after Save Matches, with the sentence to show and whether everything saved */
  onSaved: (message: string, ok: boolean) => void;
  /** questions that no longer need an answer (saved, or answered by someone else) */
  onResolved: (ids: string[]) => void;
}) {
  const toast = useToast();
  const [decisions, setDecisions] = useState<ReadonlyMap<string, Decision>>(new Map());
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmNone, setConfirmNone] = useState(false);
  const [newFor, setNewFor] = useState<Bundle | null>(null);

  const { match, other } = useMemo(() => splitReview(group.bundles), [group.bundles]);
  const suggester = useMemo<Suggester>(() => buildSuggester(ingredients), [ingredients]);

  // suggestions and the closest matches for each row, worked out once per list of questions
  const perRow = useMemo(() => {
    const map = new Map<string, { suggestion: RowSuggestion | null; candidates: IngredientLite[] }>();
    for (const b of match) {
      const line = b.line;
      const local = line ? suggester.suggest({ description: line.description, item_code: line.item_code, unit: line.unit, unit_price_ex: line.unit_price_ex }, 5) : [];
      const suggestion = rowSuggestion(b.q.options, local, PRESET_SCORE);
      const ids: string[] = [];
      if (suggestion) ids.push(suggestion.ingredientId);
      for (const c of local) ids.push(c.ingredientId);
      // the engine's own offers (kept for questions raised before this screen existed) come last
      for (const o of b.q.options) if (o.ingredient_id) ids.push(o.ingredient_id);
      const seen = new Set<string>();
      const candidates: IngredientLite[] = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const ing = look.ingredients.get(id);
        if (ing) candidates.push(ing);
        if (candidates.length >= CANDIDATES_SHOWN) break;
      }
      map.set(b.q.id, { suggestion, candidates });
    }
    return map;
  }, [match, suggester, look.ingredients]);

  const nameOf = useCallback((id: string) => look.ingredients.get(id)?.name, [look.ingredients]);
  const suggestRows = useMemo(() => match.map((b) => ({ id: b.q.id, suggestion: perRow.get(b.q.id)?.suggestion ?? null })), [match, perRow]);
  const acceptable = acceptableCount(suggestRows, decisions, nameOf);
  const remaining = match.filter((b) => !decisions.has(b.q.id));
  const chosen = decisions.size;

  const decide = useCallback((id: string, d: Decision | null) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      if (d) next.set(id, d);
      else next.delete(id);
      return next;
    });
    setProblems((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    const answers = buildBatch(group.bundles, decisions);
    if (answers.length === 0) return true;
    setSaving(true);
    setBanner(null);
    try {
      const res = await answerQuestionsBatch(sb, { answers, actor });
      const done = res.results.filter((r) => r.status === "saved" || r.status === "already").map((r) => r.questionId);
      const failed = new Map(res.results.filter((r) => r.status === "failed").map((r) => [r.questionId, r.message]));
      setDecisions((prev) => {
        const next = new Map(prev);
        for (const id of done) next.delete(id);
        return next;
      });
      setProblems(failed);
      if (done.length) onResolved(done);
      onSaved(res.message, res.ok);
      toast.show({ message: res.ok ? res.message : `${res.message} The lines that did not save are still here.` });
      if (!res.ok) setBanner("Some lines could not be saved. Each one says why. Fix it and press Save Matches again.");
      return res.ok;
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "That did not save. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [saving, group.bundles, decisions, sb, actor, onResolved, onSaved, toast]);

  // choices are held on the screen only: leaving with some waiting asks first
  useUnsavedGuard(chosen > 0 && !saving, { save, getError: () => banner });

  const disabled = saving;
  const toIgnore = ignoreList(remaining);
  /** the confirmed "Not In The App: All Remaining": every line with no choice yet is marked, still unsaved until Save Matches */
  function markRemaining() {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const b of remaining) if (!next.has(b.q.id)) next.set(b.q.id, { t: "none" });
      return next;
    });
    setConfirmNone(false);
  }

  return (
    <section className="mt-6" aria-label={group.title}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 px-1 pb-2">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold leading-snug">{group.title}</h2>
          {showVenue && venueSlug && venueName ? (
            <p className="mt-0.5 text-[13px] text-label-2">
              <VenueTag slug={venueSlug} name={venueName} size={16} />
            </p>
          ) : null}
        </div>
        <Link href={`/invoices/${group.docId}`} className="inline-flex min-h-[44px] shrink-0 items-center text-[15px] font-medium text-accent">
          Open Invoice
        </Link>
      </div>
      <PdfLink sb={sb} path={group.bundles.find((b) => b.doc?.page_pdf_path)?.doc?.page_pdf_path} className="mb-1" />

      {banner ? <Banner>{banner}</Banner> : null}

      {other.length ? (
        <div className="mt-5">
          <h3 className="px-1 pb-2 text-[17px] font-semibold">Other Questions ({other.length})</h3>
          <ul className="divide-y divide-separator overflow-hidden rounded-2xl bg-surface">
            {other.map((b) => (
              <OtherRow key={b.q.id} bundle={b} look={look} decision={decisions.get(b.q.id)} problem={problems.get(b.q.id) ?? null} disabled={disabled} onDecide={(d) => decide(b.q.id, d)} />
            ))}
          </ul>
        </div>
      ) : null}

      {match.length ? (
        <div className="mt-5">
          <h3 className="px-1 pb-1 text-[17px] font-semibold">Match Lines ({match.length})</h3>
          <p className="px-1 pb-2 text-[13px] leading-snug text-label-2">
            Say what each line is in the app. Next time this supplier sends the same code, it is matched for you. Nothing is saved until you press Save Matches.
          </p>
          <div className="overflow-hidden rounded-2xl bg-surface">
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)] gap-5 border-b border-separator px-4 py-2 text-[13px] font-medium text-label-2 lg:grid" aria-hidden>
              <span>Invoice Line</span>
              <span>In The App As</span>
              <span>Status</span>
            </div>
            <ul className="divide-y divide-separator">
              {match.map((b) => {
                const info = perRow.get(b.q.id);
                const d = decisions.get(b.q.id);
                const sug = info?.suggestion ?? null;
                return (
                  <MatchRow
                    key={b.q.id}
                    bundle={b}
                    decision={d}
                    suggestion={sug}
                    suggestedIngredient={sug ? look.ingredients.get(sug.ingredientId) ?? null : null}
                    chosenIngredient={d?.t === "ingredient" ? look.ingredients.get(d.ingredientId) ?? { ...BLANK_ING, id: d.ingredientId, name: d.name } : null}
                    candidates={info?.candidates ?? []}
                    docs={searchDocs}
                    problem={problems.get(b.q.id) ?? null}
                    disabled={disabled}
                    onDecide={(next) => decide(b.q.id, next)}
                    onAddNew={() => setNewFor(b)}
                  />
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {/* room for the bar below, so the last row is never hidden behind it */}
      <div aria-hidden className="h-[170px] sm:h-[120px]" />

      <div
        role="region"
        aria-label="Save Matches"
        className="bar-blur fixed inset-x-0 bottom-[calc(50px+env(safe-area-inset-bottom))] z-[45] px-4 pb-3 pt-2.5 lg:bottom-0 lg:left-[248px]"
        style={{ boxShadow: "inset 0 0.5px 0 var(--separator)" }}
      >
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 lg:px-6">
          <p role="status" aria-live="polite" className="sr-only sm:not-sr-only sm:order-1 sm:flex-1 sm:basis-0 sm:text-[13px] sm:leading-snug sm:text-label-2">
            {saving ? "Saving. This takes a few seconds." : chosen === 0 ? `${match.length + other.length} to answer` : `${chosen} chosen, ${match.length + other.length - chosen} still open`}
          </p>
          {acceptable > 0 ? (
            <TouchButton variant="tinted" disabled={disabled} className="flex-1 !text-[15px] sm:order-2 sm:flex-none" onClick={() => setDecisions((d) => acceptSuggestions(suggestRows, d, nameOf))}>
              Accept All Suggestions ({acceptable})
            </TouchButton>
          ) : null}
          {remaining.length > 0 ? (
            <TouchButton variant="plain" disabled={disabled} className="flex-1 !text-[15px] sm:order-3 sm:flex-none" onClick={() => setConfirmNone(true)}>
              Not In The App: All Remaining ({remaining.length})
            </TouchButton>
          ) : null}
          <TouchButton variant="primary" disabled={disabled || chosen === 0} className="basis-full sm:order-4 sm:basis-auto" onClick={() => void save()}>
            {saving ? "Saving..." : saveLabel(chosen)}
          </TouchButton>
        </div>
      </div>

      <TouchSheet
        open={confirmNone}
        onClose={() => setConfirmNone(false)}
        title="Not In The App"
        action={{ label: "Mark Lines", onClick: markRemaining, disabled: remaining.length === 0 }}
      >
        <div className="pb-2">
          <p className="px-1 text-[15px] leading-snug text-label-2">
            These {remaining.length === 1 ? "line has" : `${remaining.length} lines have`} no ingredient chosen. Marking them Not In The App ignores them on this invoice, and the supplier&rsquo;s code is
            remembered so they are not asked about again. Nothing is saved until you press Save Matches.
          </p>
          <ul className="mt-3 max-h-[40vh] divide-y divide-separator overflow-y-auto rounded-xl bg-surface-2" aria-label="Lines that will be ignored">
            {toIgnore.map((l) => (
              <li key={l.id} className="px-4 py-2.5">
                <p className="break-words text-[15px] font-medium leading-snug">{l.title}</p>
                {l.code ? <p className="text-[13px] text-label-2 tnum">Code {l.code}</p> : null}
              </li>
            ))}
          </ul>
          <TouchButton
            variant="primary"
            className="mt-4 w-full"
            disabled={remaining.length === 0}
            onClick={markRemaining}
          >
            Mark {remaining.length === 1 ? "1 Line" : `${remaining.length} Lines`} As Not In The App
          </TouchButton>
        </div>
      </TouchSheet>

      {newFor ? (
        <NewIngredientFromLine
          key={newFor.q.id}
          bundle={newFor}
          onClose={() => setNewFor(null)}
          onSaved={(ing) => {
            decide(newFor.q.id, { t: "ingredient", ingredientId: ing.id, name: ing.name, via: "new" });
            setNewFor(null);
            toast.show({ message: `${ing.name} is added. Press Save Matches to match the line to it.` });
          }}
        />
      ) : null}
    </section>
  );
}

/** Shown for a just-added ingredient until the store has it in its list. */
const BLANK_ING: IngredientLite = { id: "", name: "", supplier_id: null, supplier_code: null, active: true, pack_size: 1, pack_unit: "each", pack_price: 0, price_inc_gst: false, gst_free: false };
