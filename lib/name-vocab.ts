/**
 * Layer 2 of the name tidy: "Did you mean ...". A vocabulary of the words already used in the app's own names (menu
 * items, ingredients, preps, beers), and a pure check that compares the words of a typed name with it.
 *
 * The rule is deliberately cautious. A word is only questioned when it is NOT in the vocabulary AND a vocabulary word is
 * a single typo away (two for words of 8 letters or more). A word with no near match is simply a new word ("Karaage",
 * "Hiramasa", "Massaman") and gets silence. Pure, no network: the vocabulary is built from the store.
 */

/** Words shorter than this are never questioned. */
export const MIN_WORD = 4;
/** A word this long may be two typos away from its match. */
export const LONG_WORD = 8;

/** Lower case, accents removed ("Rosé" and "rose" are the same word), apostrophes gone. */
export function foldWord(w: string): string {
  return w
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’]s$/u, "")
    .replace(/['’]/gu, "");
}

export interface NameWord {
  /** as typed */
  text: string;
  /** index of the first letter in the name */
  start: number;
  /** folded form used for comparing */
  key: string;
  /** a digit sits right against the word ("150ml", "3d"): a size or a count, not a word to check */
  touchesDigit: boolean;
}

const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

/** The words of a name: runs of letters, an apostrophe inside a word stays inside it. */
export function wordsOf(name: string): NameWord[] {
  const out: NameWord[] = [];
  for (const m of name.matchAll(WORD)) {
    const start = m.index ?? 0;
    const text = m[0];
    const before = name[start - 1];
    const after = name[start + text.length];
    out.push({ text, start, key: foldWord(text), touchesDigit: (!!before && /\d/.test(before)) || (!!after && /\d/.test(after)) });
  }
  return out;
}

export interface Vocab {
  /** folded word -> number of names it appears in */
  counts: Map<string, number>;
  /** folded word -> the usual way it is written (keeps accents) */
  display: Map<string, string>;
  /** folded words by length, so a typo is only compared with words of nearly the same length */
  byLen: Map<number, string[]>;
  size: number;
}

/** Builds the vocabulary: each word counted once per name it appears in. */
export function buildVocab(names: Iterable<string>): Vocab {
  const counts = new Map<string, number>();
  const display = new Map<string, string>();
  for (const name of names) {
    if (!name) continue;
    const seen = new Set<string>();
    for (const w of wordsOf(name)) {
      if (w.key.length < 3 || w.touchesDigit || seen.has(w.key)) continue;
      seen.add(w.key);
      counts.set(w.key, (counts.get(w.key) ?? 0) + 1);
      const shown = w.text === w.text.toUpperCase() ? w.text.toLowerCase() : w.text.charAt(0).toLowerCase() + w.text.slice(1);
      // an accented spelling ("rosé") is the better one to show when both have been seen
      if (!display.has(w.key) || (shown !== w.key && display.get(w.key) === w.key)) display.set(w.key, shown);
    }
  }
  const byLen = new Map<number, string[]>();
  for (const k of counts.keys()) {
    const a = byLen.get(k.length);
    if (a) a.push(k);
    else byLen.set(k.length, [k]);
  }
  return { counts, display, byLen, size: counts.size };
}

/**
 * Edit distance between two folded words, a swap of two neighbouring letters counting as ONE edit (the commonest typo).
 * Returns max + 1 as soon as it is clear the distance is more than `max`.
 */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m] > max ? max + 1 : prev[m];
}

/** "prawn" and "prawns", "peach" and "peaches": a plural is a different word, not a typo. */
function onlyPlural(a: string, b: string): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return l === `${s}s` || l === `${s}es`;
}

export interface Suggestion {
  /** the word as typed */
  word: string;
  /** the vocabulary word, written like the typed one (capital first letter if the typed one had it) */
  suggestion: string;
  /** index of the typed word in the name, so a screen can replace exactly that word */
  start: number;
}

function matchCase(typed: string, found: string): string {
  return typed.charAt(0) === typed.charAt(0).toUpperCase() && typed.charAt(0) !== typed.charAt(0).toLowerCase() ? found.charAt(0).toUpperCase() + found.slice(1) : found;
}

/** The best near match for a folded word, or null. Nearest first, then the word used most often, then A to Z. */
function nearest(key: string, vocab: Vocab): string | null {
  const max = key.length >= LONG_WORD ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  let bestN = 0;
  for (let len = key.length - max; len <= key.length + max; len++) {
    const bucket = vocab.byLen.get(len);
    if (!bucket) continue;
    for (const cand of bucket) {
      // a short word must start the same way: it keeps "melon" from being mistaken for "lemon"
      if (key.length <= 5 && cand[0] !== key[0]) continue;
      const d = editDistance(key, cand, max);
      if (d > max || onlyPlural(key, cand)) continue;
      const n = vocab.counts.get(cand) ?? 0;
      if (d < bestD || (d === bestD && (n > bestN || (n === bestN && best !== null && cand < best)))) {
        best = cand;
        bestD = d;
        bestN = n;
      }
    }
  }
  return best;
}

/**
 * Words in `name` that are not in the vocabulary but are one typo (two for long words) from one that is. A word is
 * skipped when it is under 4 letters, sits against a digit, has a capital inside it (brand style: "ChioBu", "WMC") or
 * is in `dismissed` (folded or as typed). No near match: nothing, a new word is not a mistake.
 */
export function suggestSpelling(name: string, vocab: Vocab, opts: { dismissed?: ReadonlySet<string> } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const w of wordsOf(name)) {
    if (w.key.length < MIN_WORD || w.touchesDigit || seen.has(w.key)) continue;
    if (/\p{Lu}/u.test(w.text.slice(1))) continue;
    if (vocab.counts.has(w.key)) continue;
    if (opts.dismissed?.has(w.key) || opts.dismissed?.has(w.text.toLowerCase())) continue;
    seen.add(w.key);
    const found = nearest(w.key, vocab);
    if (!found) continue;
    out.push({ word: w.text, suggestion: matchCase(w.text, vocab.display.get(found) ?? found), start: w.start });
  }
  return out;
}

/** The name with one suggestion applied. */
export function applySuggestion(name: string, s: Pick<Suggestion, "word" | "suggestion" | "start">): string {
  return name.slice(0, s.start) + s.suggestion + name.slice(s.start + s.word.length);
}

/**
 * Up to `max` known words to show the smart check: first the words close to the ones in the typed name that the app
 * does not know (so a typo can be matched to the right word), then the words used most often. Written the usual way.
 */
export function contextWords(name: string, vocab: Vocab, max = 150): string[] {
  const picked: string[] = [];
  const has = new Set<string>();
  const add = (k: string) => {
    if (has.has(k) || picked.length >= max) return;
    has.add(k);
    picked.push(vocab.display.get(k) ?? k);
  };
  for (const w of wordsOf(name)) {
    if (w.key.length < MIN_WORD || w.touchesDigit || vocab.counts.has(w.key)) continue;
    const near: { k: string; d: number; n: number }[] = [];
    for (let len = w.key.length - 3; len <= w.key.length + 3; len++) {
      for (const cand of vocab.byLen.get(len) ?? []) {
        const d = editDistance(w.key, cand, 3);
        if (d <= 3) near.push({ k: cand, d, n: vocab.counts.get(cand) ?? 0 });
      }
    }
    near.sort((a, b) => a.d - b.d || b.n - a.n || (a.k < b.k ? -1 : 1));
    for (const c of near.slice(0, 12)) add(c.k);
  }
  if (picked.length < max) {
    const rest = [...vocab.counts.entries()].filter(([k]) => k.length >= 3).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [k] of rest) add(k);
  }
  return picked;
}

let shared: { key: unknown[]; own: string; vocab: Vocab } | null = null;

/**
 * One vocabulary for the whole app, built from the lists of records (anything with a name) and rebuilt only when one of
 * the lists is a different array. `own` is the name the record being edited is saved under: it is left out once, so a
 * typo that is already saved cannot vouch for itself.
 */
export function sharedVocab(lists: { name: string }[][], own = ""): Vocab {
  if (shared && shared.own === own && shared.key.length === lists.length && shared.key.every((l, i) => l === lists[i])) return shared.vocab;
  const names = lists.flatMap((l) => l.map((x) => x.name));
  const at = own ? names.indexOf(own) : -1;
  if (at >= 0) names.splice(at, 1);
  const vocab = buildVocab(names);
  shared = { key: lists, own, vocab };
  return vocab;
}
