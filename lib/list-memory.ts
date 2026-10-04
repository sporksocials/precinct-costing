/**
 * Remembers how each list page was last left (Menu, Ingredients, Preps, Specials...): its address with the venue, category
 * chip, search, sort and Show Inactive. The back arrow at the top of a record page returns there, so Menu, Greedy, Food,
 * open a dish, tap the arrow lands on Greedy Food and not on a bare Greedy list. The browser's own Back button already did
 * (the filters live in the address); the arrow is a link, so it needs this. Held in sessionStorage (this tab only, gone
 * when it closes) with an in-memory copy for when storage is blocked.
 */
const PREFIX = "pc-list:";
const mem = new Map<string, string>();

function read(path: string): string | null {
  try {
    const v = window.sessionStorage.getItem(PREFIX + path);
    if (v != null) return v;
  } catch {
    /* storage blocked: use the in-memory copy */
  }
  return mem.get(path) ?? null;
}

/** Called by a list page whenever its address changes. `search` is `location.search` ("" or "?venue=greedy&cat=Food"). */
export function rememberList(path: string, search: string): void {
  const url = path + search;
  mem.set(path, url);
  try {
    window.sessionStorage.setItem(PREFIX + path, url);
  } catch {
    /* ignore */
  }
}

export interface BackRules {
  /** the record's own venue: a remembered list for a different venue is not used (the list was for something else) */
  venue?: string | null;
  /** the remembered address must carry this query value (preps live at /ingredients?type=preps) */
  require?: { key: string; value: string };
  /** the remembered address must NOT carry this query value (the Ingredients tab, not Preps) */
  forbid?: { key: string; value: string };
}

/** Pure part: whether a remembered address can be used for this record. Exported for tests. */
export function usableList(remembered: string | null, path: string, rules: BackRules = {}): boolean {
  if (!remembered) return false;
  const q = remembered.indexOf("?");
  const p = q === -1 ? remembered : remembered.slice(0, q);
  if (p !== path) return false;
  const sp = new URLSearchParams(q === -1 ? "" : remembered.slice(q + 1));
  const v = sp.get("venue");
  if (rules.venue && v && v !== rules.venue) return false;
  if (rules.require && sp.get(rules.require.key) !== rules.require.value) return false;
  if (rules.forbid && sp.get(rules.forbid.key) === rules.forbid.value) return false;
  return true;
}

/** Where a record page's back arrow goes: the list as it was left, else `fallback`. */
export function backTarget(path: string, fallback: string, rules: BackRules = {}): string {
  const r = read(path);
  return usableList(r, path, rules) ? (r as string) : fallback;
}
