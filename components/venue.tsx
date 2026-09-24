"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { VenueLogo } from "./brand";
import { useStore } from "@/lib/store";
import type { Venue } from "@/lib/types";
import { cx } from "./ui";

const KEY = "precinct-venue";
const EVT = "precinct-venue";

export const VENUE_SHORT: Record<string, string> = { drift: "Drift", chiobu: "Chiobu", greedy: "Greedy", gelato: "Gelato" };

function readLs(): string {
  try {
    return window.localStorage.getItem(KEY) || "all";
  } catch {
    return "all";
  }
}
function writeLs(slug: string) {
  try {
    window.localStorage.setItem(KEY, slug);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

function useStoredVenue(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    readLs,
    () => "all",
  );
}

/** Selected venue: ?venue=slug in the URL, falling back to the last choice (localStorage). Null = all venues. */
export function useVenue(): { venue: Venue | null; slug: string; setVenue: (slug: string) => void; venues: Venue[]; hasUrl: boolean } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { venues } = useStore();
  const stored = useStoredVenue();
  const urlSlug = params.get("venue");
  const raw = urlSlug ?? stored;
  const venue = venues.find((v) => v.slug === raw) ?? null;
  const slug = venue ? venue.slug : "all";

  const setVenue = useCallback(
    (next: string) => {
      writeLs(next || "all");
      const p = new URLSearchParams(params.toString());
      if (!next || next === "all") p.delete("venue");
      else p.set("venue", next);
      const q = p.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  return { venue, slug, setVenue, venues, hasUrl: urlSlug != null };
}

/** Keeps <html data-venue> (accent colour) and localStorage in step with the URL. */
export function VenueSync() {
  const params = useSearchParams();
  const stored = useStoredVenue();
  const urlSlug = params.get("venue");
  const slug = urlSlug ?? stored;
  useEffect(() => {
    document.documentElement.setAttribute("data-venue", slug || "all");
    if (urlSlug && urlSlug !== readLs()) writeLs(urlSlug);
  }, [slug, urlSlug]);
  return null;
}

/**
 * The venue picker, always in view: All + the four venue logos as one row of tiles.
 * The chosen tile sits on its venue's masthead colours; the others are dimmed until touched.
 */
const TILE_H: Record<string, number> = { drift: 27, chiobu: 25, greedy: 24, gelato: 27 };

export function VenueStrip({ className }: { className?: string }) {
  const { slug, setVenue, venues } = useVenue();
  const tiles = [{ slug: "all", name: "All Venues" }, ...venues.map((v) => ({ slug: v.slug, name: v.name }))];
  return (
    <div role="radiogroup" aria-label="Venue" className={cx("grid grid-cols-5 gap-1.5 rounded-2xl bg-surface p-1.5 lg:gap-2", className)}>
      {tiles.map((t) => {
        const on = slug === t.slug;
        return (
          <button
            key={t.slug}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t.name}
            title={t.name}
            onClick={() => setVenue(t.slug)}
            className={cx(
              t.slug !== "all" && `v-${t.slug}`,
              "group relative flex h-16 items-center justify-center overflow-hidden rounded-xl px-1 transition duration-200 ease-ios active:scale-[0.96] lg:h-16",
              on ? (t.slug === "all" ? "bg-surface-2" : "masthead") : "hover:bg-fill",
            )}
          >
            {t.slug === "all" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/precinct.png" alt="" className={cx("h-9 w-auto transition-opacity", on ? "opacity-100" : "opacity-55 group-hover:opacity-85")} draggable={false} />
            ) : (
              <span className={cx("flex max-w-full items-center justify-center transition-opacity [&_img]:max-w-full", on ? "opacity-100" : "opacity-55 group-hover:opacity-85")}>
                <VenueLogo slug={t.slug} height={TILE_H[t.slug] ?? 22} className="object-center" />
              </span>
            )}
            <span aria-hidden className={cx("absolute inset-x-2 bottom-1 h-[3px] rounded-full transition-opacity", t.slug === "all" ? "precinct-strip" : "bg-accent-fill", on ? "opacity-100" : "opacity-0")} />
          </button>
        );
      })}
    </div>
  );
}

/** Desktop sidebar version: one row per venue, logo + name, the chosen one highlighted. */
export function VenueList({ className }: { className?: string }) {
  const { slug, setVenue, venues } = useVenue();
  const rows = [{ slug: "all", name: "All Venues" }, ...venues.map((v) => ({ slug: v.slug, name: VENUE_SHORT[v.slug] ?? v.name }))];
  return (
    <div role="radiogroup" aria-label="Venue" className={cx("space-y-0.5", className)}>
      {rows.map((r) => {
        const on = slug === r.slug;
        return (
          <button
            key={r.slug}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setVenue(r.slug)}
            className={cx(
              r.slug !== "all" && `v-${r.slug}`,
              "relative flex h-10 w-full items-center gap-2.5 overflow-hidden rounded-lg px-2.5 text-left text-[15px] transition-colors",
              on ? "bg-fill-2 font-semibold" : "text-label-2 hover:bg-fill hover:text-label",
            )}
          >
            <span aria-hidden className={cx("h-2.5 w-2.5 shrink-0 rounded-full", r.slug === "all" ? "precinct-strip" : "bg-accent-fill", !on && "opacity-60")} />
            {r.name}
            {on ? <span aria-hidden className={cx("absolute inset-y-2 left-0 w-[3px] rounded-full", r.slug === "all" ? "bg-sand" : "bg-accent-fill")} /> : null}
          </button>
        );
      })}
    </div>
  );
}
