import type { ItemCost } from "@/lib/costing";
import type { MenuItem, Target } from "@/lib/types";

/** House guide per category (fraction). Shown as a hint beside each row; never written automatically. */
export const GUIDE_GP: Record<string, number> = {
  Food: 0.7,
  Cocktail: 0.75,
  Mocktail: 0.8,
  Gelato: 0.72,
  "Tap Beer": 0.7,
  "Packaged Beer & Cider": 0.7,
  Wine: 0.8,
  Spirits: 0.7,
  RTD: 0.7,
};

export interface TargetCell {
  venueId: number;
  category: string;
  /** stored target, or null when the venue has none (falls back to the default) */
  target: number | null;
  /** menu items in this venue and category */
  items: number;
  /** of those, priced items currently below their target */
  under: number;
}

/** One cell per venue x category, in the order given. */
export function targetGrid(
  venueIds: number[],
  categories: readonly string[],
  targets: Target[],
  items: Pick<MenuItem, "id" | "venue_id" | "category">[],
  itemCosts: Map<string, Pick<ItemCost, "underTarget">>,
): TargetCell[][] {
  const stored = new Map(targets.map((t) => [`${t.venue_id}|${t.category}`, Number(t.target_gp)]));
  const counts = new Map<string, { items: number; under: number }>();
  for (const it of items) {
    const k = `${it.venue_id}|${it.category}`;
    const c = counts.get(k) ?? { items: 0, under: 0 };
    c.items += 1;
    if (itemCosts.get(it.id)?.underTarget) c.under += 1;
    counts.set(k, c);
  }
  return categories.map((category) =>
    venueIds.map((venueId) => {
      const k = `${venueId}|${category}`;
      const c = counts.get(k);
      return { venueId, category, target: stored.get(k) ?? null, items: c?.items ?? 0, under: c?.under ?? 0 };
    }),
  );
}
