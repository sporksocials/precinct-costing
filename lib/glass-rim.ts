/**
 * Glass and rim for a cocktail, mocktail or cold drink. The drink stores ONE text value in cost_menu_items.glass, because the
 * public drinks station reads that text (and derives its glass icon from it): "<Glass>" or "<Glass>, <Rim> Rim".
 * The recipe editor shows it as two pickers; these helpers split and join that text and tidy names typed into the
 * "add a new one" pop-up. Pure and framework free.
 */
import type { BarOption, BarOptionKind } from "./types";

export interface GlassParts {
  /** the glass as stored (may not be in the list: old or hand typed) */
  glass: string;
  /** the rim name WITHOUT the trailing " Rim"; "" for none */
  rim: string;
}

/**
 * Splits stored glass text on the LAST ", " when what follows ends in " Rim" ("High Ball Glass, Salt Rim" gives
 * glass "High Ball Glass", rim "Salt"). Anything else is all glass, so hand-typed text is never cut up wrongly.
 */
export function parseGlass(text: string | null | undefined): GlassParts {
  const t = (text ?? "").trim();
  const m = /^(.*),\s+([^,]*?)\s+rim$/i.exec(t);
  if (m && m[1].trim() && m[2].trim()) return { glass: m[1].trim(), rim: m[2].trim() };
  return { glass: t, rim: "" };
}

/** The text a drink stores: glass plus ", <Rim> Rim" when there is a rim. No glass means nothing stored (null). */
export function composeGlass(glass: string | null | undefined, rim: string | null | undefined): string | null {
  const g = (glass ?? "").trim();
  if (!g) return null;
  const r = (rim ?? "").trim();
  return r ? `${g}, ${r} Rim` : g;
}

/**
 * Tidies a name typed into the add pop-up: trims and collapses whitespace, turns dashes into hyphens (no em dashes),
 * drops commas (a comma would break the "Glass, Rim" text), Title Cases it, and for a rim drops a trailing "Rim"
 * (the station text adds it). Words typed in mixed case ("McKenzie") keep their capitals. Returns "" when nothing is left.
 */
export function cleanOptionName(raw: string, kind: BarOptionKind): string {
  let s = (raw ?? "")
    .replace(/[–—]/g, "-")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (kind === "rim") s = s.replace(/\s+rim$/i, "").trim();
  s = s.replace(/\p{L}[\p{L}']*/gu, (w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)));
  return s.slice(0, 40).trim();
}

/** Case-insensitive lookup of a name among one kind's options. */
export function findOption(options: readonly BarOption[], kind: BarOptionKind, name: string): BarOption | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return options.find((o) => o.kind === kind && o.name.trim().toLowerCase() === n);
}

/** One kind's options in list order: sort, then name, then id (a stable tie-break). */
export function optionsOf(options: readonly BarOption[], kind: BarOptionKind): BarOption[] {
  return options
    .filter((o) => o.kind === kind)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The sort value for a new option: after everything already in its list. */
export function nextSort(options: readonly BarOption[], kind: BarOptionKind): number {
  return options.filter((o) => o.kind === kind).reduce((m, o) => Math.max(m, Number(o.sort) || 0), 0) + 1;
}
