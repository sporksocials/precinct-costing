"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Plus, Store, TrendingUp } from "lucide-react";
import { useStore } from "@/lib/store";
import { catalogueGaps, gpSummary, ingredientsInUse, priceIncreases, staleIngredients, underTargetRows, type GpSummary, type UnderRow } from "@/lib/insights";
import { parseVirtualItemId } from "@/lib/gelato";
import Link from "next/link";
import { gp, money, movePct } from "@/lib/format";
import { DataTable } from "@/components/table";
import { SetPriceButton } from "@/components/price-actions";
import type { Venue } from "@/lib/types";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, VenueStrip, VENUE_SHORT } from "@/components/venue";
import { cx, Dot, Group, Row } from "@/components/ui";
import { PrecinctMark, VenueLogo } from "@/components/brand";

/** Counts a number up from where it last was (first paint from ~92%), eased; static under reduced motion. */
function useCountUp(target: number | null, ms = 700): number | null {
  const [v, setV] = useState<number | null>(target);
  const from = useRef<number | null>(null);
  useEffect(() => {
    if (target == null) return setV(null);
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = from.current ?? target * 0.92;
    from.current = target;
    if (reduce || start === target) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(start + (target - start) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

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

  const headline = useMemo(() => gpSummary(store.itemCosts.values(), venue?.id ?? null), [store.itemCosts, venue]);
  const perVenue = useMemo(
    () => store.venues.map((v) => ({ v, s: gpSummary(store.itemCosts.values(), v.id), under: underTargetRows(store.itemCosts.values(), v.id) })),
    [store.venues, store.itemCosts],
  );

  const shownAvg = useCountUp(headline.avg);
  const isGelato = venue?.slug === "gelato";
  const empty = headline.count === 0;

  return (
    <div>
      <header className="pb-4 pt-3 lg:pt-8">
        {venue ? (
          <>
            <h1 className="sr-only">{venue.name}</h1>
            <div className="masthead relative overflow-hidden rounded-3xl px-5 pb-7 pt-6 lg:px-8 lg:pb-9 lg:pt-8">
              <div className="flex min-h-[84px] items-center lg:min-h-[104px]">
                <VenueLogo slug={venue.slug} height={72} className="lg:!h-[92px]" />
              </div>
              <span aria-hidden className="masthead-strip absolute inset-x-0 bottom-0 h-1.5" />
            </div>
          </>
        ) : (
          <>
            <h1 className="sr-only">Caloundra Food Precinct costing</h1>
            <PrecinctMark size="lg" sub="Costing" className="lg:hidden" />
            <p aria-hidden className="venue-title hidden text-label lg:block">All Venues</p>
          </>
        )}
      </header>

      <VenueStrip className="mb-4 lg:hidden" />

      {/* 1. headline */}
      <section className="relative overflow-hidden rounded-3xl bg-surface px-5 pb-6 pt-6 lg:px-8 lg:pt-8">
        <span aria-hidden className={cx("absolute inset-x-0 top-0 h-1", venue ? "bg-accent-fill" : "precinct-strip")} />
        <p className="eyebrow text-[12px] text-label-2">Average GP{venue ? "" : " · All Venues"}</p>
        {empty ? (
          <div className="mt-2">
            <p className="display text-[88px] text-label-3">—</p>
            {venue ? (
              <button type="button" className="btn-tinted mt-4" onClick={() => newRecipe.open({ venueId: venue.id })}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> Add First Recipe
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="display mt-2 text-[88px] tnum text-accent lg:text-[112px]" aria-label={gp(headline.avg)}>
              {gp(shownAvg)}
            </p>
            {!isGelato ? <Split s={headline} className="mt-2 text-[17px] sm:text-[15px]" /> : <span className="mt-2 block text-[15px] text-label-2">{headline.count} priced serves</span>}
          </>
        )}
      </section>

      {/* 2. venue cards (all-venues view only) */}
      {!venue ? (
        <section className="anim-stagger mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {perVenue.map(({ v, s, under }) => (
            <VenueCard key={v.id} v={v} s={s} under={under} onOpen={() => setVenue(v.slug)} onAdd={() => newRecipe.open({ venueId: v.id })} />
          ))}
        </section>
      ) : null}

      {/* 3. today: what needs doing, with the fix one tap away */}
      {empty ? null : <Today venueId={venue?.id ?? null} />}
    </div>
  );
}

function Today({ venueId }: { venueId: number | null }) {
  const store = useStore();
  const [allUnder, setAllUnder] = useState(false);
  const [allRises, setAllRises] = useState(false);
  useEffect(() => {
    store.loadPortalPrices();
  }, [store]);

  const under = useMemo(() => underTargetRows(store.itemCosts.values(), venueId), [store.itemCosts, venueId]);
  const itemById = useMemo(() => new Map(store.items.map((i) => [i.id, i])), [store.items]);
  const rises = useMemo(
    () => priceIncreases(store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venueId, 30, store.itemCosts),
    [store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venueId, store.itemCosts],
  );
  const inUse = useMemo(() => ingredientsInUse(store.allLines), [store.allLines]);
  const stale = useMemo(() => staleIngredients(store.ingredients, inUse), [store.ingredients, inUse]);
  const gaps = useMemo(() => catalogueGaps(store.ingredients, store.portalPrices, store.settings.gst_rate), [store.ingredients, store.portalPrices, store.settings.gst_rate]);

  const today = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  const clear = !under.length && !rises.length && !stale.length && !gaps.length;
  const shownUnder = allUnder ? under : under.slice(0, 5);
  const shownRises = allRises ? rises : rises.slice(0, 3);

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[22px] font-bold tracking-tight">Today</h2>
        <span className="text-[13px] text-label-2">{today}</span>
      </div>

      {clear ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-surface px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-good-soft text-good">
            <Check className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span>
            <span className="block text-[17px] font-semibold sm:text-[15px]">All Clear</span>
            <span className="block text-[15px] text-label-2 sm:text-[13px]">Every dish is on target and prices are up to date.</span>
          </span>
        </div>
      ) : null}

      {/* price rises: the cause, before the symptoms */}
      {rises.length ? (
        <Group title={`Price Rises · Last 30 Days`} className="mt-4" inset="3.75rem">
          {shownRises.map((r) => (
            <Row
              key={r.ingredient.id}
              href={`/ingredients/${r.ingredient.id}`}
              leading={
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warn-soft text-warn">
                  <TrendingUp className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </span>
              }
              title={
                <>
                  {r.ingredient.name} <span className="text-danger">{movePct(r.movePct)}</span>
                </>
              }
              sub={[
                `${money(r.log.old_price)} → ${money(r.log.new_price)}`,
                `${r.recipeCount} ${r.recipeCount === 1 ? "recipe" : "recipes"}`,
                r.underCount ? `${r.underCount} now below target` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              chevron
            />
          ))}
          {rises.length > 3 ? (
            <Row onClick={() => setAllRises((x) => !x)} title={<span className="text-accent">{allRises ? "Show Fewer" : `Show All ${rises.length}`}</span>} />
          ) : null}
        </Group>
      ) : null}

      {/* below target, with the fix on the row */}
      {under.length ? (
        <>
          <Group
            title={`Below Target · ${under.length}`}
            className="mt-6 lg:hidden"
            footer="Set applies the suggested price (rounded up to the target GP). You can undo it."
          >
            {shownUnder.map((r) => (
              <UnderRowView key={r.cost.item.id} r={r} showVenue={venueId == null} />
            ))}
            {under.length > 5 ? <Row onClick={() => setAllUnder((x) => !x)} title={<span className="text-accent">{allUnder ? "Show Fewer" : `Show All ${under.length}`}</span>} /> : null}
          </Group>
          <div className="mt-6 hidden lg:block">
            <div className="flex items-end justify-between px-4 pb-1.5">
              <h2 className="text-[13px] font-medium text-label-2">Below Target · {under.length}</h2>
              {under.length > 8 ? (
                <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setAllUnder((x) => !x)}>
                  {allUnder ? "Show Fewer" : `Show All ${under.length}`}
                </button>
              ) : null}
            </div>
            <DataTable
              rows={allUnder ? under : under.slice(0, 8)}
              rowKey={(r) => r.cost.item.id}
              href={(r) => `/items/${r.cost.item.id}`}
              columns={[
                { key: "name", label: "Item", render: (r) => <span className="font-medium">{rowName(r)}</span>, sort: (r) => rowName(r) },
                ...(venueId == null ? [{ key: "venue", label: "Venue", render: (r: UnderRow) => <span className="text-label-2">{venueShort(store, r)}</span>, sort: (r: UnderRow) => venueShort(store, r) }] : []),
                { key: "gp", label: "GP", align: "right", render: (r) => <span className="font-semibold text-danger">{gp(r.cost.gpPct)}</span>, sort: (r) => r.cost.gpPct },
                { key: "target", label: "Target", align: "right", render: (r) => <span className="text-label-2">{gp(r.cost.targetGp, 0)}</span>, sort: (r) => r.cost.targetGp },
                { key: "now", label: "Price Now", align: "right", render: (r) => money(r.cost.sellInc), sort: (r) => r.cost.sellInc },
                { key: "fix", label: "Fix", align: "right", render: (r) => <SetPriceButton c={r.cost} />, sort: (r) => r.cost.suggestedInc },
              ]}
            />
            <p className="px-4 pt-1.5 text-[13px] text-label-2">Set applies the suggested price (rounded up to the target GP). You can undo it.</p>
          </div>
        </>
      ) : null}

      {/* price checks */}
      {stale.length || gaps.length ? (
        <Group title="Price Checks" className="mt-6" inset="3.75rem">
          {gaps.length ? (
            <Row
              href="/ingredients?filter=catalogue"
              leading={
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Store className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </span>
              }
              title={`${gaps.length} ${gaps.length === 1 ? "price differs" : "prices differ"} from the supplier catalogue`}
              sub={`${gaps[0].ingredient.name}: catalogue ${gaps[0].diffPct > 0 ? "+" : ""}${Math.round(gaps[0].diffPct * 100)}%`}
              chevron
            />
          ) : null}
          {stale.length ? (
            <Row
              href="/ingredients?filter=stale"
              leading={
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fill-2 text-label-2">
                  <Clock className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </span>
              }
              title={`${stale.length} ${stale.length === 1 ? "ingredient hasn’t" : "ingredients haven’t"} been checked in 90 days`}
              sub="Only ones used in recipes. Update from your next invoice."
              chevron
            />
          ) : null}
        </Group>
      ) : null}
    </section>
  );
}

function venueShort(store: ReturnType<typeof useStore>, r: UnderRow): string {
  const v = store.venueById.get(r.cost.item.venue_id);
  return VENUE_SHORT[v?.slug ?? ""] ?? v?.name ?? "";
}

function UnderRowView({ r, showVenue }: { r: UnderRow; showVenue: boolean }) {
  const store = useStore();
  return (
    <div className="flex min-h-[60px] items-center gap-2 pr-3">
      <Link href={`/items/${r.cost.item.id}`} className="min-w-0 flex-1 py-2.5 pl-4 transition-colors active:bg-fill">
        <span className="block truncate text-[17px] leading-snug sm:text-[15px]">{rowName(r)}</span>
        <span className="mt-0.5 block truncate text-[15px] leading-snug text-label-2 tnum sm:text-[13px]">
          {showVenue ? `${venueShort(store, r)} · ` : ""}
          <span className="text-danger">{gp(r.cost.gpPct)}</span> vs {gp(r.cost.targetGp, 0)} · now {money(r.cost.sellInc)}
        </span>
      </Link>
      <SetPriceButton c={r.cost} />
    </div>
  );
}

/** How an under-target row reads in a short list: gelato serves by serve name and worst flavour. */
function rowName(r: UnderRow): string {
  const v = parseVirtualItemId(r.cost.item.id);
  if (!v) return r.cost.item.name;
  return `${r.cost.item.section} (${r.cost.item.name.split(" - ")[0]}${r.flavours > 1 ? ` +${r.flavours - 1}` : ""})`;
}

function VenueCard({ v, s, under, onOpen, onAdd }: { v: Venue; s: GpSummary; under: UnderRow[]; onOpen: () => void; onAdd: () => void }) {
  const gelato = v.slug === "gelato";
  return (
    <div className={cx(`v-${v.slug}`, "relative flex flex-col overflow-hidden rounded-2xl bg-surface")}>
      <button type="button" onClick={onOpen} aria-label={`${v.name}: open`} className="block w-full px-4 pb-3 pt-5 text-left transition duration-200 hover:bg-surface-2 active:scale-[0.99]">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-accent-fill" />
        <span className="flex h-[52px] items-center">
          <VenueLogo slug={v.slug} height={40} />
        </span>
        <span className="sr-only">{VENUE_SHORT[v.slug] ?? v.name}</span>
        {s.count ? (
          <>
            <span className="display mt-3 block text-[46px] tnum text-accent">{gp(s.avg)}</span>
            {!gelato ? <Split s={s} className="mt-0.5 text-[13px] leading-snug" /> : <span className="mt-0.5 block text-[13px] text-label-2">{s.count} priced serves</span>}
          </>
        ) : (
          <>
            <span className="display mt-3 block text-[46px] text-label-3">—</span>
            <span className="mt-0.5 block text-[13px] text-label-2">No recipes yet</span>
          </>
        )}
      </button>
      {s.count ? (
        <div className="mt-auto px-4 pb-4 pt-1">
          <div className="border-t-[0.5px] border-sep pt-3">
            {under.length ? (
              <>
                <p className="text-[12px] font-medium text-label-2">
                  {under.length} below target
                </p>
                <ul className="mt-1.5 space-y-1">
                  {under.slice(0, 3).map((r) => (
                    <li key={r.cost.item.id}>
                      <Link href={`/items/${r.cost.item.id}`} className="flex items-baseline gap-2 text-[13px] leading-snug hover:underline">
                        <span className="min-w-0 flex-1 truncate text-label">{rowName(r)}</span>
                        <span className="shrink-0 tnum text-danger">{gp(r.cost.gpPct, 0)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-[13px] text-label-2">
                <Dot className="bg-[color:var(--good)]" /> All on target
              </p>
            )}
          </div>
        </div>
      ) : null}
      {!s.count ? (
        <button type="button" onClick={onAdd} aria-label={`Add recipe to ${v.name}`} className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent transition active:scale-95">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}
