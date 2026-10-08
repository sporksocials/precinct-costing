/**
 * What the name tidy has been told this session (until the page is reloaded; nothing is stored anywhere) and the rules
 * that decide what it does, as pure functions the screen code (components/name-suggest.tsx) calls:
 *
 * - a tidy a person undid is never applied to that exact text again;
 * - a name nobody changed is never tidied or questioned (existing records are left alone until a person edits the name);
 * - a suggestion a person kept their own spelling against is not offered again;
 * - at most one suggestion shows, and the smart one replaces the vocabulary one.
 */
import { sameButSpacing, tidyName } from "./name-tidy";

export interface NameSession {
  /** exact texts whose automatic tidy was undone */
  undone: Set<string>;
  /** folded words the person dismissed ("Keep Mine"): never questioned again */
  words: Set<string>;
  /** tidied texts the person dismissed a suggestion for: no suggestion of any kind for that text */
  texts: Set<string>;
}

export function createNameSession(): NameSession {
  return { undone: new Set(), words: new Set(), texts: new Set() };
}

/** The one session for the page. */
export const nameSession: NameSession = createNameSession();

/** How a text is remembered: spaces collapsed and trimmed, case kept. */
export const textKey = (s: string): string => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- layer 1: the automatic tidy

/**
 * What to do when a person leaves a name field: nothing (null), or put `tidied` in the field, `quiet` when only spacing
 * changed (no toast). Nothing happens for a name that is the same as when the field was entered (an existing name nobody
 * edited), for blank, for a name already tidy, and for a text whose tidy was undone.
 */
export function planBlur(typed: string, enteredWith: string | null, session: NameSession): { tidied: string; quiet: boolean } | null {
  if (typed === enteredWith || session.undone.has(typed)) return null;
  const tidied = tidyName(typed);
  if (!tidied || tidied === typed) return null;
  return { tidied, quiet: sameButSpacing(typed, tidied) };
}

/**
 * For a field that saves as soon as it is left: the name to save, and whether to say so with a toast. An undone text is
 * saved as typed (trimmed). Blank stays blank.
 */
export function planCommit(typed: string, session: NameSession): { name: string; announce: boolean } {
  const plain = typed.trim();
  if (!plain || session.undone.has(typed)) return { name: plain, announce: false };
  const tidied = tidyName(typed);
  return { name: tidied, announce: tidied !== plain && !sameButSpacing(typed, tidied) };
}

/** The name to save when the field was never left (Enter in a form): tidied, unless that tidy was undone. */
export function settleName(typed: string, session: NameSession): string {
  return session.undone.has(typed) ? typed.trim() : tidyName(typed);
}

/** The person tapped Undo on "Tidied to ...": that exact text is never tidied again. */
export function recordUndo(session: NameSession, typed: string): void {
  session.undone.add(typed);
}

// ---------------------------------------------------------------- layers 2 and 3: the suggestion

export interface NameSuggestion {
  /** the whole name with the fix in it, tidied */
  full: string;
  source: "dictionary" | "ai";
  /** why, in a few words (smart check only) */
  reason?: string;
  /** the typed words the fix replaces, folded, so Keep Mine can remember them */
  words: string[];
}

export interface AiAnswer {
  /** the exact tidied text it was asked about */
  text: string;
  corrected: string;
  reason: string;
  words: string[];
}

export interface SpellAnswer {
  full: string;
  words: string[];
}

/**
 * The one suggestion to show, or null. Nothing for a name the person has not changed, or whose suggestions were
 * dismissed. The smart answer wins when it is for the text now in the field and differs from it; otherwise the
 * vocabulary one.
 */
export function pickSuggestion(a: { tidied: string; touched: boolean; session: NameSession; ai: AiAnswer | null; spell: SpellAnswer | null }): NameSuggestion | null {
  if (!a.touched || a.session.texts.has(textKey(a.tidied))) return null;
  if (a.ai && a.ai.text === a.tidied) {
    const full = tidyName(a.ai.corrected);
    if (full && full !== a.tidied) return { full, source: "ai", reason: a.ai.reason, words: a.ai.words };
  }
  if (a.spell && a.spell.full !== a.tidied) return { full: a.spell.full, source: "dictionary", words: a.spell.words };
  return null;
}

/** "Keep Mine": remember the words, and that no suggestion is wanted for this text (as tidied and as typed). */
export function recordKeepMine(session: NameSession, s: Pick<NameSuggestion, "words">, tidied: string, typed: string): void {
  session.texts.add(textKey(tidied));
  session.texts.add(textKey(typed));
  for (const w of s.words) session.words.add(w);
}
