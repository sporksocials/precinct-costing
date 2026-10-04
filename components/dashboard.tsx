"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, TrendingDown } from "lucide-react";
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

/** Counts a number up from where it last was (first paint from ~85%), eased; static under reduced motion. */
function useCountUp(target: number | null, ms = 900): number | null {
  const [v, setV] = useState<number | null>(target);
  const from = useRef<number | null>(null);
  useEffect(() => {
    if (target == null) return setV(null);
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = from.current ?? target * 0.85;
    from.current = target;
    if (reduce || start === target) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(start + (target - start) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** True one frame after mount, so a bar can slide from empty to where it sits. */
function useSlideIn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

/** The slider scale: 40% to 90% GP, the same for every bar so venues compare at a glance. */
const SCALE_MIN = 0.4;
const SCALE_MAX = 0.9;
const pos = (v: number) => Math.max(0, Math.min(1, (v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));

/**
 * Where a GP sits against the target: a track, a fill that slides out to the value (green at or over target, red under),
 * a knob at the end of the fill and a tick on the target. The word beside it says the same thing, so colour is never alone.
 */
function Slider({ value, target, label, big, delay = 0 }: { value: number | null; target: number; label: string; big?: boolean; delay?: number }) {
  const on = useSlideIn();
  const good = value != null && value >= target - 1e-9;
  const w = value == null ? 0 : pos(value) * 100;
  return (
    <span role="img" aria-label={label} className={cx("relative block w-full rounded-full bg-fill-2", big ? "h-3" : "h-2")}>
      <span
        className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-[900ms] ease-out motion-reduce:transition-none", good ? "bg-good" : "bg-danger")}
        style={{ width: on ? `${w}%` : "0%", transitionDelay: `${delay}ms`, boxShadow: value == null ? undefined : good ? "0 0 14px var(--good-soft)" : "0 0 14px var(--danger-soft)" }}
      />
      {value == null ? null : (
        <span
          aria-hidden
          className={cx("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--surface)] transition-[left] duration-[900ms] ease-out motion-reduce:transition-none", big ? "h-5 w-5" : "h-3.5 w-3.5", good ? "bg-good" : "bg-danger")}
          style={{ left: on ? `${w}%` : "0%", transitionDelay: `${delay}ms` }}
        />
      )}
      <span aria-hidden className={cx("absolute w-[2px] rounded-full bg-label", big ? "-inset-y-1.5" : "-inset-y-1")} style={{ left: `calc(${pos(target) * 100}% - 1px)` }} />
    </span>
  );
}

const CARD_DEPTH = "shadow-[0_14px_34px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.06)]";
/** "5 points under the 72% target", "On target", "2 points over the 72% target". Words, no colour. */
function gapLine(avg: number, target: number): string {
  const pts = Math.round((avg - target) * 100);
  if (pts === 0) return `On the ${gp(target, 0)} target`;
  const n = Math.abs(pts);
  return `${n} ${n === 1 ? "point" : "points"} ${pts < 0 ? "under" : "over"} the ${gp(target, 0)} target`;
}

/**
 * Home: always all venues, no venue buttons. A hero Average GP (green at or over target, red under, with a glow and a count-up),
 * a slider under each venue showing where it sits against the target (the fill slides out on load), the top few things that
 * need attention with a View All button, and two quiet links. Only two colours carry meaning, green and red, and every one is
 * backed by a word and an icon. The complete alert feed (with Ignore) lives on /alerts.
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
  const shownAvg = useCountUp(headline.avg);
  const good = !empty && (headline.avg ?? 0) >= target - 1e-9;
  // the venue that is under target but closest to it: a goal to point at
  const closest = useMemo(() => {
    const under = venueRows.filter((r) => r.avg != null && r.avg < r.target - 1e-9).sort((a, b) => b.avg! - b.target - (a.avg! - a.target));
    return under[0] ?? null;
  }, [venueRows]);
  const allOver = venueRows.some((r) => r.avg != null) && venueRows.every((r) => r.avg == null || r.avg >= r.target - 1e-9);

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
        {/* 1. the one number: green at or over target, red under, with a glow of the same colour */}
        <section
          className={cx("relative overflow-hidden rounded-3xl px-5 pb-6 pt-5 lg:px-8 lg:pb-8 lg:pt-7", CARD_DEPTH)}
          style={{
            background: empty
              ? "var(--surface)"
              : `radial-gradient(120% 100% at 0% 0%, ${good ? "var(--good-soft)" : "var(--danger-soft)"}, transparent 62%), linear-gradient(180deg, var(--surface-2), var(--surface))`,
          }}
          aria-label="Average GP"
        >
          <p className="eyebrow text-[12px] text-label-2">{formatToday(store.today)}</p>
          <p className="mt-4 text-[15px] text-label-2">Average GP</p>
          {empty ? (
            <p className="display text-[72px] leading-none text-label-3">No GP Yet</p>
          ) : (
            <>
              <p
                className={cx("display text-[96px] leading-none tnum lg:text-[120px]", good ? "text-good" : "text-danger")}
                style={{ textShadow: good ? "0 0 36px var(--good-soft)" : "0 0 36px var(--danger-soft)" }}
                aria-label={gp(headline.avg, 1, target)}
              >
                {gp(shownAvg, 0, target)}
              </p>
              <p className={cx("mt-2 flex items-center gap-1.5 whitespace-nowrap text-[19px] font-semibold sm:text-[16px]", good ? "text-good" : "text-danger")}>
                {good ? <Check aria-hidden className="h-[18px] w-[18px]" strokeWidth={3} /> : <TrendingDown aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.75} />}
                {good ? "On Target" : "Below Target"}
              </p>
              <p className="mt-0.5 text-[17px] text-label-2 sm:text-[15px]">{gapLine(headline.avg ?? 0, target)}</p>
              <div className="mt-6">
                <Slider value={headline.avg} target={target} big label={`Average GP ${gp(headline.avg, 0, target)} against a ${gp(target, 0)} target`} />
                <p className="mt-2 flex justify-between text-[13px] text-label-2 tnum">
                  <span>{gp(SCALE_MIN, 0)}</span>
                  <span>Target {gp(target, 0)}</span>
                  <span>{gp(SCALE_MAX, 0)}</span>
                </p>
              </div>
              {allOver ? (
                <p className="mt-4 rounded-xl bg-good-soft px-3 py-2 text-[15px] font-semibold text-good sm:text-[13px]">Every venue is on target. Nice work.</p>
              ) : closest ? (
                <p className="mt-4 text-[15px] text-label-2 sm:text-[13px]">
                  Closest to target: <span className="font-semibold text-label">{VENUE_SHORT[closest.venue.slug] ?? closest.venue.name}</span>, {Math.max(1, Math.round((closest.target - (closest.avg ?? 0)) * 100))} {Math.round((closest.target - (closest.avg ?? 0)) * 100) <= 1 ? "point" : "points"} to go.
                </p>
              ) : null}
            </>
          )}
        </section>

        {/* 2. venues: where each one sits against the target; a tap opens that venue's menu */}
        <section aria-labelledby="home-venues">
          <h2 id="home-venues" className="px-1 pb-2 text-[22px] font-bold tracking-tight">
            Venues
          </h2>
          <div className={cx("group-list anim-stagger", CARD_DEPTH)}>
            {venueRows.map((r, i) => {
              const ok = r.avg != null && r.avg >= r.target - 1e-9;
              const name = VENUE_SHORT[r.venue.slug] ?? r.venue.name;
              return (
                <Link
                  key={r.venue.id}
                  href={`/menu?venue=${r.venue.slug}`}
                  aria-label={r.avg == null ? `${name}: no GP yet. Open the menu` : `${name}: average GP ${gp(r.avg, 0, r.target)}, ${ok ? "on target" : "below target"}${r.under ? `, ${r.under} below target` : ""}. Open the menu`}
                  className="block min-h-[64px] px-4 py-3 transition-colors hover:bg-fill active:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--label)]"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[17px] font-semibold leading-snug sm:text-[15px]">{name}</span>
                      <span className="block text-[15px] leading-snug text-label-2 sm:text-[13px]">{r.avg == null ? "No GP yet" : r.under ? `${r.under} below target` : "All on target"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {r.avg == null ? null : ok ? <Check aria-hidden className="h-4 w-4 text-good" strokeWidth={3} /> : <TrendingDown aria-hidden className="h-4 w-4 text-danger" strokeWidth={2.75} />}
                      <span className={cx("display text-[30px] leading-none tnum sm:text-[26px]", r.avg == null ? "text-label-3" : ok ? "text-good" : "text-danger")}>{r.avg == null ? "–" : gp(r.avg, 0, r.target)}</span>
                      <ChevronRight aria-hidden className="-mr-1 h-[18px] w-[18px] text-label-3" strokeWidth={2.5} />
                    </span>
                  </span>
                  <span className="mt-3 block">
                    <Slider value={r.avg} target={r.target} delay={150 + i * 90} label={r.avg == null ? "No GP yet" : `Average GP ${gp(r.avg, 0, r.target)} against a ${gp(r.target, 0)} target`} />
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="px-4 pt-1.5 text-[13px] text-label-2">The line on each slider is the target.</p>
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
              <Row title={<span className="text-good">All Clear</span>} sub="Every dish is on target and prices are up to date." wrapSub />
            </Group>
          ) : (
            <Group className="!mt-0">
              {ranked.map((it, i) => {
                const vis = attentionVisibility(i);
                if (vis === "none") return null;
                return (
                  <div key={it.key} className={vis === "wide" ? "hidden md:block" : undefined}>
                    <Row href={it.href} title={it.title} sub={it.sub} wrapSub trailing={it.trailing ? <span className={cx("text-[15px] font-semibold sm:text-[13px]", it.trailing.tone === "danger" ? "text-danger" : "text-label-2")}>{it.trailing.text}</span> : undefined} chevron />
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
