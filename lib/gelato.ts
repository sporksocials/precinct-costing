import { costLines, gpFromPrice, suggestedPrice, UNIT_FACTORS, unitBase, type CostingIndex } from "./costing";
import type { CostingSettings, GelatoServe, GelatoServeLine, MenuItem, Prep, RecipeLine, Venue } from "./types";

/**
 * Gelato Rumba: a flavour is its mix (a prep). Every flavour is sold in the same serves
 * (cost_gelato_serves), so each flavour × serve is a *virtual* menu item: its recipe is the
 * serve's grams of mix (plus the wastage allowance) and the serve's packaging lines.
 * Virtual items are never stored; they are costed like any other menu item.
 */

export const GELATO_SLUG = "gelato";
export const FLAVOUR_PREP_TYPES = ["gelato flavour mix", "gelato mix"];
export const FLAVOUR_PREP_TYPE = "Gelato flavour mix";
const VIRTUAL_PREFIX = "gelato~";

export function isGelatoFlavour(prep: Pick<Prep, "prep_type" | "venue_id">, gelatoVenueId: number | null | undefined): boolean {
  if (gelatoVenueId == null || prep.venue_id !== gelatoVenueId) return false;
  return FLAVOUR_PREP_TYPES.includes((prep.prep_type ?? "").trim().toLowerCase());
}

export function virtualItemId(prepId: string, serveId: string): string {
  return `${VIRTUAL_PREFIX}${prepId}~${serveId}`;
}

/** Any computed (not stored) menu item: a gelato flavour × serve or a tap beer × serve. */
export function isVirtualItemId(id: string | null | undefined): boolean {
  return !!id && (id.startsWith(VIRTUAL_PREFIX) || id.startsWith("beer~"));
}

/** Gelato flavour × serve ids only. */
export function parseVirtualItemId(id: string): { prepId: string; serveId: string } | null {
  if (!id.startsWith(VIRTUAL_PREFIX)) return null;
  const [prepId, serveId] = id.slice(VIRTUAL_PREFIX.length).split("~");
  return prepId && serveId ? { prepId, serveId } : null;
}

/** "Mixed Berry Gelato gelato mix" → "Mixed Berry Gelato"; "Banana Gelato Mix" → "Banana". */
export function flavourName(prep: Pick<Prep, "name">): string {
  return prep.name.replace(/\s+gelato\s+mix\s*$/i, "").trim() || prep.name;
}

/** Total weight of a mix in kg (weight lines only), used as the mix's batch yield. */
export function batchWeightKg(lines: Pick<RecipeLine, "qty" | "unit">[]): number {
  let kg = 0;
  for (const l of lines) if (unitBase(l.unit) === "kg") kg += (Number(l.qty) || 0) * UNIT_FACTORS[l.unit];
  return Math.round(kg * 100000) / 100000;
}

export interface GelatoModel {
  venue: Venue | null;
  /** active serves, in menu order */
  serves: GelatoServe[];
  flavours: Prep[];
  items: MenuItem[];
  lines: RecipeLine[];
  /** stored menu items the serves replace (the old flavour × serve recipes) */
  replacedItemIds: Set<string>;
}

export function buildGelato(input: {
  venues: Venue[];
  preps: Prep[];
  items: MenuItem[];
  serves: GelatoServe[];
  serveLines: GelatoServeLine[];
  wastage: number;
}): GelatoModel {
  const venue = input.venues.find((v) => v.slug === GELATO_SLUG) ?? null;
  const empty: GelatoModel = { venue, serves: [], flavours: [], items: [], lines: [], replacedItemIds: new Set() };
  if (!venue) return empty;
  const serves = input.serves.filter((s) => s.venue_id === venue.id && s.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  if (!serves.length) return empty;
  const flavours = input.preps.filter((p) => isGelatoFlavour(p, venue.id)).sort((a, b) => flavourName(a).localeCompare(flavourName(b)));
  const linesByServe = new Map<string, GelatoServeLine[]>();
  for (const l of input.serveLines) {
    const arr = linesByServe.get(l.serve_id);
    if (arr) arr.push(l);
    else linesByServe.set(l.serve_id, [l]);
  }
  const waste = 1 + (Number(input.wastage) || 0);
  const items: MenuItem[] = [];
  const lines: RecipeLine[] = [];
  for (const f of flavours) {
    const fname = flavourName(f);
    for (const s of serves) {
      const id = virtualItemId(f.id, s.id);
      items.push({
        id,
        name: `${fname} - ${s.name}`,
        venue_id: venue.id,
        category: "Gelato",
        section: s.name,
        portions: 1,
        sell_price_inc: s.sell_price_inc,
        target_override: s.target_gp != null ? Number(s.target_gp) : null,
        hh_price_inc: null,
        active: f.active && s.active,
        source: "gelato",
        notes: null,
      });
      lines.push({
        id: `${id}~mix`,
        parent_type: "item",
        parent_id: id,
        component_type: "prep",
        component_id: f.id,
        qty: Math.round((Number(s.grams) || 0) * waste * 1000) / 1000,
        unit: "g",
        note: null,
        sort: 0,
      });
      for (const pl of (linesByServe.get(s.id) ?? []).sort((a, b) => a.sort - b.sort)) {
        lines.push({
          id: `${id}~${pl.id}`,
          parent_type: "item",
          parent_id: id,
          component_type: "ingredient",
          component_id: pl.ingredient_id,
          qty: Number(pl.qty) || 0,
          unit: pl.unit,
          note: null,
          sort: pl.sort + 1,
        });
      }
    }
  }
  // the old stored flavour × serve recipes: gelato venue items whose section is a serve name
  const serveNames = new Set(serves.map((s) => s.name.trim().toLowerCase()));
  const replacedItemIds = new Set(
    input.items.filter((i) => i.venue_id === venue.id && serveNames.has((i.section ?? "").trim().toLowerCase())).map((i) => i.id),
  );
  return { venue, serves, flavours, items, lines, replacedItemIds };
}

/** Packaging lines of a serve as recipe lines (for costLines). */
export function packagingLines(serveId: string, serveLines: GelatoServeLine[]): RecipeLine[] {
  return serveLines
    .filter((l) => l.serve_id === serveId)
    .sort((a, b) => a.sort - b.sort)
    .map((l) => ({ id: l.id, parent_type: "item", parent_id: serveId, component_type: "ingredient", component_id: l.ingredient_id, qty: Number(l.qty) || 0, unit: l.unit, note: null, sort: l.sort }));
}

export interface ServeCost {
  serve: GelatoServe;
  mixGrams: number;
  mixCost: number;
  packagingCost: number;
  cost: number;
  gpPct: number | null;
  suggestedInc: number;
  underTarget: boolean;
}

/** Cost one serve of a mix costing `mixCostPerKg` (ex GST). Used for live previews before a mix is saved. */
export function costServe(
  serve: GelatoServe,
  serveLines: GelatoServeLine[],
  mixCostPerKg: number,
  wastage: number,
  index: CostingIndex,
  settings: CostingSettings,
  targetGp: number,
): ServeCost {
  const mixGrams = (Number(serve.grams) || 0) * (1 + (Number(wastage) || 0));
  const mixCost = (mixGrams / 1000) * mixCostPerKg;
  const packagingCost = costLines(packagingLines(serve.id, serveLines), index, settings.gst_rate).total;
  const cost = mixCost + packagingCost;
  const price = serve.sell_price_inc != null ? Number(serve.sell_price_inc) : null;
  const gpPct = price && price > 0 ? gpFromPrice(cost, price, settings.gst_rate).gpPct : null;
  return {
    serve,
    mixGrams,
    mixCost,
    packagingCost,
    cost,
    gpPct,
    suggestedInc: suggestedPrice(cost, targetGp, settings.gst_rate, settings.round_to),
    underTarget: gpPct != null && gpPct < targetGp - 1e-9,
  };
}
