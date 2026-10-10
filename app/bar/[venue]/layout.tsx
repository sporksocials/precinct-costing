import type { Metadata } from "next";
import { isBarVenue } from "@/lib/bar";
import { drinksAppName } from "@/lib/station-names";

/** Every screen under a bar carries the venue's Home Screen name ("Drift Drinks") and its own manifest, whichever one the iPad was on when it was added. */
export function generateMetadata({ params }: { params: { venue: string } }): Metadata {
  if (!isBarVenue(params.venue)) return {};
  return {
    manifest: `/bar/${params.venue}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: drinksAppName(params.venue), statusBarStyle: "black-translucent" },
  };
}

export default function BarVenueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
