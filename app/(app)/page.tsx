"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { gpSummary, priceIncreases, underTarget, type GpSummary } from "@/lib/insights";
import { gp, movePct } from "@/lib/format";
import type { Venue } from "@/lib/types";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, VenueChips, VENUE_SHORT } from "@/components/venue";
import { cx, Dot, Group, Row } from "@/components/ui";

function Split({ s, className }: { s: GpSummary; className?: string }) {
  const parts: string[] = [];
  if (s.food != null) parts.push(`Food ${gp(s.food, 0)}`);
  if (s.drinks != null) parts.push(`Drinks ${gp(s.drinks, 0)}`);
  if (!parts.length) return null;
  return <span className={cx("block tnum text-label-2", className)}>{parts.join("  ·  ")}</span>;
}

export default function HomePage() {
  const store = useStore();
  const { venue, setVenue } = useVenue();
  const newRecipe = useNewRecipe();
  const qs = venue ? `&venue=${venue.slug}` : "";

  const headline = useMemo(() => gpSummary(store.itemCosts.values(), venue?.id ?? null), [store.itemCosts, venue]);
  const perVenue = useMemo(() => store.venues.map((v) => ({ v, s: gpSummary(store.itemCosts.values(), v.id) })), [store.venues, store.itemCosts]);
  const under = useMemo(() => underTarget(store.itemCosts.values(), venue?.id ?? null), [store.itemCosts, venue]);
  const itemById = useMemo(() => new Map(store.items.map((i) => [i.id, i])), [store.items]);
  const increases = useMemo(
    () => priceIncreases(store.priceLogs, store.index.ingredients, store.lines, itemById, store.settings.alert_pct, venue?.id ?? null),
    [store.priceLogs, store.index.ingredients, store.lines, itemById, store.settings.alert_pct, venue],
  );

  const isGelato = venue?.slug === "gelato";
  const empty = headline.count === 0;

  return (
    <div>
      <header className="pb-4 pt-2 lg:pt-8">
        <h1 className="text-large-title font-bold tracking-tight lg:text-[30px]">{venue ? venue.name : "Home"}</h1>
      </header>
      <VenueChips />

      {/* 1. headline */}
      <section className="mt-5 rounded-3xl bg-surface px-5 pb-6 pt-5 lg:px-8 lg:pt-7">
        <p className="text-[15px] font-medium text-label-2">Average GP</p>
        {empty ? (
          <div className="mt-2">
            <p className="text-hero text-label-3">—</p>
            {venue ? (
              <button type="button" className="btn-tinted mt-4" onClick={() => newRecipe.open({ venueId: venue.id })}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> Add recipe
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="mt-1 text-hero tnum lg:text-[64px]">{gp(headline.avg)}</p>
            {!isGelato ? <Split s={headline} className="mt-2 text-[17px] sm:text-[15px]" /> : null}
          </>
        )}
      </section>

      {/* 2. venue cards (all-venues view only) */}
      {!venue ? (
        <section className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {perVenue.map(({ v, s }) => (
            <VenueCard key={v.id} v={v} s={s} onOpen={() => setVenue(v.slug)} onAdd={() => newRecipe.open({ venueId: v.id })} />
          ))}
        </section>
      ) : null}

      {/* 3. needs attention (hidden for a venue with nothing costed yet) */}
      {empty && !under.length && !increases.length ? null : (
      <Group title="Needs attention" className="mt-8" inset="2.25rem">
        {under.length ? (
          <Row
            href={`/alerts?view=under${qs}`}
            leading={<Dot className="bg-danger" />}
            title={`${under.length} ${under.length === 1 ? "dish" : "dishes"} below target GP`}
            sub={`Worst: ${under[0].item.name} · ${gp(under[0].gpPct)}`}
            chevron
          />
        ) : (
          <Row leading={<Dot className="bg-[color:var(--good)]" />} title="All dishes on target" />
        )}
        {increases.length ? (
          <Row
            href={`/alerts?view=increases${qs}`}
            leading={<Dot className="bg-warn" />}
            title={`${increases.length} price ${increases.length === 1 ? "increase" : "increases"} this month`}
            sub={`${increases[0].ingredient.name} ${movePct(increases[0].movePct)} · ${increases[0].recipeCount} ${increases[0].recipeCount === 1 ? "recipe" : "recipes"}`}
            chevron
          />
        ) : null}
      </Group>
      )}
    </div>
  );
}

function VenueCard({ v, s, onOpen, onAdd }: { v: Venue; s: GpSummary; onOpen: () => void; onAdd: () => void }) {
  const gelato = v.slug === "gelato";
  return (
    <div className={cx(`v-${v.slug}`, "relative overflow-hidden rounded-2xl bg-surface")}>
      <button type="button" onClick={onOpen} className="block w-full px-4 pb-4 pt-3.5 text-left transition active:scale-[0.99] active:opacity-80">
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-accent-fill" />
        <span className="block truncate text-[15px] font-semibold text-accent">{VENUE_SHORT[v.slug] ?? v.name}</span>
        {s.count ? (
          <>
            <span className="mt-1 block text-[28px] font-semibold leading-tight tnum">{gp(s.avg)}</span>
            {!gelato ? <Split s={s} className="mt-0.5 text-[13px] leading-snug" /> : <span className="mt-0.5 block text-[13px] text-transparent">.</span>}
          </>
        ) : (
          <>
            <span className="mt-1 block text-[28px] font-semibold leading-tight text-label-3">—</span>
            <span className="mt-0.5 block text-[13px] text-label-2">No recipes yet</span>
          </>
        )}
      </button>
      {!s.count ? (
        <button type="button" onClick={onAdd} aria-label={`Add recipe to ${v.name}`} className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

