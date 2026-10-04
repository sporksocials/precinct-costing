"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { checkCostGroups, checkCostRows, gpSummary } from "@/lib/insights";
import { gp } from "@/lib/format";
import { ignoredCheckItemIds } from "@/lib/ignored-alerts";
import { alertTotals, attentionVisibility, gpTarget, rankAttention, specialsSummary, venueGpRows, viewAllState } from "@/lib/dashboard";
import { useNewRecipe } from "@/components/new-recipe";
import { VENUE_SHORT } from "@/components/venue";
import { cx, Group, Row } from "@/components/ui";
import { useRefreshIgnored } from "@/components/alert-parts";
import { formatToday, useOpenAlerts } from "@/components/today-feed";
import { useDataHealthSummary } from "@/lib/use-data-health";

/** "5 points under the 72% target", "On target", "2 points over the 72% target". Words, no colour. */
function gapLine(avg: number, target: number): string {
  const pts = Math.round((avg - target) * 100);
  if (pts === 0) return `On the ${gp(target, 0)} target`;
  const n = Math.abs(pts);
  return `${n} ${n === 1 ? "point" : "points"} ${pts < 0 ? "under" : "over"} the ${gp(target, 0)} target`;
}

/**
 * Home: one calm screen, always all venues. The average GP, a plain list of venues (tap one to open its menu), the top
 * few things that need attention with a View All button, and two quiet links (Specials, Data Health). No venue buttons,
 * no tiles, no bars, no coloured badges: words carry the meaning and the sand accent marks what you can tap.
 * The complete alert feed (with Ignore) lives on /alerts.
 */
export function Dashboard() {
  const store = useStore();
  const newRecipe = useNewRecipe();
  const health = useDataHealthSummary();
  useRefreshIgnored();
  const open = useOpenAlerts(null);
  const { ignoredKeys } = open;

  // an ignored "check cost" alert still keeps its dish out of the average, but no longer counts as needing a look
  const headline = useMemo(() => {
    const skip = ignoredCheckItemIds(checkCostGroups(checkCostRows(store.itemCosts.values(), null)), ignoredKeys);
    return gpSummary(store.itemCosts.values(), null, skip);
  }, [store.itemCosts, ignoredKeys]);
  const target = useMemo(() => gpTarget(store.itemCosts.values(), null), [store.itemCosts]);
  const empty = headline.count === 0;

  const totals = useMemo(() => alertTotals(open), [open]);
  const ranked = useMemo(
    () => rankAttention(open, { venueName: (id) => VENUE_SHORT[store.venueById.get(id)?.slug ?? ""] ?? store.venueById.get(id)?.name ?? "", showVenue: true }),
    [open, store.venueById],
  );
  const specials = useMemo(() => specialsSummary(store.offers, store.offerCosts, null, ignoredKeys), [store.offers, store.offerCosts, ignoredKeys]);
  const venueRows = useMemo(() => venueGpRows(store.itemCosts.values(), store.venues, open.under), [store.itemCosts, store.venues, open.under]);
  const ignoredCount = store.ignoredAlerts.length;

  if (empty && totals.total === 0 && !specials.live) {
    return (
      <section className="rounded-3xl bg-surface px-5 py-6 lg:px-8">
        <p className="eyebrow text-[12px] text-label-2">{formatToday(store.today)}</p>
        <p className="mt-3 text-[20px] font-semibold tracking-tight">Add a recipe to start tracking GP.</p>
        <button type="button" className="btn-tinted mt-4" onClick={() => newRecipe.open({ venueId: null })}>
          Add First Recipe
        </button>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-6">
        {/* 1. the one number */}
        <section className="rounded-3xl bg-surface px-5 pb-6 pt-5 lg:px-8 lg:pb-8 lg:pt-7" aria-label="Average GP">
          <p className="eyebrow text-[12px] text-label-2">{formatToday(store.today)}</p>
          <p className="mt-4 text-[15px] text-label-2">Average GP</p>
          {empty ? (
            <p className="display text-[72px] leading-none text-label-3">No GP Yet</p>
          ) : (
            <>
              <p className="display text-[88px] leading-none tnum text-label lg:text-[104px]" aria-label={gp(headline.avg, 1, target)}>
                {gp(headline.avg, 0, target)}
              </p>
              <p className="mt-2 text-[17px] text-label-2 sm:text-[15px]">{gapLine(headline.avg ?? 0, target)}</p>
            </>
          )}
        </section>

        {/* 2. venues: a plain list, a tap opens that venue's menu */}
        <section aria-labelledby="home-venues">
          <h2 id="home-venues" className="px-1 pb-2 text-[22px] font-bold tracking-tight">
            Venues
          </h2>
          <Group className="!mt-0">
            {venueRows.map((r) => (
              <Row
                key={r.venue.id}
                href={`/menu?venue=${r.venue.slug}`}
                title={VENUE_SHORT[r.venue.slug] ?? r.venue.name}
                sub={r.avg == null ? "No GP yet" : r.under ? `${r.under} below target` : "All on target"}
                trailing={r.avg == null ? "" : <span className="font-semibold text-label">{gp(r.avg, 0, r.target)}</span>}
                chevron
              />
            ))}
          </Group>
        </section>
      </div>

      <div className="space-y-6">
        {/* 3. what needs attention: the top few, then everything else one tap away */}
        <section aria-labelledby="needs-attention">
          <h2 id="needs-attention" className="px-1 pb-2 text-[22px] font-bold tracking-tight">
            Needs Attention{totals.total ? <span className="tnum text-label-2"> · {totals.total}</span> : null}
          </h2>
          {totals.total === 0 ? (
            <Group className="!mt-0">
              <Row title="All Clear" sub="Every dish is on target and prices are up to date." wrapSub />
            </Group>
          ) : (
            <Group className="!mt-0">
              {ranked.map((it, i) => {
                const vis = attentionVisibility(i);
                if (vis === "none") return null;
                return (
                  <div key={it.key} className={vis === "wide" ? "hidden md:block" : undefined}>
                    <Row href={it.href} title={it.title} sub={it.sub} wrapSub trailing={it.trailing ? <span className="text-[15px] sm:text-[13px]">{it.trailing.text}</span> : undefined} chevron />
                  </div>
                );
              })}
              {viewAllState(totals.total).show ? (
                <div className={cx(viewAllState(totals.total).hideWide && "md:hidden")}>
                  <Row href="/alerts" title={<span className="font-semibold text-accent">View All {totals.total}</span>} chevron />
                </div>
              ) : null}
            </Group>
          )}
        </section>

        {/* 4. two quiet links */}
        <Group>
          <Row
            href={`/specials${specials.live ? "?status=live" : ""}`}
            title="Specials"
            sub={specials.live ? `${specials.live} live${specials.below ? `, ${specials.below} below target` : ""}` : "None live"}
            chevron
          />
          <Row
            href="/data-health"
            title="Data Health"
            sub={health.ready && health.attention > 0 ? `${health.attention} ${health.attention === 1 ? "check needs" : "checks need"} attention` : "Nothing to check"}
            chevron
          />
          {ignoredCount ? <Row href="/alerts?alerts=ignored" title="Ignored Alerts" sub={`${ignoredCount} set aside`} chevron /> : null}
        </Group>
      </div>
    </div>
  );
}
