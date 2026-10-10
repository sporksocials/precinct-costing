import type { AllergenIndex } from "./allergens";
import { matrixDishFromItem } from "./allergy-matrix-store";
import type { MenuItem, OfferLine } from "./types";

/**
 * An offer (combo, special, happy hour) is built from existing dishes, so it must follow the same allergen rule as a new dish
 * (Troy, 10 Oct 2026: "adding a special dish should always work the same as adding a new dish so no-one bypasses the system").
 * A food dish without a VALID sign-off (never confirmed, or its ingredients changed since) blocks the offer going Live.
 * Drafts are private workings and are never blocked. Drinks, tap beer serves and typed-over components are not food dishes here.
 * Returns the dish names that still need their allergens confirmed, each once, in the order the offer lists them.
 */
export function offerAllergenBlockers(lines: readonly Pick<OfferLine, "item_id">[], items: readonly MenuItem[], index: AllergenIndex): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const item = l.item_id ? byId.get(l.item_id) : undefined;
    if (!item || item.category !== "Food" || seen.has(item.id)) continue;
    seen.add(item.id);
    if (matrixDishFromItem(item, index, { review: false }).signOff !== "valid") out.push(item.name);
  }
  return out;
}

/** The plain sentence shown when a Live offer is refused. Names 4, then "and N more". */
export function offerAllergenMessage(names: readonly string[]): string {
  if (!names.length) return "";
  const shown = names.slice(0, 4).join(", ");
  const more = names.length > 4 ? ` and ${names.length - 4} more` : "";
  return `Confirm the allergens first: ${shown}${more}. An offer can only go Live when every food dish in it has its allergens confirmed.`;
}
