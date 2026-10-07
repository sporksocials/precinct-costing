import { MAX_PRINT, type PrintKind } from "./print-recipe";

/**
 * A print job: which records go on the page, in what order. The preview page (/print) reads `?kind=item|prep&ids=a,b,c`; the
 * Print button on a record and the Select bar on the Menu and Preps lists both build that address here.
 */

export const CAP_MESSAGE = `One print job holds up to ${MAX_PRINT} recipes. Print these first, then select the rest.`;

/** The preview address for a list of records of one kind, in the order given. */
export function printHref(kind: PrintKind, ids: readonly string[]): string {
  return `/print?kind=${kind}&ids=${ids.map(encodeURIComponent).join(",")}`;
}

export interface PrintParams {
  kind: PrintKind;
  /** unique ids in the order given, at most MAX_PRINT */
  ids: string[];
  /** true when the address asked for more than MAX_PRINT and the rest was left off */
  capped: boolean;
}

/** Reads the preview address. A missing or unknown kind reads as a menu item; duplicate and empty ids are dropped. */
export function parsePrintParams(kindRaw: string | null | undefined, idsRaw: string | null | undefined): PrintParams {
  const kind: PrintKind = kindRaw === "prep" ? "prep" : "item";
  const all = [...new Set((idsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  return { kind, ids: all.slice(0, MAX_PRINT), capped: all.length > MAX_PRINT };
}

/**
 * The selected ids in the order the list shows them. Anything selected that is not in the current list (a filter changed after
 * ticking it) follows, in the order it was ticked, so nothing a person chose is silently left off.
 */
export function orderSelected(shown: readonly string[], selected: readonly string[]): string[] {
  const chosen = new Set(selected);
  const inShown = shown.filter((id) => chosen.has(id));
  const seen = new Set(inShown);
  return [...inShown, ...selected.filter((id) => !seen.has(id))];
}

export interface SelectChange {
  selected: string[];
  /** CAP_MESSAGE when the change was refused or cut short, else null */
  message: string | null;
}

/** Ticks or unticks one record. A tick past the cap is refused with the plain message. */
export function toggleSelected(selected: readonly string[], id: string, cap = MAX_PRINT): SelectChange {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), message: null };
  if (selected.length >= cap) return { selected: [...selected], message: CAP_MESSAGE };
  return { selected: [...selected, id], message: null };
}

/** Select All Shown: the shown records in order, up to the cap (the message says when it was cut short). Ticks made earlier stay. */
export function selectAllShown(selected: readonly string[], shown: readonly string[], cap = MAX_PRINT): SelectChange {
  const next = [...selected];
  let cut = false;
  for (const id of shown) {
    if (next.includes(id)) continue;
    if (next.length >= cap) {
      cut = true;
      break;
    }
    next.push(id);
  }
  return { selected: next, message: cut ? CAP_MESSAGE : null };
}

/** "Print 1 Recipe" / "Print 12 Recipes". */
export function printLabel(count: number): string {
  return `Print ${count} ${count === 1 ? "Recipe" : "Recipes"}`;
}
