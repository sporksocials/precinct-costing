"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { newId, useStore } from "@/lib/store";
import { parentKey } from "@/lib/costing";
import { formatQty } from "@/lib/parse-qty";
import { requestTidy } from "@/lib/method-assist-client";
import { tidyBuiltin, tidyNote, TidyError, type MethodOp, type TidyInput } from "@/lib/method-style";
import {
  applyKinds,
  describeMethodOp,
  effectCanApply,
  effectTone,
  hasApplied,
  KIND_LABEL,
  notesForRecord,
  opIsNoop,
  partitionNotes,
  planApply,
  researchNoteEffect,
  safeUrl,
  undoApplied,
  type ApplyPlan,
  type NoteEffect,
} from "@/lib/research-notes";
import type { AppliedRecord, MenuItem, RecipeLine, ResearchNote, ResearchStatus } from "@/lib/types";
import { cx, Group, useToast } from "../ui";
import { SaveConflictError, theirChangesOf } from "@/lib/edit-conflict";

/** The cost and GP effect of each note, worked out against the live recipe and prices. */
export function useNoteEffects(notes: readonly ResearchNote[]): Map<string, NoteEffect> {
  const { items, index, settings, targets } = useStore();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  return useMemo(() => {
    const out = new Map<string, NoteEffect>();
    for (const n of notes) {
      const item = n.item_id ? itemById.get(n.item_id) : null;
      if (n.item_id && !item) {
        out.set(n.id, { status: "text_only", text: "" });
        continue;
      }
      const lines = item ? index.linesByParent.get(parentKey("item", item.id)) ?? [] : [];
      out.set(n.id, researchNoteEffect({ changes: n.changes, item, lines, index, settings, targets }));
    }
    return out;
  }, [notes, itemById, index, settings, targets]);
}

// ---------------------------------------------------------------- where an applied note writes

/**
 * Where Approve writes the recipe. On the recipe page that is the editor's own draft (so its autosave persists it and
 * the page stays in step); on the review list it is the store. Both resolve `write` only once the change is saved.
 */
export interface RecipeTarget {
  getLines(): RecipeLine[];
  getMethod(): string[];
  write(next: { lines?: RecipeLine[]; method?: string[] }): Promise<void>;
  /** false once the page behind this target is gone (an Undo toast then falls back to the store) */
  alive?(): boolean;
}

/** Cocktails, mocktails and cold drinks keep their steps in `method`; a dish keeps them in `kitchen_method`. */
export function methodField(item: Pick<MenuItem, "category">): "method" | "kitchen_method" {
  return item.category === "Food" ? "kitchen_method" : "method";
}

export function methodOf(item: MenuItem | undefined): string[] {
  if (!item) return [];
  const m = item[methodField(item)];
  return Array.isArray(m) ? m.map(String) : [];
}

/** A target that works on the store. Its functions are stable and read the latest data, so it is safe in an Undo toast. */
function makeStoreTarget(get: () => ReturnType<typeof useStore>, itemId: string): RecipeTarget {
  return {
    getLines: () => get().getItemRecipe(itemId).lines,
    getMethod: () => methodOf(get().getItemRecipe(itemId).item),
    write: async ({ lines, method }) => {
      const s = get();
      const item = s.getItemRecipe(itemId).item;
      if (!item) throw new Error("Recipe not found");
      // this page holds no draft of its own, so the copy it planned from is the base: if the database has moved on since,
      // nothing is written (a line someone else added would otherwise be deleted by the whole-list save below)
      const fresh = await s.fetchFresh("item", itemId);
      if (!fresh.row) throw new Error("Recipe not found");
      const local = s.getItemRecipe(itemId);
      if (theirChangesOf(local.item as MenuItem, local.lines, fresh.row as MenuItem, fresh.lines).changed) {
        throw new SaveConflictError("Someone else changed this recipe a moment ago. Refresh the page, check it, then try again.");
      }
      if (lines) await s.saveLines("item", itemId, lines, { existing: fresh.lines });
      if (method) await s.updateItem(itemId, { [methodField(item)]: method } as Partial<MenuItem>);
    },
  };
}

function useStoreTarget(itemId: string | null): RecipeTarget | null {
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  return useMemo(() => (itemId ? makeStoreTarget(() => ref.current, itemId) : null), [itemId]);
}

// ---------------------------------------------------------------- the apply flow

type Flow =
  | { step: "idle" }
  | { step: "ask"; text: string; error?: string }
  | { step: "loading"; text: string }
  | { step: "preview"; text: string; op: MethodOp | null; method: string[]; effect: NoteEffect | undefined; plan: ApplyPlan; tidied?: string };

const TIDY_ERROR = "That cannot be a method step. Type a short instruction in words, then try again.";

function useNoteController(note: ResearchNote, editor: RecipeTarget | undefined) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const storeTarget = useStoreTarget(note.item_id);
  const target = editor ?? storeTarget;
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const item = note.item_id ? store.items.find((i) => i.id === note.item_id) : undefined;
  const kinds = applyKinds(note, !!item);

  const guard = async (fn: () => Promise<void>) => {
    if (alive.current) setBusy(true);
    try {
      await fn();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // ---- plain status changes (dismiss, reopen, approve a note with nothing to apply): saved, with an Undo toast ----
  const setStatus = useCallback(
    (next: ResearchStatus, label: string) =>
      guard(async () => {
        const previous = note.status;
        try {
          await storeRef.current.setResearchNoteStatus(note.id, next);
          toastRef.current.show({
            message: `${label}: ${note.title}`,
            action: {
              label: "Undo",
              onClick: () => {
                storeRef.current.setResearchNoteStatus(note.id, previous).catch(() => toastRef.current.show({ message: "Couldn’t undo. Try again." }));
              },
            },
          });
        } catch {
          toastRef.current.show({ message: "Couldn’t save that. Try again." });
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, note.status, note.title],
  );

  // ---- undo an applied change (toast Undo, or Undo And Reopen later) ----
  const undo = useCallback(
    (applied: AppliedRecord, next: ResearchStatus, label: string) =>
      guard(async () => {
        const s = storeRef.current;
        const t: RecipeTarget | null = editor && editor.alive?.() !== false ? editor : note.item_id ? makeStoreTarget(() => s, note.item_id) : null;
        try {
          let skipped: string[] = [];
          if (t) {
            const res = undoApplied(t.getLines(), t.getMethod(), applied);
            skipped = res.skipped;
            const changed = applied.lines.length > 0 || (applied.method_before && applied.method_after);
            if (changed) await t.write({ lines: applied.lines.length ? res.lines : undefined, method: applied.method_before && applied.method_after ? res.method : undefined });
          }
          await s.undoResearchNote(note.id, next);
          toastRef.current.show({ message: skipped.length ? `${label}. Some parts had already changed.` : `${label}: ${note.title}` });
        } catch (e) {
          toastRef.current.show({ message: e instanceof SaveConflictError ? e.message : "Couldn’t undo that. Nothing was changed." });
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, note.id, note.item_id, note.title],
  );

  // ---- Approve ----
  const tidyInput = (text: string, current: string[]): TidyInput | null => {
    const s = storeRef.current;
    if (!item || !target) return null;
    const lines = target.getLines().map((l) => ({
      name: (l.component_type === "ingredient" ? s.index.ingredients.get(l.component_id)?.name : s.index.preps.get(l.component_id)?.name) ?? "",
      qty: Number(l.qty) || 0,
      unit: l.unit,
    }));
    return {
      itemName: item.name,
      category: item.category,
      glass: item.glass ?? "",
      lines: lines.filter((l) => l.name),
      method: current,
      mode: kinds.question ? "answer" : "step",
      text,
      replaces: note.method_replaces?.trim() || undefined,
      noteTitle: note.title,
      question: kinds.question ? note.answer_prompt?.trim() || undefined : undefined,
      noteBody: note.body?.trim() ? note.body.trim().slice(0, 700) : undefined,
    };
  };

  const buildPreview = (text: string, op: MethodOp | null, tidied?: string) => {
    const s = storeRef.current;
    if (!item || !target) return;
    const lines = target.getLines();
    const method = target.getMethod();
    const effect = kinds.lines ? researchNoteEffect({ changes: note.changes, item, lines, index: s.index, settings: s.settings, targets: s.targets }) : undefined;
    const plan = planApply({ note, item, lines, method, effect, op, makeId: newId, now: new Date().toISOString() });
    setFlow({ step: "preview", text, op, method, effect, plan, tidied });
  };

  const tidy = async (text: string) => {
    if (!target) return;
    const method = target.getMethod();
    const input = tidyInput(text, method);
    if (!input) return;
    setFlow({ step: "loading", text });
    try {
      const res = await requestTidy(input);
      if (!alive.current) return;
      buildPreview(text, res.ops[0] ?? null, tidyNote(res));
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof TidyError) setFlow({ step: "ask", text, error: TIDY_ERROR });
      else {
        // anything unexpected: tidy right here instead
        try {
          buildPreview(text, tidyBuiltin(input).ops[0] ?? null, tidyNote({ source: "builtin", fallback: "unreachable" }));
        } catch {
          setFlow({ step: "ask", text, error: TIDY_ERROR });
        }
      }
    }
  };

  const approve = () => {
    if (!kinds.any || !target) {
      void setStatus("approved", "Approved");
      return;
    }
    if (kinds.question) setFlow({ step: "ask", text: "" });
    else if (kinds.method) void tidy(note.method_step ?? "");
    else buildPreview("", null);
  };

  const confirm = () =>
    guard(async () => {
      if (!item || !target) return;
      const s = storeRef.current;
      // recompute against the recipe as it is now (it may have been edited since the preview opened)
      const lines = target.getLines();
      const method = target.getMethod();
      const effect = kinds.lines ? researchNoteEffect({ changes: note.changes, item, lines, index: s.index, settings: s.settings, targets: s.targets }) : undefined;
      const op = flow.step === "preview" ? flow.op : null;
      const plan = planApply({ note, item, lines, method, effect, op, makeId: newId, now: new Date().toISOString() });
      if (!plan.linesChanged && !plan.methodChanged) {
        setFlow({ step: "idle" });
        await setStatus("approved", "Approved");
        return;
      }
      try {
        await target.write({ lines: plan.linesChanged ? plan.lines : undefined, method: plan.methodChanged ? plan.method : undefined });
      } catch (e) {
        toastRef.current.show({ message: e instanceof SaveConflictError ? e.message : "Couldn’t save the change. Try again." }, e instanceof SaveConflictError ? 8000 : undefined);
        return;
      }
      try {
        await s.applyResearchNote(note.id, plan.applied);
      } catch {
        // the recipe changed but the note did not record it: put the recipe back
        const back = undoApplied(target.getLines(), target.getMethod(), plan.applied);
        await target.write({ lines: plan.linesChanged ? back.lines : undefined, method: plan.methodChanged ? back.method : undefined }).catch(() => {});
        toastRef.current.show({ message: "Couldn’t save that. The recipe was left as it was." });
        return;
      }
      if (alive.current) setFlow({ step: "idle" });
      const previous = note.status;
      toastRef.current.show(
        {
          message: `Applied: ${note.title}`,
          action: { label: "Undo", onClick: () => void undo(plan.applied, previous, "Undone") },
        },
        8000,
      );
    });

  return {
    kinds,
    flow,
    setFlow,
    busy,
    approve,
    confirm,
    cancel: () => setFlow({ step: "idle" }),
    tidy,
    dismiss: () => void setStatus("dismissed", "Dismissed"),
    reopen: () => (hasApplied(note) && note.applied ? void undo(note.applied, "open", "Undone and reopened") : void setStatus("open", "Reopened")),
  };
}

const STATUS_PILL: Record<Exclude<ResearchStatus, "open">, { label: string; className: string }> = {
  approved: { label: "Approved", className: "bg-good-soft text-good" },
  dismissed: { label: "Dismissed", className: "bg-fill text-label-2" },
};

const TONE: Record<"warn" | "good" | "neutral", string> = {
  warn: "bg-warn-soft text-warn",
  good: "bg-good-soft text-good",
  neutral: "bg-fill text-label-2",
};

/** The one-tap preview: exactly what Approve will change, with the buttons to do it. */
function PreviewPanel({ flow, answer, busy, onConfirm, onCancel, onTryAgain }: { flow: Extract<Flow, { step: "preview" }>; answer: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void; onTryAgain: () => void }) {
  const { plan, effect, op, method } = flow;
  const lineChanges = plan.linesChanged ? (effect?.changedLines ?? []) : [];
  const methodText = op && plan.methodChanged ? describeMethodOp(method, op) : null;
  const dup = !!op && !plan.methodChanged && opIsNoop(method, op);
  const effectProblem = effect && !effectCanApply(effect) && effect.text ? effect.text : null;
  const nothing = !plan.linesChanged && !plan.methodChanged;
  const primary = nothing ? "Approve" : plan.linesChanged ? "Apply" : op?.op === "replace" ? "Apply" : "Add";
  const tone = effect && plan.linesChanged ? effectTone(effect) : "neutral";
  return (
    <div className="mt-3.5 sm:max-w-[68ch]">
      <div className="rounded-xl bg-fill px-3.5 py-3" role="region" aria-label="What will change">
        <p className="text-[13px] font-medium text-label-2">What will change</p>
        {lineChanges.length ? (
          <div className="mt-1.5">
            {lineChanges.map((c) => (
              <p key={c.ingredientId} className="text-[15px] font-medium leading-snug tnum">
                {c.from === 0 ? `Recipe: add ${c.name} ${formatQty(c.to, c.unit)}` : `Recipe: ${c.name} ${formatQty(c.from, c.unit)} to ${formatQty(c.to, c.unit)}`}
              </p>
            ))}
            {effect && effect.text ? <p className={cx("mt-1.5 inline-block rounded-lg px-2 py-1 text-[14px] leading-snug", TONE[tone])}>{effect.text}</p> : null}
          </div>
        ) : null}
        {effectProblem ? <p className="mt-1.5 text-[15px] leading-snug text-warn">{effectProblem}. The recipe lines will not change.</p> : null}
        {methodText ? (
          <div className={cx(lineChanges.length || effectProblem ? "mt-2.5" : "mt-1.5")}>
            <p className="text-[15px] font-semibold leading-snug">{methodText.headline}</p>
            {methodText.old ? <p className="mt-0.5 text-[15px] leading-snug text-label-2 line-through decoration-label-3">{methodText.old}</p> : null}
            <p className="mt-0.5 text-[17px] font-medium leading-snug">{methodText.text}</p>
          </div>
        ) : null}
        {dup ? <p className="mt-1.5 text-[15px] leading-snug">That step is already in the method, so there is nothing to add.</p> : null}
        {nothing && !dup && !effectProblem ? <p className="mt-1.5 text-[15px] leading-snug">Nothing in the recipe needs to change.</p> : null}
        {flow.tidied ? <p className="mt-2 text-[13px] leading-snug text-label-2">{flow.tidied}</p> : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary flex-1 sm:flex-none sm:px-6" disabled={busy} onClick={onConfirm}>
          {primary}
        </button>
        {answer ? (
          <button type="button" className="btn-plain whitespace-nowrap sm:px-5" disabled={busy} onClick={onTryAgain}>
            Try Again
          </button>
        ) : null}
        <button type="button" className="btn-plain whitespace-nowrap sm:px-5" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AskPanel({ prompt, flow, onText, onSubmit, onCancel }: { prompt: string; flow: Extract<Flow, { step: "ask" }>; onText: (t: string) => void; onSubmit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const empty = !flow.text.trim();
  return (
    <div className="mt-3.5 sm:max-w-[68ch]">
      <label htmlFor="note-answer" className="block text-[15px] font-medium leading-snug">
        {prompt}
      </label>
      <textarea
        id="note-answer"
        ref={ref}
        rows={2}
        maxLength={160}
        value={flow.text}
        placeholder="Type the step, for example Strain over ice in the glass"
        onChange={(e) => onText(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!empty) onSubmit();
          }
        }}
        className="field mt-2 resize-none"
        aria-describedby={flow.error ? "note-answer-error" : undefined}
      />
      {flow.error ? (
        <p id="note-answer-error" role="alert" className="mt-1.5 text-[14px] leading-snug text-warn">
          {flow.error}
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-label-2">Spelling and wording are tidied to match the rest of the menu. You will see the step before anything changes.</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary flex-1 sm:flex-none sm:px-5" disabled={empty} onClick={onSubmit}>
          Preview Step
        </button>
        <button type="button" className="btn-plain flex-1 sm:flex-none sm:px-5" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * One research note: kind chip, title, body, the cost and GP effect, sources, and Approve / Dismiss (or Reopen).
 * Approve on a note that changes the recipe first shows a preview of exactly what will change (and asks a question's
 * answer first); nothing is written until Add or Apply is tapped. Shared by the recipe page and the review page.
 * All controls are visible, none are tucked in a menu.
 */
export function ResearchNoteCard({
  note,
  effect,
  recipeHref,
  editor,
}: {
  note: ResearchNote;
  effect: NoteEffect | undefined;
  /** review page: link back to the recipe */
  recipeHref?: string | null;
  /** recipe page: write through the editor's draft instead of the store */
  editor?: RecipeTarget;
}) {
  const c = useNoteController(note, editor);
  const sources = note.sources.map((s) => ({ label: s.label || s.url, url: safeUrl(s.url) })).filter((s): s is { label: string; url: string } => !!s.url);
  const applied = note.status === "approved" && hasApplied(note);
  const tone = effect ? effectTone(effect) : "neutral";
  const dim = note.status === "dismissed";
  const idle = c.flow.step === "idle";
  return (
    <article className={cx("px-4 py-4", dim && "opacity-75")} aria-label={note.title}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-[22px] items-center rounded-full bg-accent-soft px-2.5 text-[12px] font-semibold leading-none text-accent">{KIND_LABEL[note.kind]}</span>
        {note.status !== "open" ? <span className={cx("inline-flex h-[22px] items-center rounded-full px-2.5 text-[12px] font-semibold leading-none", STATUS_PILL[note.status].className)}>{STATUS_PILL[note.status].label}</span> : null}
        {applied ? <span className="inline-flex h-[22px] items-center rounded-full bg-fill px-2.5 text-[12px] font-semibold leading-none text-label-2">Applied To Recipe</span> : null}
      </div>
      <h3 className="mt-2 text-[17px] font-semibold leading-snug">{note.title}</h3>
      {note.body ? <p className="mt-1 whitespace-pre-line text-[15px] leading-snug text-label-2 sm:max-w-[68ch]">{note.body}</p> : null}

      {applied && note.applied?.summary?.length ? (
        <div className="mt-3 rounded-xl bg-fill px-3 py-2.5 sm:max-w-[68ch]">
          <p className="text-[13px] font-medium text-label-2">What changed</p>
          {note.applied.summary.map((s, i) => (
            <p key={i} className="mt-0.5 text-[15px] leading-snug">
              {s}
            </p>
          ))}
        </div>
      ) : idle && effect && effect.text && !((c.kinds.method || note.status !== "open") && effect.status === "no_changes") ? (
        <div className={cx("mt-3 rounded-xl px-3 py-2.5 sm:max-w-[68ch]", TONE[tone])}>
          <p className="text-[15px] font-medium leading-snug">{effect.text}</p>
          {effect.status === "ok" && effect.changedLines?.length ? (
            <p className="mt-1 text-[13px] leading-snug opacity-90 tnum">
              {effect.changedLines.map((l) => `${l.name}: ${formatQty(l.from, l.unit)} to ${formatQty(l.to, l.unit)}`).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {sources.length ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-label-2">
          <span>Sources</span>
          {sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 font-medium text-accent hover:underline sm:min-h-0">
              {s.label}
              <ExternalLink className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            </a>
          ))}
        </p>
      ) : null}

      {c.flow.step === "ask" ? (
        <AskPanel
          prompt={note.answer_prompt ?? "What is the step?"}
          flow={c.flow}
          onText={(t) => c.setFlow({ step: "ask", text: t })}
          onSubmit={() => void c.tidy((c.flow as { text: string }).text)}
          onCancel={c.cancel}
        />
      ) : null}
      {c.flow.step === "loading" ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 sm:max-w-[68ch]" role="status">
          <p className="min-w-0 flex-1 text-[15px] text-label-2">Checking the wording…</p>
          <button type="button" className="btn-plain" onClick={c.cancel}>
            Cancel
          </button>
        </div>
      ) : null}
      {c.flow.step === "preview" ? (
        <PreviewPanel
          flow={c.flow}
          answer={c.kinds.question}
          busy={c.busy}
          onConfirm={() => void c.confirm()}
          onCancel={c.cancel}
          onTryAgain={() => c.setFlow({ step: "ask", text: (c.flow as { text: string }).text })}
        />
      ) : null}

      {idle ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {note.status === "open" ? (
            <>
              <button type="button" className="btn-primary flex-1 sm:flex-none sm:px-5" disabled={c.busy} onClick={c.approve}>
                Approve
              </button>
              <button type="button" className="btn-plain flex-1 sm:flex-none sm:px-5" disabled={c.busy} onClick={c.dismiss}>
                Dismiss
              </button>
            </>
          ) : (
            <button type="button" className="btn-plain flex-1 sm:flex-none sm:px-5" disabled={c.busy} onClick={c.reopen}>
              {hasApplied(note) ? "Undo And Reopen" : "Reopen"}
            </button>
          )}
          {recipeHref ? (
            <Link href={recipeHref} className="btn-text ml-auto hidden !gap-0 px-2 font-semibold sm:inline-flex">
              Open Recipe
              <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** The "Research Notes" group on a menu item or prep page. Renders nothing when the record has no notes. */
export function RecordResearchNotes({ kind, id, editor }: { kind: "item" | "prep"; id: string; editor?: RecipeTarget }) {
  const { researchNotes } = useStore();
  const notes = useMemo(() => notesForRecord(researchNotes, kind, id), [researchNotes, kind, id]);
  const effects = useNoteEffects(notes);
  const [showDone, setShowDone] = useState(false);
  if (!notes.length) return null;
  const { open, done } = partitionNotes(notes);
  const card = (n: ResearchNote) => <ResearchNoteCard key={n.id} note={n} effect={effects.get(n.id)} editor={editor} />;
  return (
    <Group
      title="Research Notes"
      className="mt-6"
      trailing={<span className="text-[13px] text-label-2 tnum">{open.length ? `${open.length} open` : "None open"}</span>}
      footer="Managers only. Never shown on the drinks station. Approving a note that changes the recipe shows you exactly what will change first, then updates the recipe when you tap Add or Apply. Undo puts it back."
    >
      {open.map(card)}
      {done.length ? <DoneToggle count={done.length} open={showDone} onToggle={() => setShowDone((s) => !s)} /> : null}
      {showDone ? done.map(card) : null}
    </Group>
  );
}

/** The visible "Done (n)" row that opens the approved and dismissed notes. */
export function DoneToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-fill active:bg-fill">
      <span className="min-w-0 flex-1 text-[17px] text-label-2 sm:text-[15px]">Done ({count})</span>
      <ChevronRight className={cx("h-[18px] w-[18px] shrink-0 text-label-3 transition-transform duration-200 ease-ios", open && "rotate-90")} strokeWidth={2.5} aria-hidden />
    </button>
  );
}
