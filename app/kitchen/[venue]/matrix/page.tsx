import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KitchenMatrix } from "@/components/kitchen/matrix";
import { KITCHEN_NAMES, isKitchenVenue } from "@/lib/kitchen";
import type { KitchenMatrixData } from "@/lib/kitchen-matrix";
import { fetchKitchenMatrix } from "@/lib/kitchen-matrix-server";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { venue: string } }): Metadata {
  return { title: `${KITCHEN_NAMES[params.venue] ?? "Kitchen"} · Allergy Matrix` };
}

/** The kitchen iPad's Allergy Matrix: public, no login (middleware.ts lets /kitchen through). Display fields only, never a price. */
export default async function KitchenMatrixPage({ params }: { params: { venue: string } }) {
  if (!isKitchenVenue(params.venue)) notFound();
  let data: KitchenMatrixData | null = null;
  try {
    data = await fetchKitchenMatrix(params.venue);
  } catch {
    // network or database hiccup: the screen shows "Can't Load The Matrix" and retries on its own
  }
  return <KitchenMatrix slug={params.venue} venueName={KITCHEN_NAMES[params.venue]} initial={data} />;
}
