"use client";

import { useParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { VenueAccent } from "@/components/venue";
import { OrderingVenueProvider } from "@/components/ordering/venue-context";
import { TouchLink } from "@/components/ordering/touch";
import { Empty } from "@/components/ui";

/**
 * The layout every /ordering/<venue>/... screen renders inside (home, Setup, History, and the Count and Orders screens built
 * alongside). It does three things and nothing else: resolves the venue from the URL, sets the venue accent, and provides
 * the venue to useOrderingVenue(). No header, no navigation, no padding: each screen draws its own, so the phone count screen
 * and the desktop order screens keep all the room they need.
 */
export default function OrderingVenueLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ venue: string }>();
  const { venues } = useStore();
  const venue = venues.find((v) => v.slug === params.venue) ?? null;
  if (!venue) {
    return (
      <Empty
        title="Venue Not Found"
        body="Ordering is set up one venue at a time. Pick a venue from the list."
        action={
          <TouchLink href="/ordering" variant="primary">
            Choose A Venue
          </TouchLink>
        }
      />
    );
  }
  return (
    <OrderingVenueProvider venue={venue}>
      <VenueAccent slug={venue.slug} />
      {children}
    </OrderingVenueProvider>
  );
}
