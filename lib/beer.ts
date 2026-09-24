import type { BeerPrice, BeerServe, Beer, MenuItem, RecipeLine } from "./types";

/**
 * Tap beer: every beer is one keg sold in the same serves (Pot / Schooner / Pint / Jug, cost_beer_serves).
 * Each beer × serve is a *virtual* menu item: its recipe is the serve's ml of the keg, its price comes
 * from cost_beer_prices. Wastage stays on the keg itself (its yield), as before.
 */

const PREFIX = "beer~";

export function beerItemId(beerId: string, serveId: string): string {
  return `${PREFIX}${beerId}~${serveId}`;
}

export function isBeerItemId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(PREFIX);
}

export function parseBeerItemId(id: string): { beerId: string; serveId: string } | null {
  if (!isBeerItemId(id)) return null;
  const [beerId, serveId] = id.slice(PREFIX.length).split("~");
  return beerId && serveId ? { beerId, serveId } : null;
}

export interface BeerModel {
  serves: BeerServe[];
  beers: Beer[];
  items: MenuItem[];
  lines: RecipeLine[];
  /** the old stored beer × serve menu items these replace */
  replacedItemIds: Set<string>;
}

export function buildBeer(input: { beers: Beer[]; serves: BeerServe[]; prices: BeerPrice[] }): BeerModel {
  const serves = input.serves.filter((s) => s.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const beers = [...input.beers].sort((a, b) => a.name.localeCompare(b.name));
  const priceOf = new Map(input.prices.map((p) => [`${p.beer_id}~${p.serve_id}`, p]));
  const replacedItemIds = new Set(input.prices.map((p) => p.legacy_item_id).filter((x): x is string => !!x));
  const items: MenuItem[] = [];
  const lines: RecipeLine[] = [];
  for (const b of beers) {
    for (const s of serves) {
      const p = priceOf.get(`${b.id}~${s.id}`);
      const id = beerItemId(b.id, s.id);
      items.push({
        id,
        name: `${b.name} - ${s.name}`,
        venue_id: b.venue_id,
        category: "Tap Beer",
        section: "Tap",
        portions: 1,
        sell_price_inc: p?.sell_price_inc != null ? Number(p.sell_price_inc) : null,
        target_override: b.target_gp != null ? Number(b.target_gp) : null,
        hh_price_inc: p?.hh_price_inc != null ? Number(p.hh_price_inc) : null,
        active: b.active && s.active,
        source: "beer",
        notes: null,
      });
      if (b.ingredient_id) {
        lines.push({ id: `${id}~keg`, parent_type: "item", parent_id: id, component_type: "ingredient", component_id: b.ingredient_id, qty: Number(s.ml) || 0, unit: "ml", note: null, sort: 0 });
      }
    }
  }
  return { serves, beers, items, lines, replacedItemIds };
}
