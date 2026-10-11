/** Lower case, single spaced, so "Pizza  copy" and "pizza Copy" are the same name. */
function key(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The name a copy starts with on the Duplicate sheet: "<Name> Copy", or "<Name> Copy 2", "Copy 3" and so on when that is taken at the venue.
 * A name that already ends in " Copy" or " Copy 2" is counted on from there, so duplicating a copy never reads "Pizza Copy Copy".
 */
export function suggestCopyName(name: string, existing: readonly string[]): string {
  const base = name.replace(/\s+/g, " ").trim().replace(/\s+Copy(\s+\d+)?$/i, "");
  const taken = new Set(existing.map(key));
  const first = `${base} Copy`;
  if (!taken.has(key(first))) return first;
  for (let n = 2; n < 1000; n++) {
    const next = `${base} Copy ${n}`;
    if (!taken.has(key(next))) return next;
  }
  return `${base} Copy ${Date.now()}`;
}
