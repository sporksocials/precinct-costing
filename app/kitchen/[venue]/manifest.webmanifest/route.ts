import { isKitchenVenue } from "@/lib/kitchen";
import { stationManifest } from "@/lib/station-names";

/**
 * Web app manifest for one kitchen: the Home Screen icon is named "<Venue> Kitchen" and opens straight on that venue's screen,
 * so a kitchen iPad never starts on the chooser. The scope stays /kitchen so the matrix and the offline copy work as before.
 */
export function GET(_req: Request, { params }: { params: { venue: string } }) {
  if (!isKitchenVenue(params.venue)) return new Response("Not found", { status: 404 });
  return Response.json(stationManifest("kitchen", params.venue), { headers: { "Content-Type": "application/manifest+json" } });
}
