import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarStation } from "@/components/bar/station";
import { isBarVenue, type BarMenu } from "@/lib/bar";
import { fetchBarMenu } from "@/lib/bar-server";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = { drift: "Drift Bar", chiobu: "Chiobu", greedy: "Greedy Gringo's" };

export function generateMetadata({ params }: { params: { venue: string } }): Metadata {
  return { title: `${NAMES[params.venue] ?? "Bar"} · Cocktail Station` };
}

export default async function BarVenuePage({ params }: { params: { venue: string } }) {
  if (!isBarVenue(params.venue)) notFound();
  let menu: BarMenu | null = null;
  try {
    menu = await fetchBarMenu(params.venue);
  } catch {
    // network or database hiccup: the station shows "Can't Load Recipes" and retries on its own
  }
  return <BarStation slug={params.venue} venueName={menu?.venue.name ?? NAMES[params.venue]} initial={menu} />;
}
