"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps a cocktail station iPad working through a shift. Renders nothing.
 *
 * - Offline copy: registers /bar/sw.js (see app/bar/sw.js/route.ts) and tells it what this page loaded so the very
 *   first visit is saved too, not just later ones.
 * - Screen on: asks the browser to keep the screen awake. iPadOS can refuse this (older versions, or a Home Screen app
 *   on some releases), so it is a bonus only: the reliable fix is Auto-Lock "Never" and Guided Access, in /bar/setup.
 */
export function BarKiosk() {
  const pathname = usePathname();

  // runs on every page change too: the iPad starts at /bar and taps into a venue, so each page it reaches is saved as it goes
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    const warm = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/bar/sw.js", { scope: "/bar", updateViaCache: "none" });
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        const target = reg.active ?? navigator.serviceWorker.controller;
        if (!target) return;
        const assets = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.startsWith(location.origin));
        target.postMessage({ type: "warm", pages: Array.from(new Set(["/bar", location.pathname + location.search])), assets });
      } catch {
        // no service worker (private browsing, older browser): the station still works online
      }
    };
    // wait for the page's own files to finish loading so the list above is complete
    if (document.readyState === "complete") void warm();
    else window.addEventListener("load", () => void warm(), { once: true });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (lock || document.visibilityState !== "visible") return;
      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => {
          lock = null;
        });
      } catch {
        // refused (low battery, not allowed here): the setup page's Auto-Lock steps cover it
      }
    };
    void acquire();
    const again = () => void acquire();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("pointerdown", again, { passive: true }); // some releases only allow it after a touch
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("pointerdown", again);
      void lock?.release();
    };
  }, []);

  return null;
}
