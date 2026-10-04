"use client";

import { PrecinctMark } from "@/components/brand";
import { Dashboard } from "@/components/dashboard";

/**
 * Home: always all venues, one calm screen (components/dashboard.tsx). There are no venue buttons here: a venue is one tap
 * away in the Venues list. The complete alert feed lives on /alerts.
 */
export default function HomePage() {
  return (
    <div>
      <header className="pb-4 pt-3 lg:pt-8">
        <h1 className="sr-only">Caloundra Food Precinct costing</h1>
        <PrecinctMark size="md" sub="Costing" className="lg:hidden" />
        <p aria-hidden className="display hidden text-[44px] text-label lg:block">Home</p>
      </header>
      <Dashboard />
    </div>
  );
}
