"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isBackArrow, isNavigationScroll, savePosition, savedPosition, shouldRestore } from "@/lib/scroll-memory";

const here = () => window.location.pathname + window.location.search;
const INPUTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Puts the page back at the SAVED place (the whole list, not just the top). Waits for the page to be tall enough, pressing
 * Show More when a long list needs it, and gives up the moment the person scrolls or touches the screen. Returns a cancel
 * function.
 */
function restoreTo(y: number): () => void {
  let done = false;
  let frame: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let showMoreClicks = 0;
  const started = Date.now();
  const stop = () => {
    done = true;
    clearTimeout(frame);
    clearTimeout(settle);
    for (const ev of INPUTS) window.removeEventListener(ev, stop);
  };
  for (const ev of INPUTS) window.addEventListener(ev, stop, { passive: true });
  const jump = (top: number) => window.scrollTo({ top, behavior: "instant" }); // the page has smooth scrolling on: never animate this
  const tick = () => {
    if (done) return;
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (room >= y - 2) {
      jump(y);
      // one settling pass: images and late rows can move the page a little
      settle = setTimeout(() => {
        if (!done && Math.abs(window.scrollY - y) > 4) jump(y);
        stop();
      }, 200);
      return;
    }
    // long lists show 100 rows and a Show More button; a place below that needs the rest of the rows first
    if (showMoreClicks < 12) {
      const more = Array.from(document.querySelectorAll<HTMLButtonElement>("main button")).find((b) => /^Show More\b/.test(b.textContent?.trim() ?? ""));
      if (more) {
        showMoreClicks++;
        more.click();
        frame = setTimeout(tick, 50);
        return;
      }
    }
    if (Date.now() - started > 4000) {
      jump(Math.max(0, room)); // the list is shorter than before: as far down as it goes
      stop();
      return;
    }
    frame = setTimeout(tick, 50);
  };
  frame = setTimeout(tick, 50);
  return stop;
}

/**
 * Returns a page to where it was left (Troy, 10 Oct 2026: open Onion low in the Ingredients list, press Back, land on
 * Onion). Mounted once in the app frame. The place is saved when a link is pressed and as the page scrolls, and restored on
 * arrival by Back or Forward, a reload, or the back arrow at the top of a record (isBackArrow); an ordinary
 * link to a page still starts at the top. The list loads from the store a moment after the page appears, so the restore waits
 * (see restoreTo). Next.js handles Back's route change and this component's listener in either order, so both are covered.
 */
export function ScrollMemory() {
  const pathname = usePathname();
  const popped = useRef(false);
  const backArrow = useRef(false);
  const linkAt = useRef<number | null>(null);
  const first = useRef(true);
  const arrived = useRef<{ path: string; at: number } | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  const begin = (url: string) => {
    cancel.current?.();
    cancel.current = null;
    const y = savedPosition(url);
    if (y > 0) cancel.current = restoreTo(y);
  };

  useEffect(() => {
    const hist = window.history;
    const prev = hist.scrollRestoration;
    try {
      hist.scrollRestoration = "manual"; // we do it, so the browser does not also do it at the wrong moment
    } catch {
      /* ignore */
    }
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        if (isNavigationScroll(y, linkAt.current == null ? null : Date.now() - linkAt.current)) return;
        savePosition(here(), y);
      });
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      savePosition(here(), window.scrollY);
      linkAt.current = Date.now();
      backArrow.current = isBackArrow(a);
    };
    let popTimer: ReturnType<typeof setTimeout> | undefined;
    const onPop = () => {
      // Back or Forward. If the page change already happened (Next.js moved first), restore now; else the arrival does it.
      const a = arrived.current;
      if (a && a.path === window.location.pathname && Date.now() - a.at < 500) {
        begin(here());
        return;
      }
      popped.current = true; // cleared when the page arrives, or after a second if the path never changed (a sheet closing)
      clearTimeout(popTimer);
      popTimer = setTimeout(() => (popped.current = false), 1000);
    };
    const onHide = () => savePosition(here(), window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearTimeout(popTimer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pagehide", onHide);
      cancel.current?.();
      try {
        hist.scrollRestoration = prev;
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // on arrival at a page (and on first load), put it back where it was if this arrival is a return
  useEffect(() => {
    const navType = first.current ? ((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? null) : null;
    const arrival = { popped: popped.current, backArrow: backArrow.current, navType };
    first.current = false;
    popped.current = false;
    backArrow.current = false;
    linkAt.current = null;
    arrived.current = { path: window.location.pathname, at: Date.now() };
    cancel.current?.();
    cancel.current = null;
    if (shouldRestore(arrival)) begin(here());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
