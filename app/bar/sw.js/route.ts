import { stationWorkerResponse } from "@/lib/sw-source";

/**
 * Service worker for the cocktail station iPads (scope /bar). It keeps the last good copy of the station on the iPad so a
 * Wi-Fi drop, a server blip or an iPadOS app relaunch never leaves a bartender looking at a blank page.
 * The worker itself is shared with the kitchen station: see lib/sw-source.ts for what it saves and how.
 */
export function GET() {
  return stationWorkerResponse({ scope: "/bar", cachePrefix: "bar", photoPrefixes: ["/bar/cocktails/", "/bar/photo/"] });
}
