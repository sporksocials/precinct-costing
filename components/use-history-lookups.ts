"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import type { HistoryLookups } from "@/lib/change-history";
import { VENUE_SHORT } from "./venue";
import { usePersonName } from "./use-person-name";

/** Names for the history describer, read from the store (the Change Log and each record's History share this). */
export function useHistoryLookups(): HistoryLookups {
  const { venues, storedItems, preps, suppliers, offers, beers, beerServes, gelatoServes, ingredients } = useStore();
  const nameOf = usePersonName();
  return useMemo<HistoryLookups>(() => {
    const vShort = new Map(venues.map((v) => [v.id, VENUE_SHORT[v.slug] ?? v.name]));
    const items = new Map(storedItems.map((i) => [i.id, { name: i.name, venueId: i.venue_id }]));
    const beerMap = new Map(beers.map((b) => [b.id, { name: b.name, venueId: b.venue_id }]));
    const serves = new Map(beerServes.map((s) => [s.id, s.name]));
    const gel = new Map(gelatoServes.map((s) => [s.id, { name: s.name, venueId: s.venue_id }]));
    const ing = new Map(ingredients.map((i) => [i.id, i.name]));
    const prepMap = new Map(preps.map((p) => [p.id, { name: p.name, venueId: p.venue_id }]));
    const supMap = new Map(suppliers.map((x) => [x.id, x.name]));
    const offerMap = new Map(offers.map((o) => [o.id, { name: o.name, venueId: o.venue_id }]));
    return {
      prepName: (id) => prepMap.get(id),
      supplierName: (id) => supMap.get(id),
      offerName: (id) => offerMap.get(id),
      recordName: () => undefined,
      personName: (email) => nameOf(email),
      venueName: (id) => vShort.get(id),
      itemName: (id) => items.get(id),
      beerName: (id) => beerMap.get(id),
      beerServeName: (id) => serves.get(id),
      gelatoServeName: (id) => gel.get(id),
      ingredientName: (id) => ing.get(id),
    };
  }, [venues, storedItems, preps, suppliers, offers, beers, beerServes, gelatoServes, ingredients, nameOf]);
}
