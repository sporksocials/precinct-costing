import { gpFromPrice, type ItemCost } from "./costing";
import { parseVirtualItemId } from "./gelato";
import { parseBeerItemId } from "./beer";

/**
 * "Review & Apply": the list of sell-price changes that would bring under-target items back to
 * target, built from item costs. Pure, so the same list serves Home and the ingredient price flow.
 *
 * - A menu item is one change.
 * - A tap beer x serve is one change (each beer has its own serve price).
 * - A gelato serve price is SHARED by every flavour, so all under-target flavours of a serve fold
 *   into ONE change, priced from the WORST (dearest) flavour so no flavour is left under target.
 */

export interface ReviewChange {
  /** stable key: item id, beer item id, or `serve:<serveId>` */
  key: string;
  kind: "item" | "gelato_serve" | "beer_serve";
  venueId: number;
  name: string;
  /** explains a shared or derived price, e.g. "Applies to all 12 flavours" */
  note: string | null;
  oldPrice: number | null;
  newPrice: number;
  gpBefore: number | null;
  gpAfter: number;
  target: number;
  /** true when the cost behind this suggestion looks untrustworthy (ItemCost.needsCheck) */
  needsCheck: boolean;
  /** the ItemCost the price is written through (for gelato: the worst flavour of the serve) */
  cost: ItemCost;
}

export interface ServeStat {
  /** dearest active flavour of the serve (lowest GP at the shared price) */
  worst: ItemCost;
  flavours: number;
}

/** Worst flavour and flavour count per gelato serve, across every active gelato item given. */
export function gelatoServeStats(costs: Iterable<ItemCost>): Map<string, ServeStat> {
  const out = new Map<string, ServeStat>();
  for (const c of costs) {
    if (!c.item.active) continue;
    const v = parseVirtualItemId(c.item.id);
    if (!v) continue;
    const cur = out.get(v.serveId);
    if (!cur) out.set(v.serveId, { worst: c, flavours: 1 });
    else {
      cur.flavours += 1;
      if (c.costPerPortion > cur.worst.costPerPortion) cur.worst = c;
    }
  }
  return out;
}

function flavourOf(c: ItemCost): string {
  return c.item.name.split(" - ")[0];
}

/**
 * Changes that lift each under-target cost to its suggested price (target GP, rounded up).
 * `costs` may be a subset (e.g. dishes touched by an ingredient change). Pass `serveStats`
 * (from gelatoServeStats over ALL items) so a gelato serve is priced from its true worst flavour.
 */
export function buildReviewChanges(costs: Iterable<ItemCost>, gst: number, serveStats?: Map<string, ServeStat>): ReviewChange[] {
  const out: ReviewChange[] = [];
  const serves = new Map<string, ItemCost>();
  for (const c of costs) {
    if (!c.item.active || !c.underTarget || !(c.suggestedInc > 0)) continue;
    const v = parseVirtualItemId(c.item.id);
    if (v) {
      const cur = serves.get(v.serveId);
      if (!cur || c.costPerPortion > cur.costPerPortion) serves.set(v.serveId, c);
      continue;
    }
    out.push({
      key: c.item.id,
      kind: parseBeerItemId(c.item.id) ? "beer_serve" : "item",
      venueId: c.item.venue_id,
      name: c.item.name,
      note: null,
      oldPrice: c.sellInc,
      newPrice: c.suggestedInc,
      gpBefore: c.gpPct,
      gpAfter: gpFromPrice(c.costPerPortion, c.suggestedInc, gst).gpPct,
      target: c.targetGp,
      needsCheck: c.needsCheck,
      cost: c,
    });
  }
  for (const [serveId, seen] of serves) {
    const stat = serveStats?.get(serveId);
    const worst = stat && stat.worst.costPerPortion >= seen.costPerPortion ? stat.worst : seen;
    const n = stat?.flavours;
    out.push({
      key: `serve:${serveId}`,
      kind: "gelato_serve",
      venueId: worst.item.venue_id,
      name: worst.item.section ?? worst.item.name,
      note: `Applies to ${n ? `all ${n}` : "all"} flavours. Priced from the dearest, ${flavourOf(worst)}.`,
      oldPrice: worst.sellInc,
      newPrice: worst.suggestedInc,
      gpBefore: worst.gpPct,
      gpAfter: gpFromPrice(worst.costPerPortion, worst.suggestedInc, gst).gpPct,
      target: worst.targetGp,
      needsCheck: worst.needsCheck,
      cost: worst,
    });
  }
  return out.sort((a, b) => a.venueId - b.venueId || (a.gpBefore ?? 0) - a.target - ((b.gpBefore ?? 0) - b.target) || a.name.localeCompare(b.name));
}

/** Changes grouped by venue, venues in id order (changes keep their order). */
export function groupChangesByVenue(changes: ReviewChange[]): { venueId: number; changes: ReviewChange[] }[] {
  const m = new Map<number, ReviewChange[]>();
  for (const c of changes) {
    const arr = m.get(c.venueId);
    if (arr) arr.push(c);
    else m.set(c.venueId, [c]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([venueId, cs]) => ({ venueId, changes: cs }));
}

/** Keys switched on by default: everything except changes whose cost needs checking first. */
export function defaultSelection(changes: ReviewChange[]): Set<string> {
  return new Set(changes.filter((c) => !c.needsCheck).map((c) => c.key));
}

/** What to write for the ticked changes: the cost to write through and the new price. */
export function applyPlan(changes: ReviewChange[], selected: Set<string>): { c: ItemCost; price: number }[] {
  return changes.filter((ch) => selected.has(ch.key)).map((ch) => ({ c: ch.cost, price: ch.newPrice }));
}

/**
 * Review changes for the dishes an ingredient edit pushes under target. `impact` holds the
 * before/after costing of the affected dishes; `all` is every current cost. Affected dishes are
 * swapped for their AFTER costing first, so a gelato serve is priced from the true worst flavour
 * after the edit, not before it.
 */
export function reviewChangesFromImpact(impact: { after: ItemCost }[], all: Iterable<ItemCost>, gst: number): ReviewChange[] {
  const merged = new Map<string, ItemCost>();
  for (const c of all) merged.set(c.item.id, c);
  for (const r of impact) merged.set(r.after.item.id, r.after);
  return buildReviewChanges(
    impact.map((r) => r.after),
    gst,
    gelatoServeStats(merged.values()),
  );
}
