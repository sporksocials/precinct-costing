"use client";

import { useVenue, VenueFilter } from "@/components/venue";
import { PrecinctMark } from "@/components/brand";
import { Dashboard } from "@/components/dashboard";

/**
 * Home is a dashboard: a plain sentence, four tiles (average GP, below target, price alerts, specials live), the top
 * alerts ranked by importance, a bar per venue and the live specials. The complete alert feed lives on /alerts.
 */
export default function HomePage() {
  const { venue } = useVenue();
  return (
    <div>
      <header className="pb-4 pt-3 lg:pt-8">
        <h1 className="sr-only">{venue ? venue.name : "Caloundra Food Precinct costing"}</h1>
        <PrecinctMark size="md" sub="Costing" className="lg:hidden" />
        <p aria-hidden className="display hidden text-[44px] text-label lg:block">{venue ? venue.name : "All Venues"}</p>
      </header>

      {/* with All chosen the By Venue bars carry each venue's GP, so the tiles are plain filters here */}
      <VenueFilter className="mb-4" stats={false} />

      <Dashboard />
    </div>
  );
}
