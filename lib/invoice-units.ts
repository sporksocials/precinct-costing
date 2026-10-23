/**
 * Invoice units and pack conversion. An invoice sells in its own unit (KG, CTN, EA, KEG); the costing app prices an ingredient
 * per PACK (pack_size x pack_unit). `packs_per_unit` is the number of costing packs in one invoice unit, and the conversion is
 * only ever derived where it is certain (a kilo against a pack in kilos, an each against a pack of eaches). Everything else is
 * null and the engine asks a question. Pure, no store.
 */
import type { AnalyseIngredient, AnalyseProduct } from "./invoice-types";

export type BaseUnit = "kg" | "L" | "each";

/** The unit an ingredient's quantities are reported in: grams and kilos report in kg, millilitres and litres in L. */
export function baseUnitFor(packUnit: string | null | undefined): BaseUnit | null {
  switch (String(packUnit ?? "").trim().toLowerCase()) {
    case "g":
    case "kg":
      return "kg";
    case "ml":
    case "l":
      return "L";
    case "each":
    case "ea":
      return "each";
    default:
      return null;
  }
}

/** One pack expressed in the base unit (a 700 ml pack is 0.7 L). Null when the pack unit or size is not usable. */
export function packBaseSize(ing: Pick<AnalyseIngredient, "pack_size" | "pack_unit">): number | null {
  const size = Number(ing.pack_size);
  if (!(size > 0) || !Number.isFinite(size)) return null;
  switch (String(ing.pack_unit ?? "").trim().toLowerCase()) {
    case "g":
    case "ml":
      return size / 1000;
    case "kg":
    case "l":
    case "each":
    case "ea":
      return size;
    default:
      return null;
  }
}

const UNIT_WORDS: Record<string, string> = {
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  l: "l", lt: "l", ltr: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  ea: "each", each: "each", unit: "each", units: "each", pc: "each", pce: "each", piece: "each", pieces: "each",
  ctn: "carton", carton: "carton", cartons: "carton", case: "carton", cases: "carton", cs: "carton", cse: "carton",
  btl: "bottle", btls: "bottle", bt: "bottle", bottle: "bottle", bottles: "bottle",
  keg: "keg", kegs: "keg",
  pkt: "pack", pkts: "pack", packet: "pack", pack: "pack", packs: "pack", pk: "pack",
  bag: "bag", bags: "bag", box: "box", boxes: "box", bx: "box",
};

/** A unit word made comparable: "CTN", "Carton" and "case" are one unit; an unknown word compares as itself in lower case. */
export function canonicalUnit(unit: string | null | undefined): string {
  const u = String(unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  return UNIT_WORDS[u] ?? u;
}

/** True when the invoice's unit is the ordering product's unit (CTN against "carton"). An empty unit never matches. */
export function unitsMatch(invoiceUnit: string | null | undefined, productUnitName: string | null | undefined): boolean {
  const a = canonicalUnit(invoiceUnit);
  const b = canonicalUnit(productUnitName);
  return a !== "" && b !== "" && a === b;
}

/**
 * The packs in one invoice unit where that is certain, else null: a KG against a pack in g or kg, an L against a pack in ml or L,
 * an EA against a pack of eaches. A 500 g pack sold by the kilo is 2 packs per KG.
 */
export function deriveSafePacks(invoiceUnit: string | null | undefined, ing: Pick<AnalyseIngredient, "pack_size" | "pack_unit">): number | null {
  const size = packBaseSize(ing);
  if (size == null) return null;
  const base = baseUnitFor(ing.pack_unit);
  const u = canonicalUnit(invoiceUnit);
  if (u === "kg" && base === "kg") return 1 / size;
  if (u === "l" && base === "L") return 1 / size;
  if (u === "each" && base === "each") return 1 / size;
  return null;
}

/** Counts of items in a case that a description states: "24x375ml" and "6 x 700ml" give 24 and 6; "12pk" and "case of 24" too. */
export function inferPackCounts(description: string | null | undefined): number[] {
  const text = String(description ?? "").toLowerCase();
  const found: number[] = [];
  const add = (raw: string | undefined) => {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 1 && n <= 1000 && !found.includes(n)) found.push(n);
  };
  for (const m of Array.from(text.matchAll(/(\d{1,3})\s*[x×]\s*\d+(?:\.\d+)?\s*(?:ml|cl|l|g|kg)\b/g))) add(m[1]);
  for (const m of Array.from(text.matchAll(/\b(\d{1,3})\s*(?:pk|pack|pcs|ct|btls?|cans?|bottles?)\b/g))) add(m[1]);
  for (const m of Array.from(text.matchAll(/\b(?:case|carton|ctn)\s+of\s+(\d{1,3})\b/g))) add(m[1]);
  for (const m of Array.from(text.matchAll(/\bx\s*(\d{1,3})\b/g))) add(m[1]);
  return found;
}

/** The plausible packs-per-unit answers for a question: what the description states first, then the usual case sizes. */
export function plausibleFactors(description: string | null | undefined): number[] {
  const out = inferPackCounts(description);
  for (const n of [1, 6, 12, 24]) if (!out.includes(n)) out.push(n);
  return out;
}

export interface PackInput {
  /** packs_per_unit from a saved match (invoice_item_map), when the line was matched through one */
  mapPacks: number | null;
  product: AnalyseProduct | null;
  ingredient: AnalyseIngredient | null;
  invoiceUnit: string | null;
}

export interface PackResolution {
  /** costing packs in one invoice unit, null when it cannot be known safely */
  packs: number | null;
  source: "map" | "product" | "derived" | "none";
  /** the invoice unit is the ordering product's unit, so its price can be compared per order unit */
  productUnitMatches: boolean;
  /** the saved match and the ordering list disagree on the pack count: a person must say which is right */
  conflict: { mapPacks: number; productPacks: number } | null;
}

/**
 * Decide packs_per_unit. A saved match wins; then the ordering product's own costing packs (1 when blank) if the invoice unit is
 * the product's unit; then only the safe derivations. Never guesses.
 */
export function resolvePacks(input: PackInput): PackResolution {
  const { mapPacks, product, ingredient, invoiceUnit } = input;
  const productUnitMatches = !!product && unitsMatch(invoiceUnit, product.unit_name);
  const productPacks = product && productUnitMatches ? product.costing_packs_per_unit ?? 1 : null;
  const hasMap = mapPacks != null && Number.isFinite(mapPacks) && mapPacks > 0;

  if (hasMap) {
    const conflict =
      ingredient && productPacks != null && Math.abs((mapPacks as number) - productPacks) > 1e-9
        ? { mapPacks: mapPacks as number, productPacks }
        : null;
    return { packs: mapPacks as number, source: "map", productUnitMatches, conflict };
  }
  if (productPacks != null && productPacks > 0) return { packs: productPacks, source: "product", productUnitMatches, conflict: null };
  if (ingredient) {
    const d = deriveSafePacks(invoiceUnit, ingredient);
    if (d != null && d > 0) return { packs: d, source: "derived", productUnitMatches, conflict: null };
  }
  return { packs: null, source: "none", productUnitMatches, conflict: null };
}

/** Quantity in the ingredient's base unit: qty x packs per unit x pack size (converted). Null when any piece is unknown. */
export function baseQuantity(qty: number | null, packs: number | null, ing: Pick<AnalyseIngredient, "pack_size" | "pack_unit"> | null): number | null {
  if (qty == null || packs == null || !ing) return null;
  const size = packBaseSize(ing);
  if (size == null) return null;
  return Math.round(qty * packs * size * 10000) / 10000;
}
