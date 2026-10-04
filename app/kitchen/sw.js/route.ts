import { stationWorkerResponse } from "@/lib/sw-source";

/**
 * Service worker for the kitchen station iPads (scope /kitchen), the same offline copy the drinks station keeps (see
 * lib/sw-source.ts) with its own scope and cache names, so the two stations never overwrite each other's saved files.
 */
export function GET() {
  return stationWorkerResponse({ scope: "/kitchen", cachePrefix: "kitchen", photoPrefixes: ["/kitchen/photo/"] });
}
