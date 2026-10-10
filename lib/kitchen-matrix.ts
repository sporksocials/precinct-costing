import { barIngredientName } from "./bar";
import { DIET_MARK_IDS, DIET_OPTION_IDS, type DietMarkId, type DietOptionId } from "./diet-legend";
import { optionText, swapSentence } from "./diet-options";
import { readDishAllergens } from "./dish-allergens";
import { crossContactLine, type MatrixDish } from "./allergy-matrix";
import { formatQty } from "./parse-qty";
import { LINE_UNITS, type LineUnit } from "./types";

/**
 * The kitchen iPad's Allergy Matrix feed (`cost_kitchen_matrix(slug)`, migration 20261010140000): the venue's active Food dishes
 * with ONLY display fields. A dish carries its own allergens section (contains, can-be-made-without notes and the sign-off TIME,
 * never who signed), its hand-set marks, and each dietary option with the ingredient names the database already resolved. The
 * feed holds no price, surcharge, cost, target or supplier, and this parser would not read one if it did (it only picks the keys
 * it knows). Pure: tests/kitchen-matrix.test.ts pins the shape.
 */

export interface KitchenMatrixData {
  venue: { slug: string; name: string };
  dishes: MatrixDish[];
  /** the venue's standing cross-contact line (Settings), or the default; shown in the footer of every iPad screen */
  crossContact: string;
  /** when this copy was read from the database (ISO) */
  syncedAt: string;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function idOf(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : [];
}

/** One option's wording: the swap sentence from the resolved names ("Leave out Brioche Bun. Add Tamari 15 ml."), then its own note. */
function optionWords(v: unknown): string | null {
  const o = obj(v);
  if (!o) return null;
  const leftOut = strings(o.left_out).map(barIngredientName);
  const added: string[] = [];
  for (const x of Array.isArray(o.added) ? o.added : []) {
    const a = obj(x);
    const name = a && textOrNull(a.name);
    if (!a || !name) continue;
    const qty = Number(a.qty);
    const unit = typeof a.unit === "string" && (LINE_UNITS as string[]).includes(a.unit) ? (a.unit as LineUnit) : null;
    added.push(Number.isFinite(qty) && qty > 0 && unit ? `${barIngredientName(name)} ${formatQty(qty, unit)}` : barIngredientName(name));
  }
  const note = typeof o.note === "string" ? o.note : "";
  return optionText(note, swapSentence({ leftOut, added }));
}

function parseDish(x: unknown): MatrixDish | null {
  const d = obj(x);
  const id = d && idOf(d.id);
  const name = d && textOrNull(d.name);
  if (!d || !id || !name) return null;
  const options: Partial<Record<DietOptionId, string>> = {};
  const rawOptions = obj(d.options);
  if (rawOptions) {
    for (const oid of DIET_OPTION_IDS) {
      const w = optionWords(rawOptions[oid]);
      if (w !== null) options[oid] = w;
    }
  }
  const marks = new Set(strings(d.marks));
  // the sign-off time is kept; who signed is never shown on the iPad, so it is dropped here even if a feed ever sent it.
  // The feed already applied the re-check rule (a sign-off whose ingredients changed arrives with no confirmed_at), so a
  // confirmed_at here IS a valid sign-off. The components list is not read: the iPad never needs it.
  const allergens = ((da) => (da ? { ...da, confirmedBy: null, components: null, ticks: null, basis: null, added: [], needsSignoff: false } : null))(readDishAllergens(d.dish_allergens));
  return {
    id,
    name,
    section: textOrNull(d.section),
    allergens,
    signOff: allergens?.confirmedAt ? "valid" : "never",
    signedAt: allergens?.confirmedAt ?? null,
    marks: DIET_MARK_IDS.filter((m): m is DietMarkId => marks.has(m)),
    options,
  };
}

/** Validates the `cost_kitchen_matrix` payload. Null when the venue does not exist. A malformed dish is dropped, never an error. */
export function parseKitchenMatrix(raw: unknown, syncedAt: string): KitchenMatrixData | null {
  const r = obj(raw);
  const venue = r && obj(r.venue);
  if (!r || !venue || typeof venue.slug !== "string") return null;
  return {
    venue: { slug: venue.slug, name: String(venue.name ?? venue.slug) },
    dishes: (Array.isArray(r.dishes) ? r.dishes : []).map(parseDish).filter((x): x is MatrixDish => x !== null),
    crossContact: crossContactLine(typeof r.cross_contact === "string" ? r.cross_contact : null),
    syncedAt,
  };
}
