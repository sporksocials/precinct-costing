/**
 * Remembers how far down each page was scrolled when the person left it (Troy, 10 Oct 2026: open Onion in the Ingredients
 * list, press Back, land on Onion and not at the top). The key is the whole address (path and query), so Menu with Greedy
 * and Food remembers its own place. Held in sessionStorage (this tab only) with an in-memory copy for when storage is
 * blocked, and capped so it can never grow without limit. Pure helpers here; components/scroll-memory.tsx does the listening.
 */
const KEY = "pc-scroll";
const MAX_ENTRIES = 40;
const mem = new Map<string, number>();

function readAll(): Record<string, number> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") return o as Record<string, number>;
    }
  } catch {
    /* storage blocked or damaged: use the in-memory copy */
  }
  return Object.fromEntries(mem);
}

/** Pure: adds one position, drops the oldest beyond the cap, never stores a non-positive or non-finite number. */
export function withPosition(all: Record<string, number>, url: string, y: number, max = MAX_ENTRIES): Record<string, number> {
  const next = { ...all };
  delete next[url]; // re-insert so this address becomes the newest
  if (Number.isFinite(y) && y > 0) next[url] = Math.round(y);
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
  return next;
}

export function savePosition(url: string, y: number): void {
  const next = withPosition(readAll(), url, y);
  mem.clear();
  for (const [k, v] of Object.entries(next)) mem.set(k, v);
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function savedPosition(url: string): number {
  const v = readAll()[url];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Pure: a scroll to the very top just after a link was pressed is the page change itself, not the person; do not save it. */
export function isNavigationScroll(y: number, msSinceLinkPress: number | null): boolean {
  return y <= 0 && msSinceLinkPress != null && msSinceLinkPress < 800;
}

/** Pure: should the saved place be restored on arrival? Browser Back or Forward, a reload, or the back arrow (a link). */
export function shouldRestore(arrival: { popped: boolean; backArrow: boolean; navType?: string | null }): boolean {
  return arrival.popped || arrival.backArrow || arrival.navType === "back_forward" || arrival.navType === "reload";
}
