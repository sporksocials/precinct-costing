import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KitchenStation } from "@/components/kitchen/station";
import { KITCHEN_NAMES, isKitchenVenue, type KitchenData } from "@/lib/kitchen";
import { fetchKitchenData } from "@/lib/kitchen-server";
import { kitchenAppName } from "@/lib/station-names";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { venue: string } }): Metadata {
  return { title: kitchenAppName(params.venue) };
}

export default async function KitchenVenuePage({ params }: { params: { venue: string } }) {
  if (!isKitchenVenue(params.venue)) notFound();
  let data: KitchenData | null = null;
  try {
    data = await fetchKitchenData(params.venue);
  } catch {
    // network or database hiccup: the station shows "Can't Load Recipes" and retries on its own
  }
  return <KitchenStation slug={params.venue} venueName={KITCHEN_NAMES[params.venue]} initial={data} />;
}
