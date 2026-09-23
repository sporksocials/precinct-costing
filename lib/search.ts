/**
 * Small typo-tolerant, token-based search scorer (no dependencies).
 *
 * Each query token must match some token of the document (exact, prefix, substring or within a small
 * edit distance). Score rewards exact/prefix hits, matches at the start of the title and shorter titles.
 */

export type SearchKind = "item" | "prep" | "ingredient" | "portal";

export interface SearchDoc {
  kind: SearchKind;
  id: string;
  title: string;
  sub: string;
  href: string;
  /** extra searchable text (supplier, category, code…), weighted lower than the title */
  extra?: string;
  /** static boost, e.g. to prefer active records */
  boost?: number;
}

export interface IndexedDoc extends SearchDoc {
  norm: string;
  titleTokens: string[];
  extraTokens: string[];
}

export interface SearchHit<T extends SearchDoc = SearchDoc> {
  doc: T;
  score: number;
}

export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalise(s);
  return n ? n.split(" ") : [];
}

export function indexDoc<T extends SearchDoc>(d: T): T & IndexedDoc {
  return { ...d, norm: normalise(d.title), titleTokens: tokenize(d.title), extraTokens: tokenize(d.extra ?? "") };
}

/** Optimal-string-alignment (Damerau) distance with an early-exit bound. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev2: number[] = new Array(n + 1).fill(0);
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
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
  return prev[n];
}

function allowedTypos(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

/** How well a single query token matches a single doc token (0 = no match). */
export function tokenScore(q: string, t: string): number {
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.9 - Math.min(0.2, (t.length - q.length) * 0.02);
  if (q.length >= 3 && t.includes(q)) return 0.6;
  const k = allowedTypos(q.length);
  if (k === 0) return 0;
  // compare against the whole token and against a same-length prefix (typo while still typing)
  const d = Math.min(editDistance(q, t, k), t.length > q.length ? editDistance(q, t.slice(0, q.length), k) + 0.5 : k + 1);
  if (d <= k) return 0.7 - d * 0.12;
  return 0;
}

function bestTokenScore(q: string, tokens: string[]): number {
  let best = 0;
  for (const t of tokens) {
    const s = tokenScore(q, t);
    if (s > best) {
      best = s;
      if (best === 1) break;
    }
  }
  return best;
}

/** Score one doc; 0 means "not a match". */
export function scoreDoc(queryTokens: string[], queryNorm: string, d: IndexedDoc): number {
  if (!queryTokens.length) return 0;
  let total = 0;
  for (const q of queryTokens) {
    const inTitle = bestTokenScore(q, d.titleTokens);
    const inExtra = d.extraTokens.length ? bestTokenScore(q, d.extraTokens) * 0.6 : 0;
    const s = Math.max(inTitle, inExtra);
    if (s === 0) return 0;
    total += s;
  }
  let score = total / queryTokens.length;
  if (d.norm === queryNorm) score += 0.6;
  else if (d.norm.startsWith(queryNorm)) score += 0.35;
  else if (d.norm.includes(queryNorm)) score += 0.15;
  score += Math.max(0, 0.15 - d.titleTokens.length * 0.02);
  score += d.boost ?? 0;
  return score;
}

export function search<T extends IndexedDoc>(docs: T[], query: string, limit = 50): SearchHit<T>[] {
  const qn = normalise(query);
  const qt = qn ? qn.split(" ") : [];
  if (!qt.length) return [];
  const hits: SearchHit<T>[] = [];
  for (const d of docs) {
    const s = scoreDoc(qt, qn, d);
    if (s > 0) hits.push({ doc: d, score: s });
  }
  hits.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));
  return hits.slice(0, limit);
}
