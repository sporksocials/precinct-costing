import { stationManifest } from "@/lib/station-names";

/** Web app manifest for the drinks app when it is added from the chooser: a Home Screen icon named "Drinks" that opens the venue select, not the costing app. Added from a venue's own screen, the venue manifest next to this one is used instead. */
export function GET() {
  return Response.json(stationManifest("bar"), { headers: { "Content-Type": "application/manifest+json" } });
}
