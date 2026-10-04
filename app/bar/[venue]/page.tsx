import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarStation } from "@/components/bar/station";
import { isBarVenue, type BarMenu } from "@/lib/bar";
import { fetchBarMenu, fetchBarPremix } from "@/lib/bar-server";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = { drift: "Drift Bar", chiobu: "Chiobu", greedy: "Greedy Gringo's" };

export function generateMetadata({ params }: { params: { venue: string } }): Metadata {
  return { title: `${NAMES[params.venue] ?? "Bar"} · Cocktail Station` };
}

export default async function BarVenuePage({ params }: { params: { venue: string } }) {
  if (!isBarVenue(params.venue)) notFound();
  // the "Pre-Mix Bottles" row only shows when the venue has some; if that lookup fails the row just stays hidden
  const [menuResult, premixCount] = await Promise.all([
    fetchBarMenu(params.venue).catch(() => undefined),
    fetchBarPremix(params.venue).then((p) => p?.premixes.length ?? 0, () => 0),
  ]);
  // network or database hiccup: the station shows "Can't Load Recipes" and retries on its own
  const menu: BarMenu | null = menuResult ?? null;
  return <BarStation slug={params.venue} venueName={menu?.venue.name ?? NAMES[params.venue]} initial={menu} premixCount={premixCount} />;
}
