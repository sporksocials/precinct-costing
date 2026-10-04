import { isBarVenue } from "@/lib/bar";
import { fetchBarPremix } from "@/lib/bar-server";

export const dynamic = "force-dynamic";

/** Public: the Pre-Mix Bottles page's background refresh. Display fields only (see cost_bar_premix). */
export async function GET(_req: Request, { params }: { params: { venue: string } }) {
  if (!isBarVenue(params.venue)) return Response.json({ error: "Unknown bar" }, { status: 404 });
  try {
    const premix = await fetchBarPremix(params.venue);
    if (!premix) return Response.json({ error: "Unknown bar" }, { status: 404 });
    return Response.json(premix, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Couldn't load the pre-mixes" }, { status: 502 });
  }
}
