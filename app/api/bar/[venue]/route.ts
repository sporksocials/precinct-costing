import { isBarVenue } from "@/lib/bar";
import { fetchBarMenu } from "@/lib/bar-server";

export const dynamic = "force-dynamic";

/** Public: the drinks station's background refresh. Display fields only (see cost_bar_menu). */
export async function GET(_req: Request, { params }: { params: { venue: string } }) {
  if (!isBarVenue(params.venue)) return Response.json({ error: "Unknown bar" }, { status: 404 });
  try {
    const menu = await fetchBarMenu(params.venue);
    if (!menu) return Response.json({ error: "Unknown bar" }, { status: 404 });
    return Response.json(menu, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Couldn't load the bar menu" }, { status: 502 });
  }
}
