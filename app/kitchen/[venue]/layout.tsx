import type { Metadata } from "next";
import { isKitchenVenue } from "@/lib/kitchen";
import { kitchenAppName } from "@/lib/station-names";

/** Every screen under a kitchen carries the venue's Home Screen name ("Drift Kitchen") and its own manifest, whichever one the iPad was on when it was added. */
export function generateMetadata({ params }: { params: { venue: string } }): Metadata {
  if (!isKitchenVenue(params.venue)) return {};
  return {
    manifest: `/kitchen/${params.venue}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: kitchenAppName(params.venue), statusBarStyle: "black-translucent" },
  };
}

export default function KitchenVenueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
