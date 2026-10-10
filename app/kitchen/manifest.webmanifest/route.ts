import { stationManifest } from "@/lib/station-names";

/** Web app manifest for the kitchen app when it is added from the chooser: a Home Screen icon named "Kitchen" that opens the venue select, not the costing app. Added from a venue's own screen, the venue manifest next to this one is used instead. */
export function GET() {
  return Response.json(stationManifest("kitchen"), { headers: { "Content-Type": "application/manifest+json" } });
}
