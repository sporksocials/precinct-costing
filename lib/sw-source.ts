/**
 * Source of the offline service worker shared by the two iPad stations (/bar and /kitchen). Each station serves its own copy
 * from its own route with its own scope and cache names, so the two workers never touch each other's saved files.
 *
 * - Pages under the scope and the refresh API (/api<scope>/): network first (4 and 6 second limits), the saved copy if the
 *   network is down or slow. The saved API reply keeps its own "syncedAt", so the on-screen "Synced ... ago" and the
 *   out-of-date banner stay truthful.
 * - Built files (/_next/static), the station's photos, logos and icons: saved on first use, served from the save after that.
 * - The page tells the worker what it has loaded ("warm" message) so even the very first visit is saved, before the worker took over.
 *   It can also name the station's other pages and refresh API replies to save ahead (the bar's Pre-Mix Bottles page, for one).
 * - Everything else (the costing app, Supabase, other origins, non-GET) is left alone.
 */
export interface StationWorker {
  /** the station's URL prefix and service worker scope, e.g. "/bar" */
  scope: string;
  /** cache name prefix, e.g. "bar" gives "bar-pages-v1" and "bar-assets-v1"; also what old caches are recognised by */
  cachePrefix: string;
  /** this station's own photo folders, saved on first use, e.g. ["/bar/cocktails/", "/bar/photo/"] */
  photoPrefixes: string[];
}

export function stationWorkerSource({ scope, cachePrefix, photoPrefixes }: StationWorker): string {
  return `
const VERSION = "v1";
const SCOPE = ${JSON.stringify(scope)};
const PREFIX = ${JSON.stringify(cachePrefix + "-")};
const PAGES = PREFIX + "pages-" + VERSION;
const ASSETS = PREFIX + "assets-" + VERSION;
const MAX_ASSETS = 250;
const ASSET_PREFIXES = ${JSON.stringify(["/_next/static/", ...photoPrefixes, "/brand/", "/icon", "/apple-touch-icon"])};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== PAGES && key !== ASSETS) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const isStationPage = (p) => p === SCOPE || p.startsWith(SCOPE + "/");
const isStationApi = (p) => p.startsWith("/api" + SCOPE + "/");
const isAsset = (p) => ASSET_PREFIXES.some((prefix) => p.startsWith(prefix));

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function networkFirst(request, ms) {
  const cache = await caches.open(PAGES);
  const net = fetch(request).then((res) => {
    if (res && res.ok && res.type === "basic") cache.put(request, res.clone());
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), ms))]);
  } catch (e) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    return net;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
    trim(cache);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p === SCOPE + "/sw.js") return;
  if (request.mode === "navigate" && isStationPage(p)) return event.respondWith(networkFirst(request, 4000));
  if (isStationApi(p)) return event.respondWith(networkFirst(request, 6000));
  if (isAsset(p)) return event.respondWith(cacheFirst(request));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "warm") return;
  event.waitUntil((async () => {
    const origin = self.location.origin;
    const pages = await caches.open(PAGES);
    const assets = await caches.open(ASSETS);
    for (const href of data.pages || []) {
      try { const u = new URL(href, origin); if (u.origin === origin && (isStationPage(u.pathname) || isStationApi(u.pathname))) await pages.add(u.pathname + u.search); } catch (e) {}
    }
    for (const href of data.assets || []) {
      try { const u = new URL(href, origin); if (u.origin === origin && isAsset(u.pathname) && !(await assets.match(u.href))) await assets.add(u.href); } catch (e) {}
    }
    await trim(assets);
  })());
});
`;
}

/** The worker as a response: no-cache so a new version is picked up at the next visit, allowed to control only its station's scope. */
export function stationWorkerResponse(config: StationWorker): Response {
  return new Response(stationWorkerSource(config), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0",
      "Service-Worker-Allowed": config.scope,
    },
  });
}
