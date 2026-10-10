/**
 * What the two iPad apps are called on screen, in one place so the tab titles, the Home Screen names, the manifests and the
 * headings can never drift apart (Troy, 10 Oct 2026: short names). The Kitchen App is "Kitchen", the Drinks Station App is
 * "Drinks"; a screen that knows its venue says "Drift Kitchen" / "Drift Drinks". Display strings only: routes, tables and code
 * keep the old "kitchen" / "bar" words. Pure, so middleware and the tests can import it.
 */

/** The short venue name used in a station's title: "Drift Bar" reads "Drift", "Greedy Gringo's" reads "Greedy". */
export const STATION_VENUE_SHORT: Record<string, string> = { drift: "Drift", chiobu: "Chiobu", greedy: "Greedy" };

export const KITCHEN_APP_NAME = "Kitchen";
export const DRINKS_APP_NAME = "Drinks";

/** "Drift Kitchen" for a known venue, otherwise "Kitchen". */
export function kitchenAppName(slug?: string | null): string {
  const v = slug ? STATION_VENUE_SHORT[slug] : undefined;
  return v ? `${v} ${KITCHEN_APP_NAME}` : KITCHEN_APP_NAME;
}

/** "Drift Drinks" for a known venue, otherwise "Drinks". */
export function drinksAppName(slug?: string | null): string {
  const v = slug ? STATION_VENUE_SHORT[slug] : undefined;
  return v ? `${v} ${DRINKS_APP_NAME}` : DRINKS_APP_NAME;
}

/** The Web App Manifest for one station. With a venue, the Home Screen icon is named after it and opens straight on that venue (no chooser). */
export function stationManifest(station: "kitchen" | "bar", slug?: string | null) {
  const name = station === "kitchen" ? kitchenAppName(slug) : drinksAppName(slug);
  const known = slug && STATION_VENUE_SHORT[slug] ? slug : null;
  return {
    name,
    short_name: name,
    description: station === "kitchen" ? "Dish and prep recipes for the kitchen, Caloundra Food Precinct" : "Drink recipes for the bar, Caloundra Food Precinct",
    start_url: known ? `/${station}/${known}` : `/${station}`,
    scope: `/${station}`,
    display: "standalone",
    background_color: "#0E0E10",
    theme_color: "#0E0E10",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * Whether the person reached a venue screen from the chooser (the iPad's "which kitchen / bar?" list) in this browser session.
 * A station iPad opened straight on its venue has never been through the chooser, so it must not show the way to another venue's
 * screen. Kept in sessionStorage, not the address, so the offline copy (cached by URL) is never split in two. Any storage failure
 * reads as "no": the link stays hidden, the safe side.
 */
const CHOOSER_KEYS = { kitchen: "kitchen-from-chooser", bar: "bar-from-chooser" } as const;
type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function markFromChooser(station: "kitchen" | "bar", store: KeyValueStore | null = sessionStore()): void {
  try {
    store?.setItem(CHOOSER_KEYS[station], "1");
  } catch {
    // storage refused (private browsing, full): the link simply stays hidden on the venue screen
  }
}

export function cameFromChooser(station: "kitchen" | "bar", store: KeyValueStore | null = sessionStore()): boolean {
  try {
    return store?.getItem(CHOOSER_KEYS[station]) === "1";
  } catch {
    return false;
  }
}
