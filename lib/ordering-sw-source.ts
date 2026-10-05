/**
 * Source of the service worker for the Ordering count screen (scope /ordering, served from app/ordering/sw.js/route.ts).
 *
 * The Ordering pages are BEHIND LOGIN (unlike the bar and kitchen stations, which are public), so this worker is deliberately
 * smaller than lib/sw-source.ts and never stores anything personal:
 *   - It saves ONE kind of page: the count screen (/ordering/<venue>/count), network first with a 4 second limit, so a venue
 *     counted on patchy wifi opens even with no signal. That page is the app shell only: the products, counts and names are
 *     fetched by the page after it loads (from the database online, from the device's own IndexedDB copy offline), so no
 *     person's data is in what the worker holds.
 *   - A page is only saved when the server really answered it (200, no redirect). A redirect to /login (signed out) is never
 *     saved, and it also deletes the saved shell, so a signed-out device stops serving it as soon as it is next online.
 *   - Built files (/_next/static: scripts, styles, fonts) and the brand icons are saved on first use, newest kept, so the shell can start.
 *   - Everything else (the costing app, other Ordering pages, the Supabase API, other origins, every non-GET) is left alone: no
 *     API reply or data request is ever cached by this worker.
 * Trade-off, stated plainly: a signed-out person on the same device can still open the empty shell offline (it then cannot
 * load any data, because the store cache is wiped at sign out and the device copy is only shown to the person it was saved for).
 * The count screen works offline only for a device that opened it online once while signed in.
 */
export function orderingWorkerSource(): string {
  return `
const VERSION = "v1";
const SCOPE = "/ordering";
const PREFIX = "ordering-";
const PAGES = PREFIX + "pages-" + VERSION;
const ASSETS = PREFIX + "assets-" + VERSION;
const MAX_ASSETS = 400;
const ASSET_PREFIXES = ["/_next/static/", "/brand/", "/icon", "/apple-touch-icon"];
const COUNT_PAGE = /^\\/ordering\\/[a-z0-9-]+\\/count\\/?$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== PAGES && key !== ASSETS) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const isCountPage = (p) => COUNT_PAGE.test(p);
const isAsset = (p) => ASSET_PREFIXES.some((prefix) => p.startsWith(prefix));
const pageKey = (url) => new Request(url.origin + url.pathname.replace(/\\/$/, ""));
/** the server really answered this page (not a sign-in redirect, not an error) */
const answered = (res) => res && res.ok && !res.redirected && res.type === "basic";
/** the server sent the person to sign in */
const signedOut = (res) => res && (res.type === "opaqueredirect" || res.redirected || res.status === 401 || res.status === 403);

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function countPage(request, url) {
  const cache = await caches.open(PAGES);
  const key = pageKey(url);
  const net = fetch(request).then(async (res) => {
    if (answered(res)) await cache.put(key, res.clone());
    else if (signedOut(res)) await cache.delete(key);
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000))]);
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    return net;
  }
}

async function asset(request) {
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
  if (request.mode === "navigate" && isCountPage(p)) return event.respondWith(countPage(request, url));
  if (isAsset(p)) return event.respondWith(asset(request));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "warm") return;
  event.waitUntil((async () => {
    const origin = self.location.origin;
    const pages = await caches.open(PAGES);
    const assets = await caches.open(ASSETS);
    for (const href of data.pages || []) {
      try {
        const u = new URL(href, origin);
        if (u.origin !== origin || !isCountPage(u.pathname)) continue;
        const res = await fetch(u.pathname, { credentials: "same-origin" });
        if (answered(res)) await pages.put(pageKey(u), res);
      } catch (e) {}
    }
    for (const href of data.assets || []) {
      try { const u = new URL(href, origin); if (u.origin === origin && isAsset(u.pathname) && !(await assets.match(u.href))) await assets.add(u.href); } catch (e) {}
    }
    await trim(assets);
  })());
});
`;
}

/** The worker as a response: no-cache so a new version is picked up at the next visit, allowed to control only /ordering. */
export function orderingWorkerResponse(): Response {
  return new Response(orderingWorkerSource(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0",
      "Service-Worker-Allowed": "/ordering",
    },
  });
}
