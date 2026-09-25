"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Venue } from "@/lib/types";
import { gp } from "@/lib/format";
import { gpSummary, underTargetRows } from "@/lib/insights";
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
 * The venue selector for Home, Recipes, Beers, Gelato and Ingredients: five separate tiles
 * (All / Drift / Chiobu / Greedy / Gelato). Each carries a venue colour bar; the chosen one fills with
 * the venue accent, shows a check and a ring. Desktop tiles add average GP and how many are under target
 * (`stats`, on by default; pass `stats={false}` to hide). Phones get compact tiles in one snap-scrolling row.
 * While it is on screen, the app accent follows the chosen venue; leave the page and it goes back to sand.
 */
export function VenueFilter({ className, stats = true, compact = false }: { className?: string; stats?: boolean; compact?: boolean }) {
  const { slug, setVenue, venues } = useVenue();
  const { itemCosts } = useStore();
  useAccent(slug);
  const ref = useRef<HTMLDivElement>(null);
  // keep the chosen venue in view when the row scrolls (phones)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) ref.current!.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: "smooth" });
  }, [slug]);
  const options = useMemo(() => [{ id: null as number | null, slug: "all", name: "All" }, ...venues.map((v) => ({ id: v.id as number | null, slug: v.slug, name: VENUE_SHORT[v.slug] ?? v.name }))], [venues]);
  const tileStats = useMemo(() => {
    if (!stats) return null;
    const all = Array.from(itemCosts.values());
    return options.map((o) => ({ avg: gpSummary(all, o.id).avg, under: underTargetRows(all, o.id).length }));
  }, [stats, options, itemCosts]);

  // roving focus: arrows move the choice like a native radio group
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.slug === slug);
    const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (at + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    setVenue(options[next].slug);
    requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus());
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label="Venue"
      onKeyDown={onKeyDown}
      className={cx("no-scrollbar -mx-4 flex snap-x snap-proximity gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:overflow-visible sm:px-0", className)}
    >
      {options.map((o, i) => {
        const on = o.slug === slug;
        const st = tileStats?.[i];
        return (
          <button
            key={o.slug}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => setVenue(o.slug)}
            className={cx(
              `v-${o.slug}`,
              "group relative flex min-h-[44px] min-w-[76px] shrink-0 snap-start flex-col justify-center overflow-hidden rounded-[14px] px-3.5 pb-2 pt-3 text-left transition-[background-color,box-shadow,color,transform] duration-200 ease-ios active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)] sm:min-h-[64px] sm:min-w-0 sm:shrink sm:px-4",
              !compact && stats && "sm:min-h-[76px]",
              on ? "bg-accent-fill text-accent-on shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent-fill)]" : "bg-surface text-label-2 hover:bg-surface-2 hover:text-label",
            )}
          >
            <span aria-hidden className={cx("absolute inset-x-0 top-0 h-[3px]", o.slug === "all" ? "precinct-strip" : on ? "bg-[color:var(--venue-2)]" : "bg-accent-fill")} />
            <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight">
              <span className="truncate">{o.name}</span>
              {on ? <Check aria-hidden className="h-4 w-4 shrink-0" strokeWidth={3} /> : null}
            </span>
            {st ? (
              <span className="mt-1 hidden items-baseline gap-2 text-[13px] leading-tight tnum sm:flex">
                <span className={on ? "" : "text-label"}>{st.avg != null ? gp(st.avg, 0) : "No GP"}</span>
                <span className={cx(st.under > 0 && (on ? "font-semibold" : "text-danger"), st.under === 0 && !on && "text-label-3")}>{st.under} under</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
