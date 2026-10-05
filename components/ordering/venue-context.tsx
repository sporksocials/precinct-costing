"use client";

/**
 * The venue of an Ordering page, resolved once by app/(app)/ordering/[venue]/layout.tsx from the URL slug. Every screen under
 * /ordering/<slug>/... can call useOrderingVenue() instead of looking the venue up again. Everything in Ordering is separate
 * per venue, so there is deliberately no "all venues" value: the hook always returns one real venue.
 */
import { createContext, useContext } from "react";
import { orderingVenueName } from "@/lib/ordering";
import type { Venue } from "@/lib/types";

export interface OrderingVenue {
  venue: Venue;
  slug: string;
  /** the short name used in titles and subjects: Drift, Chiobu, Greedy, Gelato */
  name: string;
  /** "/ordering/drift": the base of every link for this venue */
  base: string;
}

const Ctx = createContext<OrderingVenue | null>(null);

export function OrderingVenueProvider({ venue, children }: { venue: Venue; children: React.ReactNode }) {
  const value: OrderingVenue = { venue, slug: venue.slug, name: orderingVenueName(venue), base: `/ordering/${venue.slug}` };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrderingVenue(): OrderingVenue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrderingVenue outside an /ordering/[venue] page");
  return v;
}
