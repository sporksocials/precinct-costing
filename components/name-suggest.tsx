"use client";

/**
 * The name tidy for every screen where a person types a name (new menu item, new prep, new ingredient, new tap beer,
 * and the name field on a record being edited). Three layers, each working without the next:
 *
 * 1. Automatic tidy (lib/name-tidy.ts): when the person LEAVES the field with a changed name, it is trimmed and put in
 *    Title Case, with a "Tidied to ..." toast and Undo. After an Undo that exact text is never tidied again.
 * 2. Did you mean (lib/name-vocab.ts): a word that is not in the app's own names but is one typo from one that is.
 * 3. Smart check (lib/name-check-client.ts, loaded on first use): the same, through the server's API key.
 *
 * Layers 2 and 3 only propose, in a quiet row under the field with Use It and Keep Mine. Nothing blocks Save, nothing is
 * applied without a tap, and only one suggestion shows at a time (the smart one replaces the vocabulary one). The hook
 * never writes to the database: it changes the field through `setValue`, exactly like typing, so a draft stays a draft
 * (the Save bar, leave guard and conflict check still apply). Existing names are left alone until a person edits one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { tidyName } from "@/lib/name-tidy";
import { nameSession, pickSuggestion, planBlur, planCommit, recordKeepMine, recordUndo, settleName, textKey, type AiAnswer, type NameSuggestion, type SpellAnswer } from "@/lib/name-session";
import type { NameKind } from "@/lib/name-check";
import type { NameChecker } from "@/lib/name-check-client";
import { cx, FieldRow, InlineInput, useToast } from "./ui";

export type { NameKind, NameSuggestion };

export interface NameTidy {
  /** put on the field: focus remembers what was there */
  onFocus: () => void;
  /** put on the field: tidies a name that changed, with a toast and Undo */
  onBlur: () => void;
  /** for fields that save as soon as they are left (no draft): tidy the typed text, toast, and return what to save */
  commit: (typed: string) => string;
  /** the name to save when the field was never left (Enter in a form): tidied, unless that tidy was undone */
  settle: (typed: string) => string;
  suggestion: NameSuggestion | null;
  useIt: () => void;
  keepMine: () => void;
}

/** Waiting time before the vocabulary check looks at a name still being typed. */
const TYPING_PAUSE_MS = 700;

export function useNameTidy({ kind, value, setValue, enabled = true, own = "" }: { kind: NameKind; value: string; setValue: (v: string) => void; enabled?: boolean; own?: string }): NameTidy {
  const store = useStore();
  const toast = useToast();
  const valueRef = useRef(value);
  valueRef.current = value;
  const setRef = useRef(setValue);
  setRef.current = setValue;
  const focusValue = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);
  /** the person has changed this name: nothing is questioned on a name nobody touched */
  const [touched, setTouched] = useState(false);
  const [tick, setTick] = useState(0);
  const [ai, setAi] = useState<AiAnswer | null>(null);
  const checkerRef = useRef<NameChecker | null>(null);

  const tidied = useMemo(() => tidyName(value), [value]);

  useEffect(() => {
    if (focused && focusValue.current !== null && value !== focusValue.current) setTouched(true);
  }, [value, focused]);

  // layer 2: the vocabulary check, once the person pauses (straight away once they have left the field)
  const [spell, setSpell] = useState<SpellAnswer | null>(null);
  useEffect(() => {
    if (!enabled || !touched || tidied.length < 4 || nameSession.texts.has(textKey(tidied))) {
      setSpell(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(
      () => {
        // the vocabulary code is a separate chunk, fetched the first time a changed name needs it
        void import("@/lib/name-vocab").then((v) => {
          if (!live) return;
          const vocab = v.sharedVocab([store.items, store.ingredients, store.preps, store.beer.beers], own);
          const hit = v.suggestSpelling(tidied, vocab, { dismissed: nameSession.words })[0];
          setSpell(hit ? { full: tidyName(v.applySuggestion(tidied, hit)), words: [v.foldWord(hit.word)] } : null);
        });
      },
      focused ? TYPING_PAUSE_MS : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tidied, touched, focused, enabled, tick, own, store.items, store.ingredients, store.preps, store.beer.beers]);

  // layer 3: the smart check. Its code is only fetched the first time a changed name needs it.
  useEffect(() => {
    if (!enabled || !touched || tidied.length < 4 || nameSession.texts.has(textKey(tidied))) return;
    let live = true;
    void Promise.all([import("@/lib/name-check-client"), import("@/lib/name-vocab")]).then(([m, v]) => {
      if (!live) return;
      const checker = (checkerRef.current ??= m.createNameChecker());
      checker.request(
        tidied,
        kind,
        () => v.contextWords(tidied, v.sharedVocab([store.items, store.ingredients, store.preps, store.beer.beers], own)),
        (a) => {
          if (!live) return;
          if (!a) return setAi(null);
          // the typed words the fix replaces, so Keep Mine can remember them
          const now = new Set(v.wordsOf(tidyName(a.corrected)).map((w) => w.key));
          setAi({ text: a.text, corrected: a.corrected, reason: a.reason, words: v.wordsOf(tidied).map((w) => w.key).filter((k) => !now.has(k)) });
        },
      );
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tidied, touched, enabled, kind, tick, own]);
  useEffect(() => () => checkerRef.current?.cancel(), []);

  // `tick` makes a dismissal show at once: the session sets are not React state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestion = useMemo<NameSuggestion | null>(() => (enabled ? pickSuggestion({ tidied, touched, session: nameSession, ai, spell }) : null), [enabled, touched, tidied, ai, spell, tick]);

  const onFocus = useCallback(() => {
    focusValue.current = valueRef.current;
    setFocused(true);
  }, []);

  const tidiedToast = useCallback(
    (tidied: string, typed: string, restore: string) =>
      toast.show({
        message: `Tidied to ${tidied}`,
        action: {
          label: "Undo",
          onClick: () => {
            recordUndo(nameSession, typed);
            setRef.current(restore);
          },
        },
      }),
    [toast],
  );

  const onBlur = useCallback(() => {
    setFocused(false);
    if (!enabled) return;
    const typed = valueRef.current;
    const plan = planBlur(typed, focusValue.current, nameSession);
    if (!plan) return;
    setRef.current(plan.tidied);
    if (!plan.quiet) tidiedToast(plan.tidied, typed, typed);
  }, [enabled, tidiedToast]);

  const commit = useCallback(
    (typed: string): string => {
      if (!enabled) return typed.trim();
      const plan = planCommit(typed, nameSession);
      if (!plan.name) return plan.name;
      setTouched(true);
      if (plan.announce) tidiedToast(plan.name, typed, typed.trim());
      return plan.name;
    },
    [enabled, tidiedToast],
  );

  const settle = useCallback((typed: string): string => (enabled ? settleName(typed, nameSession) : typed.trim()), [enabled]);

  const useIt = useCallback(() => {
    if (!suggestion) return;
    setTouched(true);
    setRef.current(suggestion.full);
  }, [suggestion]);

  const keepMine = useCallback(() => {
    if (!suggestion) return;
    recordKeepMine(nameSession, suggestion, tidied, valueRef.current);
    setTick((n) => n + 1);
  }, [suggestion, tidied]);

  return { onFocus, onBlur, commit, settle, suggestion, useIt, keepMine };
}

const TAP = "inline-flex min-h-[44px] min-w-[44px] select-none items-center justify-center rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.98] active:opacity-80";

/**
 * The quiet suggestion row under a name field. Both buttons are 44px at every width (the shared .btn shrinks at sm:, so
 * it is not used here). Nothing is shown when there is no suggestion.
 */
export function NameSuggestRow({ nt, className }: { nt: NameTidy; className?: string }) {
  const s = nt.suggestion;
  if (!s) return null;
  return (
    <div role="status" data-name-suggest={s.source} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-fill py-1.5 pl-3.5 pr-1.5", className)}>
      <p className="min-w-0 flex-1 basis-[13rem] text-[15px] leading-snug text-label-2 sm:text-[13px]">
        Did you mean <span className="break-words font-semibold text-label">{s.full}</span>?
        {s.reason ? <span className="sr-only"> {s.reason}</span> : null}
      </p>
      <div className="flex shrink-0 gap-2">
        <button type="button" className={cx(TAP, "bg-accent-soft text-accent")} onClick={nt.useIt}>
          Use It
        </button>
        <button type="button" className={cx(TAP, "bg-surface-2 text-label")} onClick={nt.keepMine}>
          Keep Mine
        </button>
      </div>
    </div>
  );
}

/**
 * A name row for a record that saves each field as it is left (an ingredient's or a tap beer's name): the typed name is
 * tidied before it is saved, and the suggestion row sits under it. `onSave` is the same call the page made before.
 */
export function NameFieldRow({ kind, value, onSave, label = "Name" }: { kind: NameKind; value: string; onSave: (name: string) => void; label?: string }) {
  const nt = useNameTidy({ kind, value, setValue: onSave, own: value });
  return (
    <>
      <FieldRow label={label}>
        <InlineInput
          value={value}
          inputMode="text"
          width="w-48"
          ariaLabel={label}
          onCommit={(t) => {
            const name = nt.commit(t);
            if (name && name !== value) onSave(name);
          }}
        />
      </FieldRow>
      {nt.suggestion ? (
        <div className="px-3 pb-3 pt-1">
          <NameSuggestRow nt={nt} />
        </div>
      ) : null}
    </>
  );
}
