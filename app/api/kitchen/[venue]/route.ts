import { isKitchenVenue } from "@/lib/kitchen";
import { fetchKitchenData } from "@/lib/kitchen-server";

export const dynamic = "force-dynamic";

/** Public: the kitchen station's background refresh. Display fields only (see cost_kitchen_data). */
export async function GET(_req: Request, { params }: { params: { venue: string } }) {
  if (!isKitchenVenue(params.venue)) return Response.json({ error: "Unknown kitchen" }, { status: 404 });
  try {
    const data = await fetchKitchenData(params.venue);
    if (!data) return Response.json({ error: "Unknown kitchen" }, { status: 404 });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Couldn't load the kitchen recipes" }, { status: 502 });
  }
}
