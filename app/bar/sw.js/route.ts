/**
 * Service worker for the cocktail station iPads (scope /bar). It keeps the last good copy of the station on the iPad so a
 * Wi-Fi drop, a server blip or an iPadOS app relaunch never leaves a bartender looking at a blank page.
 *
 * - Pages under /bar and the refresh API: network first (4 second limit), the saved copy if the network is down or slow.
 *   The saved API reply keeps its own "syncedAt", so the on-screen "Synced ... ago" and the out-of-date banner stay truthful.
 * - Built files (/_next/static), reference photos, logos and icons: saved on first use, served from the save after that.
 * - The page tells the worker what it has loaded ("warm" message) so even the very first visit is saved, before the worker took over.
 * - Everything else (the costing app, Supabase, other origins, non-GET) is left alone.
 */
const SOURCE = `
const VERSION = "v1";
const PAGES = "bar-pages-" + VERSION;
const ASSETS = "bar-assets-" + VERSION;
const MAX_ASSETS = 250;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("bar-") && key !== PAGES && key !== ASSETS) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const isBarPage = (p) => p === "/bar" || p.startsWith("/bar/");
const isAsset = (p) =>
  p.startsWith("/_next/static/") || p.startsWith("/bar/cocktails/") || p.startsWith("/bar/photo/") || p.startsWith("/brand/") ||
  p.startsWith("/icon") || p.startsWith("/apple-touch-icon");

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
  if (p === "/bar/sw.js") return;
  if (request.mode === "navigate" && isBarPage(p)) return event.respondWith(networkFirst(request, 4000));
  if (p.startsWith("/api/bar/")) return event.respondWith(networkFirst(request, 6000));
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
      try { const u = new URL(href, origin); if (u.origin === origin && isBarPage(u.pathname)) await pages.add(u.pathname + u.search); } catch (e) {}
    }
    for (const href of data.assets || []) {
      try { const u = new URL(href, origin); if (u.origin === origin && isAsset(u.pathname) && !(await assets.match(u.href))) await assets.add(u.href); } catch (e) {}
    }
    await trim(assets);
  })());
});
`;

export function GET() {
  return new Response(SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0",
      "Service-Worker-Allowed": "/bar",
    },
  });
}
