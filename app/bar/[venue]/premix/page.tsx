import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarPremixPage } from "@/components/bar/premix";
import { isBarVenue } from "@/lib/bar";
import type { BarPremix } from "@/lib/bar-premix";
import { fetchBarPremix } from "@/lib/bar-server";
import { drinksAppName } from "@/lib/station-names";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = { drift: "Drift Bar", chiobu: "Chiobu", greedy: "Greedy Gringo's" };

export function generateMetadata({ params }: { params: { venue: string } }): Metadata {
  return { title: `${drinksAppName(params.venue)} · Pre-Mix Bottles` };
}

export default async function BarPremixRoute({ params }: { params: { venue: string } }) {
  if (!isBarVenue(params.venue)) notFound();
  let premix: BarPremix | null = null;
  try {
    premix = await fetchBarPremix(params.venue);
  } catch {
    // network or database hiccup: the page shows "Can't Load Pre-Mixes" and retries on its own
  }
  return <BarPremixPage slug={params.venue} venueName={premix?.venue.name ?? NAMES[params.venue]} initial={premix} />;
}
