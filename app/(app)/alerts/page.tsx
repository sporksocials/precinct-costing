"use client";

import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui";
import { useVenue, venueQuery, VenueFilter } from "@/components/venue";
import { formatToday, TodayFeed } from "@/components/today-feed";

/**
 * Every alert, in full: each kind in its own group with Open | Ignored, Review & Apply and Show All. Home (the dashboard)
 * shows the top few of these ranked by importance and its View All button opens this page. ?venue= carries over.
 */
export default function AlertsPage() {
  const { today } = useStore();
  const { venue } = useVenue();
  return (
    <div>
      <div className="pt-2 lg:pt-6">
        <BackLink path="/" fallback={`/${venueQuery(venue)}`} rules={{ venue: venue?.slug }} className="btn-text -ml-1 !gap-0 !text-accent">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Home
        </BackLink>
      </div>
      <PageHeader className="!pt-1 lg:!pt-1" title="Alerts" subtitle={formatToday(today)} />
      <VenueFilter className="mb-2" stats={false} />
      <TodayFeed venueId={venue?.id ?? null} showHeading={false} />
    </div>
  );
}
