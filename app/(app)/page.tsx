"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { gpSummary, priceIncreases, underTargetRows, type GpSummary } from "@/lib/insights";
import { gp, movePct } from "@/lib/format";
import type { Venue } from "@/lib/types";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, VenueChips, VENUE_SHORT } from "@/components/venue";
import { cx, Dot, Group, Row } from "@/components/ui";
import { PrecinctMark, VenueLogo } from "@/components/brand";

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
  const under = useMemo(() => underTargetRows(store.itemCosts.values(), venue?.id ?? null), [store.itemCosts, venue]);
  const itemById = useMemo(() => new Map(store.items.map((i) => [i.id, i])), [store.items]);
  const increases = useMemo(
    () => priceIncreases(store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venue?.id ?? null),
    [store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venue],
  );

  const isGelato = venue?.slug === "gelato";
  const empty = headline.count === 0;

  return (
    <div>
      <header className="pb-5 pt-3 lg:pt-8">
        {venue ? (
          <>
            <h1 className="sr-only">{venue.name}</h1>
            <div className="masthead relative overflow-hidden rounded-3xl px-5 pb-7 pt-5 lg:px-8 lg:pb-9 lg:pt-7">
              <button type="button" onClick={() => setVenue("all")} className="eyebrow text-[11px] text-label/70 transition hover:text-label">
                ← Caloundra Food Precinct
              </button>
              <div className="mt-5 flex min-h-[84px] items-center lg:min-h-[104px]">
                <VenueLogo slug={venue.slug} height={72} className="lg:!h-[92px]" />
              </div>
              <span aria-hidden className="masthead-strip absolute inset-x-0 bottom-0 h-1.5" />
            </div>
          </>
        ) : (
          <>
            <h1 className="sr-only">Caloundra Food Precinct costing</h1>
            <PrecinctMark size="lg" sub="Costing" />
          </>
        )}
      </header>
      <VenueChips />

      {/* 1. headline */}
      <section className="relative mt-5 overflow-hidden rounded-3xl bg-surface px-5 pb-6 pt-6 lg:px-8 lg:pt-8">
        <span aria-hidden className={cx("absolute inset-x-0 top-0 h-1", venue ? "bg-accent-fill" : "precinct-strip")} />
        <p className="eyebrow text-[12px] text-label-2">Average GP{venue ? "" : " · all venues"}</p>
        {empty ? (
          <div className="mt-2">
            <p className="display text-[88px] text-label-3">—</p>
            {venue ? (
              <button type="button" className="btn-tinted mt-4" onClick={() => newRecipe.open({ venueId: venue.id })}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> Add recipe
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="display mt-2 text-[88px] tnum text-accent lg:text-[112px]">{gp(headline.avg)}</p>
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
            sub={`Worst: ${under[0].cost.item.name} · ${gp(under[0].cost.gpPct)}`}
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
      <button type="button" onClick={onOpen} aria-label={`${v.name}: open`} className="block w-full px-4 pb-4 pt-5 text-left transition hover:bg-fill active:scale-[0.99] active:opacity-80">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-accent-fill" />
        <span className="flex h-[52px] items-center">
          <VenueLogo slug={v.slug} height={40} />
        </span>
        <span className="sr-only">{VENUE_SHORT[v.slug] ?? v.name}</span>
        {s.count ? (
          <>
            <span className="display mt-3 block text-[46px] tnum text-accent">{gp(s.avg)}</span>
            {!gelato ? <Split s={s} className="mt-0.5 text-[13px] leading-snug" /> : <span className="mt-0.5 block text-[13px] text-transparent">.</span>}
          </>
        ) : (
          <>
            <span className="display mt-3 block text-[46px] text-label-3">—</span>
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

