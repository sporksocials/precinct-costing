"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDollarSign, Clock, Minus, Plus, Store, Tag, TrendingDown, TrendingUp, CalendarClock, CalendarX, type LucideIcon } from "lucide-react";
import { useStore } from "@/lib/store";
import { checkCostGroups, checkCostRows, gpSummary } from "@/lib/insights";
import { gp } from "@/lib/format";
import { ignoredCheckItemIds } from "@/lib/ignored-alerts";
import {
  alertTotals,
  attentionVisibility,
  formatPts,
  gpStatus,
  gpTarget,
  priceAlertsAnchor,
  rankAttention,
  specialsSummary,
  specialStatusWord,
  summarySentence,
  venueGpRows,
  viewAllState,
  type AttentionIcon,
  type AttentionTone,
  type GpLevel,
} from "@/lib/dashboard";
import { offerKindLabel } from "@/lib/offers";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, venueQuery, VENUE_SHORT } from "@/components/venue";
import { cx } from "@/components/ui";
import { AlertRow, useRefreshIgnored } from "@/components/alert-parts";
import { formatToday, useOpenAlerts } from "@/components/today-feed";
import { useDataHealthSummary } from "@/lib/use-data-health";

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

/* ---------------------------------------------------------------- shared bits */

const TONE_TEXT: Record<AttentionTone | GpLevel, string> = {
  danger: "text-danger",
  bad: "text-danger",
  warn: "text-warn",
  good: "text-good",
  accent: "text-accent",
  neutral: "text-label-2",
  none: "text-label-2",
};

const TONE_CHIP: Record<AttentionTone, string> = {
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-fill-2 text-label-2",
  accent: "bg-accent-soft text-accent",
};

/** A status as icon + word + colour. The word and the icon shape carry it; colour only backs them up. */
function StatusLine({ level, word, extra }: { level: GpLevel; word: string; extra?: string | null }) {
  const Icon = level === "good" ? Check : level === "warn" ? AlertTriangle : level === "bad" ? TrendingDown : Minus;
  return (
    <span className={cx("mt-1.5 inline-flex flex-wrap items-center gap-x-1.5 text-[15px] font-semibold leading-tight sm:text-[14px]", TONE_TEXT[level])}>
      <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      {word}
      {extra ? <span className="tnum font-medium">{extra}</span> : null}
    </span>
  );
}

const tileClass =
  "group relative flex min-h-[44px] flex-col rounded-2xl bg-surface p-4 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)]";

function Tile({ href, label, value, children, ariaLabel }: { href: string; label: string; value: React.ReactNode; children: React.ReactNode; ariaLabel: string }) {
  return (
    <Link href={href} aria-label={ariaLabel} className={tileClass}>
      <span className="flex items-start justify-between gap-2">
        <span className="eyebrow text-[12px] text-label-2">{label}</span>
        <ChevronRight aria-hidden className="-mr-1 h-4 w-4 shrink-0 text-label-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:transform-none" strokeWidth={2.5} />
      </span>
      <span aria-hidden className="display mt-1 block text-[56px] leading-none tnum text-label lg:text-[64px]">
        {value}
      </span>
      {children}
    </Link>
  );
}

/** A thin horizontal bar: the average against a target line. Neutral fill, so venue colours never read as status. */
function GpBar({ avg, target, label, className }: { avg: number | null; target: number; label: string; className?: string }) {
  const w = avg == null ? 0 : Math.max(0, Math.min(1, avg));
  return (
    <span role="img" aria-label={label} className={cx("relative mt-3 block h-2 w-full rounded-full bg-fill-2", className)}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-label-2" style={{ width: `${w * 100}%` }} />
      {avg == null ? null : <span aria-hidden className="absolute -inset-y-1 w-[2px] rounded-full bg-label" style={{ left: `calc(${Math.min(1, Math.max(0, target)) * 100}% - 1px)` }} />}
    </span>
  );
}

const ICONS: Record<AttentionIcon, LucideIcon> = {
  below: TrendingDown,
  price: CircleDollarSign,
  rise: TrendingUp,
  check: AlertTriangle,
  clock: Clock,
  store: Store,
  tag: Tag,
  "deal-ending": CalendarClock,
  "deal-expired": CalendarX,
};

/* ---------------------------------------------------------------- the dashboard */

/** Home below the venue tiles: a plain sentence, four KPI tiles, Needs Attention, By Venue and Specials. Colour backs up words and icons, never replaces them. */
export function Dashboard() {
  const store = useStore();
  const { venue, setVenue } = useVenue();
  const newRecipe = useNewRecipe();
  const health = useDataHealthSummary();
  const venueId = venue?.id ?? null;
  const q = venueQuery(venue);
  useRefreshIgnored();
  const open = useOpenAlerts(venueId);
  const { ignoredKeys } = open;

  // an ignored "check cost" alert still keeps its dish out of the average, but no longer counts as needing a look
  const headline = useMemo(() => {
    const skip = ignoredCheckItemIds(checkCostGroups(checkCostRows(store.itemCosts.values(), venueId)), ignoredKeys);
    return gpSummary(store.itemCosts.values(), venueId, skip);
  }, [store.itemCosts, venueId, ignoredKeys]);
  const target = useMemo(() => gpTarget(store.itemCosts.values(), venueId), [store.itemCosts, venueId]);
  const empty = headline.count === 0;
  const isGelato = venue?.slug === "gelato";
  const status = gpStatus(headline.avg, empty ? null : target);
  const shownAvg = useCountUp(headline.avg);

  const totals = useMemo(() => alertTotals(open), [open]);
  const sentence = summarySentence(totals, { gelato: isGelato, hasData: !empty });
  const ranked = useMemo(
    () => rankAttention(open, { venueName: (id) => VENUE_SHORT[store.venueById.get(id)?.slug ?? ""] ?? store.venueById.get(id)?.name ?? "", showVenue: venue == null }),
    [open, store.venueById, venue],
  );
  const specials = useMemo(() => specialsSummary(store.offers, store.offerCosts, venueId, ignoredKeys), [store.offers, store.offerCosts, venueId, ignoredKeys]);
  const venueRows = useMemo(() => (venue ? [] : venueGpRows(store.itemCosts.values(), store.venues, open.under)), [venue, store.itemCosts, store.venues, open.under]);

  const priceAlerts = totals.rises + totals.missing;
  const specialsHref = `/specials${specials.live ? "?status=live" : ""}${venue ? `${specials.live ? "&" : "?"}venue=${venue.slug}` : ""}`;
  const worstGap = open.under[0] ? (open.under[0].cost.gpPct ?? 0) - open.under[0].cost.targetGp : null;
  const checkedAt = useMemo(
    () => new Date(),
    // a fresh "checked" time whenever the data or the ignored list changes
    [store.itemCosts, store.ignoredAlerts, store.offers, store.priceLogs, store.ingredients], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const showAttention = totals.total > 0 || !empty;

  return (
    <div>
      {/* 1. the plain-English headline */}
      <section className="relative overflow-hidden rounded-3xl bg-surface px-5 pb-5 pt-5 lg:px-8 lg:pb-6 lg:pt-7">
        <span aria-hidden className={cx("absolute inset-x-0 top-0 h-1", venue ? "bg-accent-fill" : "precinct-strip")} />
        <p className="eyebrow text-[12px] text-label-2">{formatToday(store.today)}{venue ? "" : " · All Venues"}</p>
        <p className="mt-2.5 flex items-start gap-3 text-[18px] font-semibold leading-snug tracking-tight text-label lg:text-[24px]" aria-live="polite">
          <span aria-hidden className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full lg:mt-1", sentence.tone === "good" ? "bg-good-soft text-good" : sentence.tone === "danger" ? "bg-danger-soft text-danger" : sentence.tone === "warn" ? "bg-warn-soft text-warn" : "bg-fill-2 text-label-2")}>
            {sentence.tone === "good" ? <Check className="h-4 w-4" strokeWidth={3} /> : sentence.tone === "neutral" ? <Minus className="h-4 w-4" strokeWidth={3} /> : <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />}
          </span>
          <span>{sentence.text}</span>
        </p>
      </section>

      {/* 2. four tiles: one number and one status word each, every one a link */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          href={`/menu${q}`}
          label="Average GP"
          value={empty ? <span className="inline-block pt-3 text-[32px] text-label-3">No GP Yet</span> : gp(shownAvg, 0, target)}
          ariaLabel={empty ? "Average GP: no GP yet. Open the menu" : `Average GP ${gp(headline.avg, 1, target)}, target ${gp(target, 0)}, ${status.word}. Open the menu`}
        >
          {empty ? (
            <StatusLine level="none" word="Nothing Priced" />
          ) : (
            <>
              <StatusLine level={status.level} word={status.word} extra={status.gapText} />
              <GpBar avg={headline.avg} target={target} label={`Average GP ${gp(headline.avg, 0, target)} against a ${gp(target, 0)} target`} />
              <span className="mt-2 block text-[13px] leading-snug tnum text-label-2">
                {isGelato ? `${headline.count} priced serves` : [headline.food != null ? `Food ${gp(headline.food, 0)}` : null, headline.drinks != null ? `Drinks ${gp(headline.drinks, 0)}` : null].filter(Boolean).join(" · ")}
              </span>
              <span className="block text-[13px] leading-snug tnum text-label-2">Target {gp(target, 0)}</span>
            </>
          )}
        </Tile>

        <Tile
          href={`/alerts${q}${totals.under ? "#below-target" : ""}`}
          label="Below Target"
          value={totals.under}
          ariaLabel={`${totals.under} ${isGelato ? "serves" : "dishes and drinks"} below target${worstGap != null ? `, worst gap ${formatPts(worstGap)}` : ""}. Open the alerts`}
        >
          {totals.under ? <StatusLine level="bad" word="Action Needed" /> : <StatusLine level="good" word="All On Target" />}
          <span className="mt-2 block text-[13px] leading-snug text-label-2 tnum">{totals.under && worstGap != null ? `Worst gap ${formatPts(worstGap)}` : isGelato ? "Every serve" : "Every dish and drink"}</span>
        </Tile>

        <Tile
          href={`/alerts${q}${priceAlertsAnchor(totals)}`}
          label="Price Alerts"
          value={priceAlerts}
          ariaLabel={`${priceAlerts} price alerts: ${totals.rises} price rises and ${totals.missing} missing prices. Open the alerts`}
        >
          {priceAlerts ? <StatusLine level="warn" word="Needs A Look" /> : <StatusLine level="good" word="Up To Date" />}
          <span className="mt-2 block text-[13px] leading-snug text-label-2 tnum">
            {priceAlerts ? `${totals.rises} ${totals.rises === 1 ? "rise" : "rises"} · ${totals.missing} missing` : "No rises, none missing"}
          </span>
        </Tile>

        <Tile
          href={specialsHref}
          label="Specials Live"
          value={specials.live}
          ariaLabel={`${specials.live} specials live${specials.live ? `, ${specials.on} on target` : ""}. Open specials`}
        >
          {specials.live === 0 ? (
            <StatusLine level="none" word="None Live" />
          ) : specials.below ? (
            <StatusLine level="bad" word={`${specials.below} Below Target`} />
          ) : specials.check ? (
            <StatusLine level="warn" word={`${specials.check} To Check`} />
          ) : (
            <StatusLine level="good" word="All On Target" />
          )}
          <span className="mt-2 block text-[13px] leading-snug text-label-2 tnum">{specials.live ? `${specials.on} of ${specials.live} on target` : "Combos, specials, happy hours"}</span>
        </Tile>
      </div>

      {headline.excluded > 0 || (health.ready && health.attention > 0) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {headline.excluded > 0 ? (
            <Link
              href={`/alerts${q}#check-cost`}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-warn-soft px-4 text-[15px] font-medium text-warn transition active:scale-[0.97] lg:min-h-[36px] lg:text-[14px]"
            >
              <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
              {headline.excluded} need checking
              <span className="font-normal text-label-2">· not in this average</span>
            </Link>
          ) : null}
          {health.ready && health.attention > 0 ? (
            <Link
              href="/data-health"
              className={cx(
                "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition active:scale-[0.97] lg:min-h-[36px] lg:text-[14px]",
                health.errors > 0 ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn",
              )}
            >
              <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
              {health.attention} data {health.attention === 1 ? "check needs" : "checks need"} attention
            </Link>
          ) : null}
        </div>
      ) : null}

      {empty && venue ? (
        <button type="button" className="btn-tinted mt-3 w-full sm:w-auto" onClick={() => newRecipe.open({ venueId: venue.id })}>
          <Plus className="h-4 w-4" strokeWidth={2.5} /> Add First Recipe
        </button>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {/* 3. Needs Attention: the top few of everything, most important first */}
        {showAttention ? (
          <section aria-labelledby="needs-attention">
            <div className="flex items-end justify-between gap-3 px-1 pb-2">
              <h2 id="needs-attention" className="text-[22px] font-bold tracking-tight">
                Needs Attention{totals.total ? <span className="tnum text-label-2"> · {totals.total}</span> : null}
              </h2>
              {store.ignoredAlerts.length ? (
                <Link href={`/alerts?alerts=ignored${venue ? `&venue=${venue.slug}` : ""}`} className="inline-flex min-h-[44px] items-center px-1 text-[15px] font-medium text-accent lg:min-h-[32px] lg:text-[13px]">
                  Ignored ({store.ignoredAlerts.length})
                </Link>
              ) : null}
            </div>

            {totals.total === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
                  <Check aria-hidden className="h-5 w-5" strokeWidth={2.5} />
                </span>
                <span>
                  <span className="block text-[17px] font-semibold sm:text-[15px]">All Clear</span>
                  <span className="block text-[15px] text-label-2 sm:text-[13px]">
                    Every dish is on target and prices are up to date. Checked {checkedAt.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane" })}.
                    {store.ignoredAlerts.length ? ` ${store.ignoredAlerts.length} ignored ${store.ignoredAlerts.length === 1 ? "alert is" : "alerts are"} set aside.` : ""}
                  </span>
                </span>
              </div>
            ) : (
              <>
                <div className="group-list" style={{ "--inset": "3.75rem" } as React.CSSProperties}>
                  {ranked.map((it, i) => {
                    const vis = attentionVisibility(i);
                    if (vis === "none") return null;
                    const Icon = ICONS[it.icon];
                    return (
                      <div key={it.key} className={vis === "wide" ? "hidden md:block" : undefined}>
                        <AlertRow
                          entry={it.entry}
                          href={it.href}
                          leading={
                            <span className={cx("flex h-9 w-9 items-center justify-center rounded-full", TONE_CHIP[it.tone])}>
                              <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
                            </span>
                          }
                          title={it.title}
                          wrapSub
                          sub={it.sub}
                          trailing={it.trailing ? <span className={cx("text-[15px] font-semibold sm:text-[13px]", TONE_TEXT[it.trailing.tone])}>{it.trailing.text}</span> : undefined}
                          chevron
                        />
                      </div>
                    );
                  })}
                </div>
                {viewAllState(totals.total).show ? (
                  <Link
                    href={`/alerts${q}`}
                    className={cx(
                      "mt-3 flex min-h-[48px] items-center justify-center gap-1 rounded-2xl bg-surface text-[17px] font-semibold text-accent transition-colors hover:bg-surface-2 active:bg-surface-2 sm:text-[15px]",
                      viewAllState(totals.total).hideWide && "md:hidden",
                    )}
                  >
                    View All {totals.total}
                    <ChevronRight aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.5} />
                  </Link>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        <div className="space-y-6">
          {/* 4. one bar per venue: average GP against the target line, a tap filters Home to that venue */}
          {!venue && venueRows.length ? (
            <section aria-labelledby="by-venue">
              <h2 id="by-venue" className="px-1 pb-2 text-[22px] font-bold tracking-tight">
                By Venue
              </h2>
              <div className="group-list">
                {venueRows.map((r) => {
                  const Icon = r.status.level === "good" ? Check : r.status.level === "warn" ? AlertTriangle : r.status.level === "bad" ? TrendingDown : Minus;
                  return (
                    <button
                      key={r.venue.id}
                      type="button"
                      onClick={() => setVenue(r.venue.slug)}
                      aria-label={r.avg == null ? `${VENUE_SHORT[r.venue.slug] ?? r.venue.name}: no GP yet. Show this venue` : `${VENUE_SHORT[r.venue.slug] ?? r.venue.name}: average GP ${gp(r.avg, 0, r.target)}, target ${gp(r.target, 0)}, ${r.status.word}${r.under ? `, ${r.under} below target` : ""}. Show this venue`}
                      className="block min-h-[56px] w-full px-4 py-3 text-left transition-colors hover:bg-fill active:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--label)]"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span aria-hidden className={cx("h-2.5 w-2.5 shrink-0 rounded-[3px]", VENUE_DOT[r.venue.slug] ?? "bg-sand")} />
                          <span className="truncate text-[17px] font-semibold sm:text-[15px]">{VENUE_SHORT[r.venue.slug] ?? r.venue.name}</span>
                          {r.under ? <span className="shrink-0 text-[13px] tnum text-label-2">{r.under} under</span> : null}
                        </span>
                        <span className={cx("flex shrink-0 items-center gap-1.5 text-[15px] tnum sm:text-[13px]", TONE_TEXT[r.status.level])}>
                          <Icon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                          <span className="font-semibold">{r.avg == null ? "No GP Yet" : r.status.word}</span>
                          {r.avg != null ? <span className="font-semibold text-label">{gp(r.avg, 0, r.target)}</span> : null}
                        </span>
                      </span>
                      <GpBar avg={r.avg} target={r.target} label={r.avg == null ? "No GP yet" : `Average GP ${gp(r.avg, 0, r.target)} against a ${gp(r.target, 0)} target`} className="!mt-2.5" />
                    </button>
                  );
                })}
              </div>
              <p className="px-4 pt-1.5 text-[13px] text-label-2">The line on each bar is the target. Tap a venue to see only its numbers.</p>
            </section>
          ) : null}

          {/* 5. live specials, with their GP and a word for where they stand */}
          {specials.live > 0 ? (
            <section aria-labelledby="specials-live">
              <h2 id="specials-live" className="px-1 pb-2 text-[22px] font-bold tracking-tight">
                Specials Live<span className="tnum text-label-2"> · {specials.live}</span>
              </h2>
              <div className="group-list">
                {specials.rows.slice(0, 3).map(({ offer, cost, status: st }) => (
                  <Link key={offer.id} href={`/specials/${offer.id}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill active:bg-fill">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] leading-snug sm:text-[15px]">{offer.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[15px] leading-snug text-label-2 sm:text-[13px]">
                        <span className={cx("inline-flex items-center gap-1 font-medium", st === "on" ? "text-good" : st === "below" ? "text-danger" : st === "check" ? "text-warn" : "text-label-2")}>
                          {st === "on" ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} /> : st === "below" ? <TrendingDown aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} /> : st === "check" ? <AlertTriangle aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} /> : null}
                          {specialStatusWord(st)}
                        </span>
                        <span className="truncate">{[venue ? null : VENUE_SHORT[store.venueById.get(offer.venue_id)?.slug ?? ""], offerKindLabel(offer.kind)].filter(Boolean).join(" · ")}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right tnum">
                      <span className="block text-[17px] font-semibold sm:text-[15px]">{st === "check" || cost.gpPct == null ? "No GP" : gp(cost.gpPct, 0, cost.targetGp)}</span>
                      <span className="block text-[13px] text-label-2">Target {gp(cost.targetGp, 0)}</span>
                    </span>
                    <ChevronRight aria-hidden className="-mr-1 h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} />
                  </Link>
                ))}
                {specials.live > 3 ? (
                  <Link href={specialsHref} className="flex min-h-[48px] items-center justify-center gap-1 px-4 text-[17px] font-semibold text-accent transition-colors hover:bg-fill active:bg-fill sm:text-[15px]">
                    View All {specials.live} Specials
                    <ChevronRight aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.5} />
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Venue identity swatches (a small square beside the name, never a status colour). Full class names so Tailwind keeps them. */
const VENUE_DOT: Record<string, string> = { drift: "bg-drift", chiobu: "bg-chiobu", greedy: "bg-greedy", gelato: "bg-gelato" };
