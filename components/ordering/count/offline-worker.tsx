"use client";

import { useEffect } from "react";

/**
 * Keeps the count screen working with no signal. Renders nothing. Mounted on the count page only.
 *
 * - Offline copy of the app shell: registers /ordering/sw.js (scope /ordering, see lib/ordering-sw-source.ts for exactly what it
 *   saves and why that is safe behind login) and tells it what this page loaded so the first visit is saved too. Production only:
 *   in `next dev` the worker would serve stale scripts.
 * - Screen on: asks the browser to keep the screen awake while a count is being taken. Some iPad and iPhone releases refuse
 *   it, so it is a bonus only and fails quietly.
 */
export function OfflineWorker({ slug, counting }: { slug: string; counting: boolean }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    const warm = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/ordering/sw.js", { scope: "/ordering", updateViaCache: "none" });
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        const target = reg.active ?? navigator.serviceWorker.controller;
        if (!target) return;
        const assets = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.startsWith(location.origin));
        target.postMessage({ type: "warm", pages: [`/ordering/${slug}/count`], assets });
      } catch {
        // no service worker (private browsing, older browser): the screen still works online, and keeps working offline while this page stays open
      }
    };
    if (document.readyState === "complete") void warm();
    else window.addEventListener("load", () => void warm(), { once: true });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!counting || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (lock || document.visibilityState !== "visible") return;
      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => {
          lock = null;
        });
      } catch {
        // refused (low battery, not allowed here): nothing to do
      }
    };
    void acquire();
    const again = () => void acquire();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("pointerdown", again, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("pointerdown", again);
      void lock?.release();
    };
  }, [counting]);

  return null;
}
