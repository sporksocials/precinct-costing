/**
 * Tap beer kegs (Troy, 9 Oct 2026): a keg is an ingredient in the "Beer Keg" category, sold by the litre (50 L), with 99% yield
 * (1% wastage, the same for every keg; wastage lives on the keg, never on a serve).
 */
export const KEG_CATEGORY = "Beer Keg";
export const KEG_PACK_SIZE = 50;
export const KEG_PACK_UNIT = "L" as const;
export const KEG_YIELD = 0.99;

/** True when a name is a keg: the word "keg" on its own ("Stone & Wood Keg", "Chiobu keg"). */
export function looksLikeKeg(name: string): boolean {
  return /\bkeg\b/i.test(name);
}

/** The keg's name for a beer: "Stone & Wood Pacific" becomes "Stone & Wood Pacific Keg"; a name that already ends in keg is kept. */
export function kegNameFor(beerName: string): string {
  const n = beerName.trim().replace(/\s+/g, " ");
  if (!n) return "";
  return looksLikeKeg(n) ? n : `${n} Keg`;
}

interface KegHintDraft {
  name: string;
  category: string | null | undefined;
  pack_size: number;
  pack_unit: string;
  yield_pct: number;
}

/**
 * A new ingredient whose name says keg while category, pack and yield are still the blank defaults (Food, 1 kg, 100%) is
 * given the keg defaults. Anything the person has already changed is left alone. Returns the same object when nothing applies.
 */
export function applyKegHint<T extends KegHintDraft>(draft: T, sizeText: string): { draft: T; sizeText: string } {
  const untouched = (draft.category ?? "Food") === "Food" && draft.pack_unit === "kg" && sizeText.trim() === "1" && Number(draft.yield_pct) === 1;
  if (!looksLikeKeg(draft.name) || !untouched) return { draft, sizeText };
  return { draft: { ...draft, category: KEG_CATEGORY, pack_size: KEG_PACK_SIZE, pack_unit: KEG_PACK_UNIT, yield_pct: KEG_YIELD }, sizeText: String(KEG_PACK_SIZE) };
}
