"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import type { Venue } from "@/lib/types";
import { cx } from "./ui";

export const VENUE_SHORT: Record<string, string> = { drift: "Drift", chiobu: "Chiobu", greedy: "Greedy", gelato: "Gelato" };

/**
 * The venue filter: ?venue=slug in the URL and nothing else (no stored choice, no silent restore).
 * Absent or unknown means All. Only pages that render <VenueFilter> read it.
 */
export function useVenue(): { venue: Venue | null; slug: string; setVenue: (slug: string) => void; venues: Venue[] } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { venues } = useStore();
  const venue = venues.find((v) => v.slug === params.get("venue")) ?? null;
  const slug = venue ? venue.slug : "all";

  const setVenue = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params.toString());
      if (!next || next === "all") p.delete("venue");
      else p.set("venue", next);
      const q = p.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  return { venue, slug, setVenue, venues };
}

/** `?venue=slug` suffix for links that should keep the current filter ("" when All). */
export function venueQuery(venue: Venue | null | undefined): string {
  return venue ? `?venue=${venue.slug}` : "";
}

/** Sets the accent colour (<html data-venue>) while mounted; back to the neutral sand accent on unmount. */
function useAccent(slug: string) {
  useEffect(() => {
    document.documentElement.setAttribute("data-venue", slug);
    return () => document.documentElement.setAttribute("data-venue", "all");
  }, [slug]);
}

/** For record pages (menu item, prep, beer, gelato serve): the accent is the record's own venue; sand when it has none. */
export function VenueAccent({ slug }: { slug: string | null | undefined }) {
  useAccent(slug || "all");
  return null;
}

/**
 * The visible venue filter for Home, Recipes and Beers: All / Drift / Chiobu / Greedy / Gelato,
 * each with its colour dot and name. Scrolls sideways if it ever runs out of room.
 * While it is on screen, the app accent follows the chosen venue; leave the page and it goes back to sand.
 */
export function VenueFilter({ className }: { className?: string }) {
  const { slug, setVenue, venues } = useVenue();
  useAccent(slug);
  const ref = useRef<HTMLDivElement>(null);
  // keep the chosen venue in view when the row scrolls (phones)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [slug]);
  const options = [{ slug: "all", name: "All" }, ...venues.map((v) => ({ slug: v.slug, name: VENUE_SHORT[v.slug] ?? v.name }))];
  return (
    <div ref={ref} role="radiogroup" aria-label="Venue" className={cx("no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <div className="flex w-max min-w-full gap-1 rounded-[12px] bg-fill p-[3px] sm:w-full">
        {options.map((o) => {
          const on = o.slug === slug;
          return (
            <button
              key={o.slug}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setVenue(o.slug)}
              className={cx(
                o.slug !== "all" && `v-${o.slug}`,
                "flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 text-[15px] font-medium transition-[background-color,box-shadow,color] duration-200 ease-ios active:scale-[0.98] lg:min-h-[38px]",
                on ? "bg-elevated text-label shadow-[0_1px_3px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(255,255,255,0.04)]" : "text-label-2 hover:text-label",
              )}
            >
              <span aria-hidden className={cx("h-2.5 w-2.5 shrink-0 rounded-full", o.slug === "all" ? "precinct-strip" : "bg-accent-fill", !on && "opacity-70")} />
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
