"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import type { Venue } from "@/lib/types";
import { Chips } from "./ui";

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

/** All · Drift · Chiobu · Greedy · Gelato. Also writes the choice into the URL so the view is shareable. */
export function VenueChips({ className }: { className?: string }) {
  const { slug, setVenue, venues, hasUrl } = useVenue();
  useEffect(() => {
    if (!hasUrl && slug !== "all") setVenue(slug);
  }, [hasUrl, slug, setVenue]);
  return (
    <Chips
      ariaLabel="Venue"
      className={className}
      value={slug}
      onChange={setVenue}
      options={[
        { value: "all", label: "All" },
        ...venues.map((v) => ({
          value: v.slug,
          label: (
            <span className="inline-flex items-center gap-2">
              {slug !== v.slug ? <span aria-hidden className={`v-${v.slug} inline-block h-2 w-2 rounded-full bg-accent-fill`} /> : null}
              {VENUE_SHORT[v.slug] ?? v.name}
            </span>
          ),
          className: slug === v.slug ? `v-${v.slug}` : undefined,
        })),
      ]}
    />
  );
}
