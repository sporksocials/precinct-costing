"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { answerItemGroups } from "@/lib/invoice-answer";
import { updateProduct } from "@/lib/ordering-data";
import {
  loadLinkedProducts,
  loadOtherSupplierCounts,
  planBatchRenames,
  renameSummary,
  runMatchSave,
  undoRenames,
  type BatchRenamePlan,
  type RenameApplied,
  type RenameFailure,
  type SaveDeps,
} from "@/lib/invoice-match-save";
import { buildSuggester, PRESET_SCORE } from "@/lib/invoice-suggest";
import {
  acceptableItems,
  acceptItemSuggestions,
  buildDetails,
  buildItemAnswers,
  candidatesFor,
  chosenRenames,
  groupsForSupplier,
  groupSuggestions,
  ignoreItems,
  itemsToMatch,
  needsPackText,
  packsMap,
  progressText,
  rowSettled,
  screenOrder,
  supplierParam,
  useMatchData,
  type ItemGroup,
  type NameEdit,
} from "@/lib/invoice-todo-match";
import { ingredientSearchDocs, saveLabel, shortDate, type Decision, type IngredientLite } from "@/lib/invoice-questions-view";
import { INVOICES_UNAVAILABLE } from "@/lib/invoice-data-extra";
import { useUnsavedGuard } from "@/components/unsaved-guard";
import { TouchBack, TouchButton, TouchLink, TouchSheet } from "@/components/ordering/touch";
import { Banner, cx, Empty, ListSkeleton, PageHeader, useToast } from "@/components/ui";
import { MatchDetail } from "./match-detail";
import { RenameSheet } from "./match-rename-sheet";
import { ItemRow, ROW_GRID } from "./match-row";
import { NewIngredientFromLine } from "./q-new-ingredient";
import { PdfLink } from "./q-pdf-link";

/** Shown for a just-added ingredient until the store has it in its list. */
const BLANK_ING: IngredientLite = { id: "", name: "", supplier_id: null, supplier_code: null, active: true, pack_size: 1, pack_unit: "each", pack_price: 0, price_inc_gst: false, gst_free: false };

export type MatchScope = { kind: "supplier"; param: string } | { kind: "doc"; id: string };

const TODO_HREF = "/invoices?tab=todo";

/**
 * /invoices/match/<supplier>: every item one supplier sends that the app does not know yet. One row per ITEM (not per invoice
 * line): the answer is remembered for every invoice and every venue, so a choice here settles all the lines about that item.
 * `/invoices/match/doc/<id>` shows the same rows for the items on one invoice. Nothing is saved until Save Matches.
 */
export function MatchScreen({ scope }: { scope: MatchScope }) {
  const store = useStore();
  const toast = useToast();
  const { sb, groups: all, available, error, reload } = useMatchData(null);
  const [decisions, setDecisions] = useState<ReadonlyMap<string, Decision>>(new Map());
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  // items saved this visit leave the list at once, before the fresh copy arrives
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [last, setLast] = useState<SavedNote | null>(null);
  const [confirmNone, setConfirmNone] = useState(false);
  const [newFor, setNewFor] = useState<ItemGroup | null>(null);
  // the pack number and the new name are held on the screen too, until Save Matches
  const [typedPacks, setTypedPacks] = useState<ReadonlyMap<string, string>>(new Map());
  const [nameEdits, setNameEdits] = useState<ReadonlyMap<string, NameEdit>>(new Map());
  const [otherSuppliers, setOtherSuppliers] = useState<ReadonlyMap<string, number>>(new Map());
  const [planning, setPlanning] = useState(false);
  const [confirmRename, setConfirmRename] = useState<BatchRenamePlan | null>(null);
  const [undoing, setUndoing] = useState(false);

  const ingredients = store.ingredients;
  const ingById = useMemo(() => new Map<string, IngredientLite>(ingredients.map((i) => [i.id, i])), [ingredients]);
  const searchDocs = useMemo(() => ingredientSearchDocs(ingredients, (id) => store.supplierById.get(id)?.name), [ingredients, store.supplierById]);
  const suggester = useMemo(() => buildSuggester(ingredients), [ingredients]);

  const scoped = useMemo(() => {
    if (!all) return null;
    const mine = scope.kind === "supplier" ? groupsForSupplier(all, scope.param) : all.filter((g) => g.invoices.some((i) => i.docId === scope.id));
    return mine.filter((g) => !gone.has(g.key));
  }, [all, scope, gone]);

  const sugg = useMemo(() => (scoped ? groupSuggestions(scoped, (l, n) => suggester.suggest(l, n), PRESET_SCORE) : new Map()), [scoped, suggester]);
  const rows = useMemo(() => (scoped ? screenOrder(scoped, (k) => !!sugg.get(k)?.suggestion && !!ingById.get(sugg.get(k)!.suggestion!.ingredientId)) : []), [scoped, sugg, ingById]);

  const nameOf = useCallback((id: string) => ingById.get(id)?.name, [ingById]);
  const acceptable = acceptableItems(rows, sugg, decisions, nameOf);
  const remaining = rows.filter((g) => !decisions.has(g.key));
  const total = rows.length;

  // other suppliers' items already matched to an ingredient decide whether a rename starts on (the first supplier names it)
  const supplierId = rows[0]?.supplierId ?? null;
  const loaded = all !== null;
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    void loadOtherSupplierCounts(sb, supplierId).then((m) => live && setOtherSuppliers(m));
    return () => {
      live = false;
    };
  }, [sb, supplierId, loaded]);

  const details = useMemo(
    () => buildDetails(rows, decisions, { ingById, ingredients, gstRate: store.settings.gst_rate, typedPacks, nameEdits, otherSuppliers }),
    [rows, decisions, ingById, ingredients, store.settings.gst_rate, typedPacks, nameEdits, otherSuppliers],
  );
  // a row counts as chosen only once its match AND its pack number are settled
  const settled = rows.filter((g) => rowSettled(decisions.get(g.key), details.get(g.key)));
  const chosen = settled.length;
  const unsettled = rows.filter((g) => decisions.has(g.key) && !rowSettled(decisions.get(g.key), details.get(g.key))).length;
  const packText = needsPackText(unsettled);

  const decide = useCallback((key: string, d: Decision | null) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      if (d) next.set(key, d);
      else next.delete(key);
      return next;
    });
    // a different ingredient starts from its own pack number and name
    setTypedPacks((prev) => (prev.has(key) ? withoutKey(prev, key) : prev));
    setNameEdits((prev) => (prev.has(key) ? withoutKey(prev, key) : prev));
    setProblems((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const deps = useMemo<SaveDeps>(
    () => ({
      answer: (groups) => answerItemGroups(sb, { groups, actor: store.userEmail ?? "unknown" }),
      renameIngredient: (id, name) => store.updateIngredient(id, { name }),
      renameDish: (id, name) => store.updateItem(id, { name }),
      renameProduct: async (id, patch) => void (await updateProduct(sb, id, patch)),
    }),
    [sb, store],
  );

  /** Saves the matches (each with its pack number), then the renames in `plan`; null plan = leave every name alone. */
  const runSave = useCallback(
    async (plan: BatchRenamePlan | null): Promise<boolean> => {
      if (saving) return false;
      const built = buildItemAnswers(rows, decisions, packsMap(details));
      if (built.length === 0) return true;
      setSaving(true);
      setBanner(null);
      try {
        const out = await runMatchSave(deps, { answers: built, plan });
        const res = out.result;
        setDecisions((prev) => {
          const next = new Map(prev);
          for (const k of out.savedKeys) next.delete(k);
          return next;
        });
        setProblems(out.failedKeys);
        setGone((prev) => new Set([...prev, ...out.savedKeys]));
        setSaved((n) => n + out.savedKeys.size);
        const renamed = renameSummary(out);
        const hasApplied = out.applied.ingredients.length + out.applied.dishes.length + out.applied.products.length > 0;
        setLast(res.ok || out.savedKeys.size > 0 ? { message: res.message, renamed, applied: hasApplied ? out.applied : null, failures: out.renameFailures } : null);
        toast.show({ message: res.ok ? [res.message, renamed].filter(Boolean).join(" ") : `${res.message} The items that did not save are still here.` });
        if (!res.ok) setBanner(`${res.message} Each item that did not save says why. Fix it and press Save Matches again.`);
        // the answers may have settled other lines on these invoices, or raised a new question: read the list again
        void reload();
        return res.ok;
      } catch (e) {
        setBanner(e instanceof Error ? e.message : "That did not save. Try again.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [saving, rows, decisions, details, deps, toast, reload],
  );

  // Save And Leave (from the leave guard) saves the matches only: names are never changed without the confirm sheet
  const save = useCallback(() => runSave(null), [runSave]);

  /** Save Matches: when any rename is chosen, the plan (with the names that follow) is shown first and nothing is saved until confirmed. */
  const onSaveClick = useCallback(async () => {
    const renames = chosenRenames(rows, decisions, details);
    if (renames.length === 0) {
      await runSave(null);
      return;
    }
    setPlanning(true);
    setBanner(null);
    try {
      const products = await loadLinkedProducts(sb);
      setConfirmRename(planBatchRenames({ renames, ingredients, items: store.items, lines: store.lines, products }));
    } finally {
      setPlanning(false);
    }
  }, [rows, decisions, details, runSave, sb, ingredients, store.items, store.lines]);

  const chooseRename = useCallback(
    (plan: BatchRenamePlan | null) => {
      setConfirmRename(null);
      void runSave(plan);
    },
    [runSave],
  );

  const undoNames = useCallback(async () => {
    const applied = last?.applied;
    if (!applied || undoing) return;
    setUndoing(true);
    try {
      const r = await undoRenames(deps, applied);
      setLast((l) => (l ? { ...l, renamed: null, applied: null, failures: r.failed, note: r.failed.length ? `${r.restored} names put back. ${r.failed.length} could not be put back.` : `${r.restored} ${r.restored === 1 ? "name is" : "names are"} back as they were.` } : l));
      toast.show({ message: r.failed.length ? "Some names could not be put back." : "Names put back." });
    } finally {
      setUndoing(false);
    }
  }, [last, undoing, deps, toast]);

  // choices are held on the screen only: leaving with some waiting asks first
  useUnsavedGuard(decisions.size > 0 && !saving, { save, getError: () => banner });

  /** the confirmed "Not In The App: All Remaining": every item with no choice yet is marked, still unsaved until Save Matches */
  function markRemaining() {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const g of remaining) if (!next.has(g.key)) next.set(g.key, { t: "none" });
      return next;
    });
    setConfirmNone(false);
  }

  const loading = scoped === null;
  const first = rows[0] ?? scoped?.[0];
  const doc = scope.kind === "doc" ? all?.flatMap((g) => g.bundles).find((b) => b.q.document_id === scope.id)?.doc ?? null : null;
  // the name stays on screen after the last item is saved and the list comes back empty
  const nameSeen = useRef<string | null>(null);
  const found = first?.supplierName ?? (scope.kind === "supplier" && all ? supplierNameFor(all, scope.param) : null) ?? doc?.supplier_name_read ?? null;
  if (found) nameSeen.current = found;
  const supplierName = nameSeen.current;
  const title = supplierName ?? (scope.kind === "doc" ? "This Invoice" : "Match Items");
  const subtitle = loading
    ? undefined
    : scope.kind === "doc"
      ? [doc?.invoice_number ? `Invoice ${doc.invoice_number}` : "Invoice", shortDate(doc?.invoice_date, store.today) || null, total ? itemsToMatch(total) : null].filter(Boolean).join(" · ")
      : total
        ? itemsToMatch(total)
        : "All done";
  const finished = !loading && available && total === 0;
  const bar = !loading && available && total > 0;

  return (
    <div className="max-w-5xl pb-8">
      <div className="pt-1 lg:pt-6">
        <TouchBack path={TODO_HREF} fallback={TODO_HREF}>
          To Do
        </TouchBack>
      </div>
      <PageHeader title={title} subtitle={subtitle} className="!pt-0 lg:!pt-2" />
      {!loading && available && total > 0 ? (
        <p className="max-w-2xl text-[15px] leading-snug text-label-2">
          {scope.kind === "doc"
            ? "Tell the app what these items are once. It remembers them for every venue and every future invoice, and the same items on other invoices are settled too."
            : "Tell the app what these items are once. It remembers them for every venue and every future invoice."}
        </p>
      ) : null}
      {scope.kind === "doc" && !loading ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <PdfLink sb={sb} path={doc?.page_pdf_path} />
          {first ? (
            <Link href={`/invoices/match/${supplierParam(first.supplierId)}`} className="inline-flex min-h-[44px] items-center text-[15px] font-medium text-accent">
              Show All {supplierName} Items
            </Link>
          ) : null}
        </div>
      ) : null}

      {error ? <Banner>{error}</Banner> : null}
      {banner ? <Banner>{banner}</Banner> : null}
      {loading && !error ? <ListSkeleton rows={4} /> : null}
      {!loading && !available ? <Empty title="Invoices Are Not Set Up Yet" body={INVOICES_UNAVAILABLE} /> : null}

      {last && !finished ? <ResultNote note={last} undoing={undoing} onUndo={() => void undoNames()} /> : null}

      {finished ? (
        <div className="mt-6 rounded-2xl bg-surface px-5 py-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-good" strokeWidth={2} aria-hidden />
          <h2 className="mt-3 text-[22px] font-semibold">All Done. Nice work.</h2>
          <p className="mx-auto mt-1 max-w-md text-[15px] leading-snug text-label-2">
            {last ? last.message : saved > 0 ? `${saved} ${saved === 1 ? "item is" : "items are"} matched.` : "There is nothing left to match here."}
          </p>
          {last && (last.renamed || last.note || last.failures.length) ? <ResultNote note={last} undoing={undoing} onUndo={() => void undoNames()} bare /> : null}
          <TouchLink href={TODO_HREF} variant="primary" className="mt-5 min-h-[48px]">
            Back To To Do
          </TouchLink>
        </div>
      ) : null}

      {bar ? (
        <>
          <p className="mt-4 px-1 text-[15px] font-medium text-label-2" aria-live="polite">
            {progressText(chosen, total)}
            {packText ? <span className="mt-0.5 block text-[13px] font-normal text-warn">{packText}</span> : null}
          </p>
          <div className="mt-2 overflow-hidden rounded-2xl bg-surface">
            <div className={cx("hidden gap-5 border-b border-separator px-4 py-2 text-[13px] font-medium text-label-2 lg:grid", ROW_GRID)} aria-hidden>
              <span>Item</span>
              <span>Seen On</span>
              <span>Last Price</span>
              <span>In The App As</span>
            </div>
            <ul className="divide-y divide-separator" aria-label="Items to match">
              {rows.map((g) => {
                const d = decisions.get(g.key);
                const s = sugg.get(g.key);
                const sug = s?.suggestion ?? null;
                return (
                  <ItemRow
                    key={g.key}
                    group={g}
                    decision={d}
                    suggestion={sug}
                    suggestedIngredient={sug ? ingById.get(sug.ingredientId) ?? null : null}
                    chosenIngredient={d?.t === "ingredient" ? ingById.get(d.ingredientId) ?? { ...BLANK_ING, id: d.ingredientId, name: d.name } : null}
                    candidates={candidatesFor(s?.candidateIds ?? [], ingById)}
                    docs={searchDocs}
                    problem={problems.get(g.key) ?? null}
                    disabled={saving}
                    today={store.today}
                    detail={
                      details.get(g.key) ? (
                        <MatchDetail
                          detail={details.get(g.key)!}
                          disabled={saving}
                          onPacks={(text) => setTypedPacks((prev) => new Map(prev).set(g.key, text))}
                          onName={(text) => setNameEdits((prev) => new Map(prev).set(g.key, { ...prev.get(g.key), text }))}
                          onKeep={(keep) => setNameEdits((prev) => new Map(prev).set(g.key, { ...prev.get(g.key), keep }))}
                        />
                      ) : null
                    }
                    onDecide={(next) => decide(g.key, next)}
                    onAddNew={() => setNewFor(g)}
                  />
                );
              })}
            </ul>
          </div>

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
                {saving ? "Saving. This takes a few seconds." : packText ?? progressText(chosen, total)}
              </p>
              {acceptable > 0 ? (
                <TouchButton variant="tinted" disabled={saving} className="flex-1 !text-[15px] sm:order-2 sm:flex-none" onClick={() => setDecisions((d) => acceptItemSuggestions(rows, sugg, d, nameOf))}>
                  Accept All Suggestions ({acceptable})
                </TouchButton>
              ) : null}
              {remaining.length > 0 ? (
                <TouchButton variant="plain" disabled={saving} className="flex-1 !text-[15px] sm:order-3 sm:flex-none" onClick={() => setConfirmNone(true)}>
                  Not In The App: All Remaining ({remaining.length})
                </TouchButton>
              ) : null}
              <TouchButton variant="primary" disabled={saving || planning || chosen === 0} className="basis-full sm:order-4 sm:basis-auto" onClick={() => void onSaveClick()}>
                {saving ? "Saving..." : planning ? "Checking Names..." : saveLabel(chosen)}
              </TouchButton>
            </div>
          </div>
        </>
      ) : null}

      {confirmRename ? <RenameSheet plan={confirmRename} venues={store.venues} onChoose={chooseRename} onClose={() => setConfirmRename(null)} /> : null}

      <TouchSheet open={confirmNone} onClose={() => setConfirmNone(false)} title="Not In The App" action={{ label: "Mark Items", onClick: markRemaining, disabled: remaining.length === 0 }}>
        <div className="pb-2">
          <p className="px-1 text-[15px] leading-snug text-label-2">
            {remaining.length === 1 ? "This item has" : `These ${remaining.length} items have`} no ingredient chosen. Marking {remaining.length === 1 ? "it" : "them"} Not In The App ignores {remaining.length === 1 ? "it" : "them"} on every invoice, and the
            supplier&rsquo;s code is remembered so {remaining.length === 1 ? "it is" : "they are"} not asked about again. Nothing is saved until you press Save Matches.
          </p>
          <ul className="mt-3 max-h-[40vh] divide-y divide-separator overflow-y-auto rounded-xl bg-surface-2" aria-label="Items that will be ignored">
            {ignoreItems(remaining).map((l) => (
              <li key={l.key} className="px-4 py-2.5">
                <p className="break-words text-[15px] font-medium leading-snug">{l.title}</p>
                {l.code ? <p className="text-[13px] text-label-2 tnum">Code {l.code}</p> : null}
              </li>
            ))}
          </ul>
          <TouchButton variant="primary" className="mt-4 w-full" disabled={remaining.length === 0} onClick={markRemaining}>
            Mark {remaining.length === 1 ? "1 Item" : `${remaining.length} Items`} As Not In The App
          </TouchButton>
        </div>
      </TouchSheet>

      {newFor ? (
        <NewIngredientFromLine
          key={newFor.key}
          bundle={newFor.bundles[0]}
          onClose={() => setNewFor(null)}
          onSaved={(ing) => {
            decide(newFor.key, { t: "ingredient", ingredientId: ing.id, name: ing.name, via: "new" });
            setNewFor(null);
            toast.show({ message: `${ing.name} is added. Press Save Matches to match the item to it.` });
          }}
        />
      ) : null}
    </div>
  );
}

function supplierNameFor(all: readonly ItemGroup[], param: string): string | null {
  return all.find((g) => supplierParam(g.supplierId) === param)?.supplierName ?? null;
}

/** What the last save did: the match sentence, the rename sentence with its Undo, and anything that could not be changed. */
interface SavedNote {
  message: string;
  /** "Renamed 14 items and 9 linked names." */
  renamed: string | null;
  /** the old names, kept for this visit so Undo Renames can put them back */
  applied: RenameApplied | null;
  failures: RenameFailure[];
  /** the sentence shown after Undo Renames */
  note?: string;
}

function withoutKey<V>(m: ReadonlyMap<string, V>, key: string): Map<string, V> {
  const next = new Map(m);
  next.delete(key);
  return next;
}

function ResultNote({ note, undoing, onUndo, bare }: { note: SavedNote; undoing: boolean; onUndo: () => void; bare?: boolean }) {
  return (
    <div className={bare ? "mt-3" : "mt-4 rounded-xl bg-fill px-4 py-2.5"} aria-live="polite">
      {!bare ? (
        <p className="flex items-start gap-2 text-[15px] text-label-2">
          <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-good" strokeWidth={2.25} aria-hidden />
          <span className="min-w-0">{note.message}</span>
        </p>
      ) : null}
      {note.renamed ? <p className={bare ? "text-[15px] text-label-2" : "mt-1 pl-[26px] text-[15px] text-label-2"}>{note.renamed}</p> : null}
      {note.note ? <p className={bare ? "text-[15px] text-label-2" : "mt-1 pl-[26px] text-[15px] text-label-2"}>{note.note}</p> : null}
      {note.failures.length ? (
        <ul className={bare ? "mt-1 text-[13px] text-warn" : "mt-1 pl-[26px] text-[13px] text-warn"}>
          {note.failures.slice(0, 5).map((f) => (
            <li key={f.what}>
              {f.what} could not be renamed. {f.message}
            </li>
          ))}
        </ul>
      ) : null}
      {note.applied ? (
        <TouchButton variant="tinted" disabled={undoing} className={bare ? "mt-2 !text-[15px]" : "ml-[26px] mt-1.5 !text-[15px]"} onClick={onUndo}>
          <Undo2 className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          {undoing ? "Putting Names Back..." : "Undo Renames"}
        </TouchButton>
      ) : null}
    </div>
  );
}
