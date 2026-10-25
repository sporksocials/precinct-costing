"use client";

import { ArrowDown, ArrowUp, Ban, Check, Copy, Minus, Target, X } from "lucide-react";
import { cx } from "@/components/ui";
import { useVenue, VENUE_SHORT } from "@/components/venue";
import { VenueMark } from "@/components/brand";
import type { OutcomeView, PriceMove, StatusIcon } from "@/lib/invoice-view";

const ICON: Record<StatusIcon, typeof Check> = { check: Check, target: Target, dash: Minus, copy: Copy, x: X, ban: Ban };

/** A status as icon plus words. Amber (the existing warn token) only when it waits on a person, red only when it could not be read. */
export function StatusLabel({ view, className }: { view: OutcomeView; className?: string }) {
  const Icon = ICON[view.icon];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[15px] font-medium", view.tone === "warn" ? "text-warn" : view.tone === "danger" ? "text-danger" : "text-label-2", className)}>
      <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{view.word}</span>
    </span>
  );
}

/** "Up 2.8%" with an arrow, in plain text colour: a price move is information, not a warning. */
export function MoveLabel({ move, className }: { move: PriceMove; className?: string }) {
  if (move.dir === "none") return null;
  const Icon = move.dir === "up" ? ArrowUp : move.dir === "down" ? ArrowDown : Minus;
  return (
    <span className={cx("inline-flex items-center gap-1 text-[15px] font-medium text-label sm:text-[13px]", className)}>
      <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{move.text}</span>
    </span>
  );
}

/** The amber "needs a person" word, always with its icon. */
export function NeedsTag({ children = "Needs approval" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-0.5 text-[13px] font-semibold text-warn">
      <Target aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
      {children}
    </span>
  );
}

/**
 * A compact venue chip row (All, Drift, Chiobu, Greedy, Gelato) for the Invoices page: small pills with the venue emblem, not the big
 * tiles. The choice is `?venue=` in the address like everywhere else. `slugs` lists the venues that have anything to show; the row
 * hides itself when there is only one, because there is nothing to choose.
 */
export function VenueChips({ slugs }: { slugs: readonly string[] }) {
  const { slug, setVenue, venues } = useVenue();
  const options = venues.filter((v) => slugs.includes(v.slug));
  if (options.length < 2) return null;
  const all = [{ slug: "all", name: "All" }, ...options.map((v) => ({ slug: v.slug, name: VENUE_SHORT[v.slug] ?? v.name }))];
  return (
    <div role="radiogroup" aria-label="Venue" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      {all.map((o) => {
        const on = o.slug === slug;
        return (
          <button
            key={o.slug}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setVenue(o.slug)}
            className={cx(
              "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[15px] font-medium transition-[background-color,color] duration-200 ease-ios active:scale-[0.97] motion-reduce:transition-none",
              on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-surface-2",
            )}
          >
            <VenueMark slug={o.slug} size={16} tone={on ? "ink" : "colour"} />
            {o.name}
            {on ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
          </button>
        );
      })}
    </div>
  );
}
