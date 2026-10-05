import { orderingWorkerResponse } from "@/lib/ordering-sw-source";

/**
 * Service worker for the Ordering count screen (scope /ordering). It lets a signed-in device reopen the count screen with no
 * signal. Unlike the bar and kitchen stations this area is behind login, so the worker only ever saves the count page's app
 * shell and built files: see lib/ordering-sw-source.ts for exactly what and why.
 */
export function GET() {
  return orderingWorkerResponse();
}
