import { isBarVenue } from "@/lib/bar";
import { stationManifest } from "@/lib/station-names";

/**
 * Web app manifest for one bar: the Home Screen icon is named "<Venue> Drinks" and opens straight on that venue's screen,
 * so a bar iPad never starts on the chooser. The scope stays /bar so Pre-Mix Bottles and the offline copy work as before.
 */
export function GET(_req: Request, { params }: { params: { venue: string } }) {
  if (!isBarVenue(params.venue)) return new Response("Not found", { status: 404 });
  return Response.json(stationManifest("bar", params.venue), { headers: { "Content-Type": "application/manifest+json" } });
}
