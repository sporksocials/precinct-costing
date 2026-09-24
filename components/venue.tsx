"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, ChevronsUpDown } from "lucide-react";
import { VenueLogo } from "./brand";
import { useStore } from "@/lib/store";
import type { Venue } from "@/lib/types";
import { cx, Sheet } from "./ui";

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
 * The one venue switcher. Shows where you are (the venue's logo, or "All Venues") and opens a
 * sheet to switch. The whole app follows the choice; it is remembered and kept in the URL.
 */
export function VenueSwitcher({ variant = "pill", className }: { variant?: "pill" | "card"; className?: string }) {
  const { venue, slug, setVenue, venues } = useVenue();
  const [open, setOpen] = useState(false);
  const pick = (s: string) => {
    setVenue(s);
    setOpen(false);
  };
  const trigger =
    variant === "card" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Venue: ${venue?.name ?? "All Venues"}. Change venue`}
        className={cx(venue ? `v-${venue.slug} masthead` : "bg-surface", "relative flex h-[68px] w-full items-center gap-3 overflow-hidden rounded-xl px-3.5 text-left transition hover:brightness-110 active:scale-[0.99]", className)}
      >
        {venue ? <VenueLogo slug={venue.slug} height={30} /> : <span className="text-[15px] font-semibold">All Venues</span>}
        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-label/70" strokeWidth={2.25} aria-hidden />
        <span aria-hidden className={cx("absolute inset-x-0 bottom-0 h-1", venue ? "masthead-strip" : "precinct-strip")} />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Venue: ${venue?.name ?? "All Venues"}. Change venue`}
        className={cx(venue ? `v-${venue.slug}` : "", "inline-flex h-10 items-center gap-2 rounded-full bg-surface pl-3 pr-2.5 text-[15px] font-semibold shadow-[inset_0_0_0_0.5px_var(--separator)] transition active:scale-[0.97]", className)}
      >
        <span aria-hidden className={cx("h-2.5 w-2.5 rounded-full", venue ? "bg-accent-fill" : "precinct-strip")} />
        <span className="max-w-[9rem] truncate">{venue ? VENUE_SHORT[venue.slug] ?? venue.name : "All Venues"}</span>
        <ChevronDown className="h-4 w-4 text-label-2" strokeWidth={2.5} aria-hidden />
      </button>
    );
  return (
    <>
      {trigger}
      <Sheet open={open} onClose={() => setOpen(false)} title="Venue" cancelLabel={null} action={{ label: "Done", onClick: () => setOpen(false) }} size="sm">
        <div className="space-y-2 pb-2 pt-3">
          <button
            type="button"
            onClick={() => pick("all")}
            className="relative flex h-[72px] w-full items-center gap-3 overflow-hidden rounded-2xl bg-surface px-4 text-left transition active:scale-[0.99]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/precinct.png" alt="" className="h-11 w-auto" />
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-semibold">All Venues</span>
              <span className="block text-[13px] text-label-2">Caloundra Food Precinct</span>
            </span>
            {slug === "all" ? <Check className="h-5 w-5 text-sand" strokeWidth={2.5} /> : null}
            <span aria-hidden className="precinct-strip absolute inset-x-0 bottom-0 h-1" />
          </button>
          {venues.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => pick(v.slug)}
              className={cx(`v-${v.slug}`, "masthead relative flex h-[72px] w-full items-center gap-3 overflow-hidden rounded-2xl px-4 text-left transition active:scale-[0.99]")}
            >
              <VenueLogo slug={v.slug} height={34} />
              <span className="sr-only">{v.name}</span>
              <span className="ml-auto">{slug === v.slug ? <Check className="h-5 w-5 text-accent" strokeWidth={2.5} /> : null}</span>
              <span aria-hidden className="masthead-strip absolute inset-x-0 bottom-0 h-1" />
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
