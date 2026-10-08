/**
 * Browser side of the smart name check: asks /api/name-check about a typed name, quietly.
 *
 * - Debounced: it waits until the person has stopped typing.
 * - Only asks when the tidied name has changed since the last answer, and remembers every answer in memory by exact text,
 *   so going back to a name it has seen costs nothing.
 * - Gives up after 6 seconds. Any failure (offline, signed out, a server error, a reply that does not check out) is
 *   silent: the person simply sees no smart suggestion. Layers 1 and 2 are the fallback.
 * - It only proposes: nothing here changes a name.
 * - Stops asking for the rest of the page's life after a sign-in refusal or three failures in a row, and never asks more
 *   than `maxAsks` times (a guard on cost).
 */
import { NAME_MAX, validateCorrection, type NameKind } from "./name-check";

export const CLIENT_TIMEOUT_MS = 6000;
export const DEBOUNCE_MS = 1000;
export const MAX_ASKS = 40;

export interface NameAnswer {
  /** the exact text that was asked about */
  text: string;
  corrected: string;
  reason: string;
}

export interface NameCheckerOptions {
  fetchImpl?: typeof fetch;
  debounceMs?: number;
  timeoutMs?: number;
  maxAsks?: number;
}

export interface NameChecker {
  /**
   * Asks about `text` after the debounce. `onAnswer` is called with the suggestion, or with null when there is none
   * (and only for the most recent request: an older answer that arrives late is dropped). `words` is only read when a
   * call is really made.
   */
  request(text: string, kind: NameKind, words: () => string[], onAnswer: (a: NameAnswer | null) => void): void;
  /** Forgets any waiting request and cancels the one in flight. */
  cancel(): void;
  /** How many calls have been made. */
  readonly asks: number;
  /** True once it has stopped asking for good. */
  readonly stopped: boolean;
}

export function createNameChecker(opts: NameCheckerOptions = {}): NameChecker {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const timeoutMs = opts.timeoutMs ?? CLIENT_TIMEOUT_MS;
  const maxAsks = opts.maxAsks ?? MAX_ASKS;

  // every answer by exact text (and kind): a name it has been asked about is never asked about again
  const cache = new Map<string, NameAnswer | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;
  let current = 0; // the request number whose answer is still wanted
  let asks = 0;
  let failures = 0;
  let stopped = false;

  const cancelInFlight = () => {
    clearTimeout(timer);
    abort?.abort();
    abort = undefined;
  };

  async function ask(n: number, key: string, text: string, kind: NameKind, words: string[], onAnswer: (a: NameAnswer | null) => void) {
    const ctl = new AbortController();
    abort = ctl;
    const giveUp = setTimeout(() => ctl.abort(), timeoutMs);
    let answer: NameAnswer | null = null;
    try {
      asks++;
      const res = await fetchImpl("/api/name-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: text, kind, words }),
        signal: ctl.signal,
      });
      if (res.status === 401 || res.status === 403) stopped = true;
      if (!res.ok) throw new Error(`http_${res.status}`);
      const body = (await res.json()) as { changed?: unknown; corrected?: unknown; reason?: unknown };
      failures = 0;
      if (body.changed === true) {
        // the route already checked this; check it again here, since this is the text a person will be shown
        const v = validateCorrection(text, JSON.stringify({ corrected: body.corrected, changed: true, reason: body.reason }));
        if ("changed" in v && v.changed) answer = { text, corrected: v.corrected, reason: v.reason };
      }
      cache.set(key, answer);
    } catch {
      failures++;
      if (failures >= 3) stopped = true;
      if (!ctl.signal.aborted || n === current) cache.set(key, null); // do not ask the same slow or broken thing again
      answer = null;
    } finally {
      clearTimeout(giveUp);
      if (abort === ctl) abort = undefined;
    }
    if (n === current) onAnswer(answer);
  }

  return {
    request(text, kind, words, onAnswer) {
      const n = ++current;
      cancelInFlight();
      const t = text.trim();
      const key = `${kind}|${t}`;
      if (!t || t.length > NAME_MAX) return onAnswer(null);
      if (cache.has(key)) {
        const hit = cache.get(key) ?? null;
        return onAnswer(hit);
      }
      if (stopped || asks >= maxAsks) return onAnswer(null);
      timer = setTimeout(() => {
        void ask(n, key, t, kind, words(), onAnswer);
      }, debounceMs);
    },
    cancel() {
      current++;
      cancelInFlight();
    },
    get asks() {
      return asks;
    },
    get stopped() {
      return stopped;
    },
  };
}
