"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, Plus, Store, Tag, TrendingUp } from "lucide-react";
import { useStore } from "@/lib/store";
import { catalogueGaps, dealFeedRows, checkCostGroups, checkCostRows, gpSummary, happyHourRows, ingredientsInUse, priceIncreases, staleIngredients, underTarget, underTargetRows, type GpSummary, type UnderRow } from "@/lib/insights";
import { costBreakdown, type ItemCost } from "@/lib/costing";
import { buildReviewChanges, gelatoServeStats } from "@/lib/price-review";
import { parseVirtualItemId } from "@/lib/gelato";
import Link from "next/link";
import { gp, money, movePct } from "@/lib/format";
import { DataTable } from "@/components/table";
import { PriceSheet, SetPriceButton } from "@/components/price-actions";
import { ReviewSheet } from "@/components/price-review";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, VenueFilter, VENUE_SHORT } from "@/components/venue";
import { cx, Dot, Group, Row } from "@/components/ui";
import { PrecinctMark } from "@/components/brand";
import { OffersFeed } from "@/components/offers-feed";
import { DealsFeed } from "@/components/deals-feed";
import { brisbaneToday } from "@/lib/deals";
import { liveOffersUnderTarget } from "@/lib/offers";

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
  const { venue } = useVenue();
  const newRecipe = useNewRecipe();

  const headline = useMemo(() => gpSummary(store.itemCosts.values(), venue?.id ?? null), [store.itemCosts, venue]);

  const shownAvg = useCountUp(headline.avg);
  const isGelato = venue?.slug === "gelato";
  const empty = headline.count === 0;

  return (
    <div>
      <header className="pb-4 pt-3 lg:pt-8">
        <h1 className="sr-only">{venue ? venue.name : "Caloundra Food Precinct costing"}</h1>
        <PrecinctMark size="md" sub="Costing" className="lg:hidden" />
        <p aria-hidden className="display hidden text-[44px] text-label lg:block">{venue ? venue.name : "All Venues"}</p>
      </header>

      <VenueFilter className="mb-4" />

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
        {headline.excluded > 0 ? (
          <button
            type="button"
            onClick={() => document.getElementById("check-cost")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-warn-soft px-4 text-[15px] font-medium text-warn transition active:scale-[0.97] lg:min-h-[36px] lg:text-[14px]"
          >
            <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
            {headline.excluded} need checking
            <span className="font-normal text-label-2">· not in this average</span>
          </button>
        ) : null}
      </section>

      {/* 3. today: what needs doing, with the fix one tap away */}
      {empty && !headline.excluded ? null : <Today venueId={venue?.id ?? null} />}
    </div>
  );
}

function Today({ venueId }: { venueId: number | null }) {
  const store = useStore();
  const [allUnder, setAllUnder] = useState(false);
  const [allRises, setAllRises] = useState(false);
  const [allCheck, setAllCheck] = useState(false);
  const [allHappy, setAllHappy] = useState(false);
  const [priceFor, setPriceFor] = useState<ItemCost | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    store.loadPortalPrices();
  }, [store]);

  const under = useMemo(() => underTargetRows(store.itemCosts.values(), venueId), [store.itemCosts, venueId]);
  const changes = useMemo(
    () => buildReviewChanges(underTarget(store.itemCosts.values(), venueId), store.settings.gst_rate, gelatoServeStats(store.itemCosts.values())),
    [store.itemCosts, venueId, store.settings.gst_rate],
  );
  const check = useMemo(() => checkCostGroups(checkCostRows(store.itemCosts.values(), venueId)), [store.itemCosts, venueId]);
  const happy = useMemo(() => happyHourRows(store.itemCosts.values(), venueId), [store.itemCosts, venueId]);
  const itemById = useMemo(() => new Map(store.items.map((i) => [i.id, i])), [store.items]);
  const rises = useMemo(
    () => priceIncreases(store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venueId, 30, store.itemCosts),
    [store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venueId, store.itemCosts],
  );
  const inUse = useMemo(() => ingredientsInUse(store.allLines), [store.allLines]);
  const stale = useMemo(() => staleIngredients(store.ingredients, inUse), [store.ingredients, inUse]);
  const gaps = useMemo(() => catalogueGaps(store.ingredients, store.portalPrices, store.settings.gst_rate), [store.ingredients, store.portalPrices, store.settings.gst_rate]);
  const dealRows = useMemo(() => dealFeedRows(store.deals, store.ingredients, inUse, brisbaneToday()), [store.deals, store.ingredients, inUse]);

  const offersBelow = useMemo(() => liveOffersUnderTarget(store.offers, store.offerCosts, venueId), [store.offers, store.offerCosts, venueId]);
  const today = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Brisbane" });
  const clear = !offersBelow.length && !under.length && !rises.length && !stale.length && !gaps.length && !check.length && !happy.length && !dealRows.length;
  const shownUnder = allUnder ? under : under.slice(0, 5);
  const shownRises = allRises ? rises : rises.slice(0, 3);
  const shownCheck = allCheck ? check : check.slice(0, 4);
  const shownHappy = allHappy ? happy : happy.slice(0, 4);
  const reviewButton =
    changes.length >= 2 ? (
      <button type="button" onClick={() => setReviewing(true)} className="-mb-1 min-h-[44px] px-1 text-[15px] font-semibold text-accent lg:min-h-[32px] lg:text-[13px]">
        Review &amp; Apply
      </button>
    ) : null;

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

      <OffersFeed rows={offersBelow} showVenue={venueId == null} />
      <DealsFeed rows={dealRows} />

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

      {/* costs that look wrong: fix these before trusting any price */}
      {check.length ? (
        <div id="check-cost" className="scroll-mt-4">
          <Group title={`Check Cost · ${check.length}`} className="mt-6" inset="3.75rem" footer="These are left out of the average GP until the cost looks right.">
            {shownCheck.map((g) => (
              <Row
                key={g.id}
                href={g.href}
                leading={
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warn-soft text-warn">
                    <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={2.25} />
                  </span>
                }
                title={g.name}
                wrapSub
                sub={`${venueName(store, g.venueId)} · ${g.warnings[0] ?? "Check the recipe"}${g.warnings.length > 1 ? ` (+${g.warnings.length - 1} more)` : ""}`}
                chevron
              />
            ))}
            {check.length > 4 ? <Row onClick={() => setAllCheck((x) => !x)} title={<span className="text-accent">{allCheck ? "Show Fewer" : `Show All ${check.length}`}</span>} /> : null}
          </Group>
        </div>
      ) : null}

      {/* below target, with the fix on the row */}
      {under.length ? (
        <>
          <Group
            title={`Below Target · ${under.length}`}
            className="mt-6 lg:hidden"
            trailing={reviewButton}
            footer="Set applies the suggested price (rounded up to the target GP). Change lets you pick another. You can undo either."
          >
            {shownUnder.map((r) => (
              <UnderRowView key={r.cost.item.id} r={r} showVenue={venueId == null} onPrice={() => setPriceFor(r.cost)} />
            ))}
            {under.length > 5 ? <Row onClick={() => setAllUnder((x) => !x)} title={<span className="text-accent">{allUnder ? "Show Fewer" : `Show All ${under.length}`}</span>} /> : null}
          </Group>
          <div className="mt-6 hidden lg:block">
            <div className="flex items-end justify-between px-4 pb-1.5">
              <h2 className="text-[13px] font-medium text-label-2">Below Target · {under.length}</h2>
              <span className="flex items-center gap-4">
                {reviewButton}
                {under.length > 8 ? (
                  <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setAllUnder((x) => !x)}>
                    {allUnder ? "Show Fewer" : `Show All ${under.length}`}
                  </button>
                ) : null}
              </span>
            </div>
            <DataTable
              rows={allUnder ? under : under.slice(0, 8)}
              rowKey={(r) => r.cost.item.id}
              href={(r) => `/items/${r.cost.item.id}`}
              columns={[
                { key: "name", label: "Item", render: (r) => <span className="font-medium">{rowName(r)}</span>, sort: (r) => rowName(r) },
                ...(venueId == null ? [{ key: "venue", label: "Venue", render: (r: UnderRow) => <span className="text-label-2">{venueShort(store, r)}</span>, sort: (r: UnderRow) => venueShort(store, r) }] : []),
                { key: "gp", label: "GP / Target", align: "right", render: (r) => <span><span className="font-semibold text-danger">{gp(r.cost.gpPct)}</span> <span className="text-label-2">/ {gp(r.cost.targetGp, 0)}</span></span>, sort: (r) => r.cost.gpPct },
                { key: "driver", label: "Biggest Cost", render: (r) => <span className="block max-w-[9rem] truncate text-label-2 xl:max-w-[16rem]" title={driverText(r.cost) ?? undefined}>{driverText(r.cost) ?? (parseVirtualItemId(r.cost.item.id) ? "Shared by all flavours" : "—")}</span> },
                {
                  key: "now",
                  label: "Price Now",
                  align: "right",
                  render: (r) => (
                    <button
                      type="button"
                      title="Pick a different price"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPriceFor(r.cost);
                      }}
                      className="rounded-md px-1.5 py-0.5 tnum text-accent underline decoration-dotted underline-offset-4 hover:bg-fill"
                    >
                      {money(r.cost.sellInc)}
                    </button>
                  ),
                  sort: (r) => r.cost.sellInc,
                },
                { key: "fix", label: "Fix", align: "right", render: (r) => <SetPriceButton c={r.cost} />, sort: (r) => r.cost.suggestedInc },
              ]}
            />
            <p className="px-4 pt-1.5 text-[13px] text-label-2">Set applies the suggested price (rounded up to the target GP). Tap a price to pick another. You can undo either.</p>
          </div>
        </>
      ) : null}

      {/* happy hour prices under the same target */}
      {happy.length ? (
        <Group title={`Happy Hour · ${happy.length}`} className="mt-6" inset="3.75rem" footer="Happy hour prices are held to the same target GP as the normal price.">
          {shownHappy.map((h) => (
            <Row
              key={h.cost.item.id}
              href={`/items/${h.cost.item.id}`}
              leading={
                <span className={cx("flex h-9 w-9 items-center justify-center rounded-full", h.belowCost ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>
                  <Tag className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </span>
              }
              title={h.cost.item.name}
              wrapSub
              sub={`${venueName(store, h.cost.item.venue_id)} · ${money(h.hhPrice)} · ${h.belowCost ? `below cost (${money(h.cost.costPerPortion)})` : `${gp(h.hhGpPct, 0)} vs ${gp(h.cost.targetGp, 0)} target`}`}
              trailing={<span className={cx("font-semibold", h.belowCost ? "text-danger" : "text-warn")}>{gp(h.hhGpPct, 0)}</span>}
              chevron
            />
          ))}
          {happy.length > 4 ? <Row onClick={() => setAllHappy((x) => !x)} title={<span className="text-accent">{allHappy ? "Show Fewer" : `Show All ${happy.length}`}</span>} /> : null}
        </Group>
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

      {priceFor ? <PriceSheet key={priceFor.item.id} c={priceFor} onClose={() => setPriceFor(null)} /> : null}
      {reviewing ? <ReviewSheet changes={changes} onClose={() => setReviewing(false)} /> : null}
    </section>
  );
}

function venueName(store: ReturnType<typeof useStore>, venueId: number): string {
  const v = store.venueById.get(venueId);
  return VENUE_SHORT[v?.slug ?? ""] ?? v?.name ?? "";
}

function venueShort(store: ReturnType<typeof useStore>, r: UnderRow): string {
  return venueName(store, r.cost.item.venue_id);
}

/** "Beef $4.10 (48%)": the ingredient or prep that costs the most per portion (null when there is none). */
function driverText(c: ItemCost): string | null {
  if (parseVirtualItemId(c.item.id)) return null; // a gelato serve's cost is the mix; the row explains it instead
  const d = costBreakdown(c, 1)[0];
  return d ? `${d.name} ${money(d.cost)} (${Math.round(d.pct * 100)}%)` : null;
}

function UnderRowView({ r, showVenue, onPrice }: { r: UnderRow; showVenue: boolean; onPrice: () => void }) {
  const store = useStore();
  const c = r.cost;
  const driver = driverText(c);
  const shared = parseVirtualItemId(c.item.id);
  return (
    <div className="px-4 py-3">
      <Link href={`/items/${c.item.id}`} className="block min-w-0 transition-opacity active:opacity-60">
        <span className="block truncate text-[17px] leading-snug sm:text-[15px]">{rowName(r)}</span>
        <span className="mt-0.5 block truncate text-[15px] leading-snug text-label-2 tnum sm:text-[13px]">
          {showVenue ? `${venueShort(store, r)} · ` : ""}
          <span className="text-danger">{gp(c.gpPct)}</span> vs {gp(c.targetGp, 0)}
        </span>
        {shared ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-label-2">Applies to all flavours. Suggested from the dearest, {c.item.name.split(" - ")[0]}.</span>
        ) : driver ? (
          <span className="mt-0.5 block truncate text-[13px] leading-snug text-label-2 tnum">Biggest cost: {driver}</span>
        ) : null}
      </Link>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onPrice}
          aria-label={`Change price for ${rowName(r)}, now ${money(c.sellInc)}`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-fill px-3 text-[15px] font-medium tnum text-label transition active:scale-[0.97]"
        >
          Now {money(c.sellInc)} <span className="text-accent">· Change</span>
        </button>
        <SetPriceButton c={c} className="flex-1 justify-center" />
      </div>
    </div>
  );
}

/** How an under-target row reads in a short list: gelato serves by serve name and worst flavour. */
function rowName(r: UnderRow): string {
  const v = parseVirtualItemId(r.cost.item.id);
  if (!v) return r.cost.item.name;
  return `${r.cost.item.section} (${r.cost.item.name.split(" - ")[0]}${r.flavours > 1 ? ` +${r.flavours - 1}` : ""})`;
}
