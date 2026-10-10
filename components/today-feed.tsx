"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CircleDollarSign, Clock, Printer, ShieldAlert, Store, Tag, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { catalogueGaps, dealFeedRows, checkCostGroups, checkCostRows, happyHourRows, ingredientsInActiveUse, missingPriceGroups, priceIncreases, staleIngredients, underTarget, underTargetRows, type UnderRow } from "@/lib/insights";
import { costBreakdown, type ItemCost } from "@/lib/costing";
import { buildReviewChanges, gelatoServeStats } from "@/lib/price-review";
import { parseVirtualItemId } from "@/lib/gelato";
import { daysAgo, dateShort, gp, money, movePct } from "@/lib/format";
import { DataTable } from "@/components/table";
import { PriceSheet, SetPriceButton } from "@/components/price-actions";
import { ReviewSheet } from "@/components/price-review";
import { VENUE_SHORT } from "@/components/venue";
import { cx, Group, Row } from "@/components/ui";
import { AlertRow, AlertTabs, IgnoreButton, IgnoredView, useAlertView, useRefreshIgnored } from "@/components/alert-parts";
import {
  belowTargetEntry,
  belowTargetKey,
  catalogueGapEntry,
  catalogueGapKey,
  checkCostEntry,
  checkCostKey,
  dealKey,
  happyHourEntry,
  happyHourKey,
  ignoredKeySet,
  missingPriceEntry,
  missingPriceKey,
  offerBelowTargetKey,
  offerCheckKey,
  openRows,
  priceRiseEntry,
  priceRiseKey,
  stalePriceEntry,
  stalePriceKey,
} from "@/lib/ignored-alerts";
import { OffersFeed } from "@/components/offers-feed";
import { DealsFeed } from "@/components/deals-feed";
import { liveOffersToCheck, liveOffersUnderTarget } from "@/lib/offers";
import { underRowName, type OpenAlerts } from "@/lib/dashboard";
import { allTodos, allergenApprovalAlerts, approvalSub, approvalTitle, reprintAlerts, reprintSub, reprintTitle } from "@/lib/matrix-todo";
import { useAllergenIndex } from "@/components/allergen-picker";

/** "Monday, 5 October" for the store's Brisbane `today`. */
export function formatToday(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/**
 * Every OPEN alert (ignored ones taken out; they are listed under Ignored instead) for one venue choice. Home counts and
 * ranks these (components/dashboard.tsx); the complete feed below lists them. One place, so a number on Home always
 * matches the list behind it.
 */
export function useOpenAlerts(venueId: number | null): OpenAlerts & { ignoredKeys: Set<string> } {
  const store = useStore();
  const { loadPortalPrices, loadMatrixPrints } = store;
  useEffect(() => {
    loadPortalPrices();
    loadMatrixPrints();
  }, [loadPortalPrices, loadMatrixPrints]);
  const ignoredKeys = useMemo(() => ignoredKeySet(store.ignoredAlerts), [store.ignoredAlerts]);
  const under = useMemo(() => openRows(underTargetRows(store.itemCosts.values(), venueId), (r) => belowTargetKey(r.cost), ignoredKeys), [store.itemCosts, venueId, ignoredKeys]);
  const check = useMemo(() => openRows(checkCostGroups(checkCostRows(store.itemCosts.values(), venueId)), checkCostKey, ignoredKeys), [store.itemCosts, venueId, ignoredKeys]);
  const missing = useMemo(() => openRows(missingPriceGroups(store.itemCosts.values(), venueId), missingPriceKey, ignoredKeys), [store.itemCosts, venueId, ignoredKeys]);
  const happy = useMemo(() => openRows(happyHourRows(store.itemCosts.values(), venueId), happyHourKey, ignoredKeys), [store.itemCosts, venueId, ignoredKeys]);
  const itemById = useMemo(() => new Map(store.items.map((i) => [i.id, i])), [store.items]);
  const rises = useMemo(
    () => openRows(priceIncreases(store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venueId, 30, store.itemCosts), priceRiseKey, ignoredKeys),
    [store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venueId, store.itemCosts, ignoredKeys],
  );
  // only ingredients something ACTIVE uses can raise a stale price or deal alert (lib/active.ts)
  const inUse = useMemo(() => ingredientsInActiveUse(store.allLines, store.items, store.preps), [store.allLines, store.items, store.preps]);
  const stale = useMemo(
    () =>
      openRows(staleIngredients(store.ingredients, inUse), stalePriceKey, ignoredKeys).sort(
        (a, b) => (a.last_price_update ?? "").localeCompare(b.last_price_update ?? "") || a.name.localeCompare(b.name), // never checked first, then oldest
      ),
    [store.ingredients, inUse, ignoredKeys],
  );
  const gaps = useMemo(
    () => openRows(catalogueGaps(store.ingredients, store.portalPrices, store.settings.gst_rate, store.supplierById), catalogueGapKey, ignoredKeys),
    [store.ingredients, store.portalPrices, store.settings.gst_rate, store.supplierById, ignoredKeys],
  );
  const deals = useMemo(() => openRows(dealFeedRows(store.deals, store.ingredients, inUse, store.today), dealKey, ignoredKeys), [store.deals, store.ingredients, inUse, store.today, ignoredKeys]);
  const offersBelow = useMemo(() => openRows(liveOffersUnderTarget(store.offers, store.offerCosts, venueId), (r) => offerBelowTargetKey(r.offer), ignoredKeys), [store.offers, store.offerCosts, venueId, ignoredKeys]);
  const offersCheck = useMemo(() => openRows(liveOffersToCheck(store.offers, store.offerCosts, venueId), (r) => offerCheckKey(r.offer), ignoredKeys), [store.offers, store.offerCosts, venueId, ignoredKeys]);
  // the two safety alerts (dishes waiting for allergen approval, a matrix that changed since it was printed): one row per venue,
  // never ignorable, so they take no part in the ignored keys above and never touch the GP average
  const allergenIdx = useAllergenIndex();
  const todos = useMemo(() => allTodos(store.venues, store.items, allergenIdx, store.matrixPrints), [store.venues, store.items, allergenIdx, store.matrixPrints]);
  const allergenApproval = useMemo(() => allergenApprovalAlerts(todos, venueId), [todos, venueId]);
  const reprint = useMemo(() => reprintAlerts(todos, venueId), [todos, venueId]);
  return useMemo(
    () => ({ under, missing, rises, check, stale, gaps, happy, deals, offersBelow, offersCheck, allergenApproval, reprint, ignoredKeys }),
    [under, missing, rises, check, stale, gaps, happy, deals, offersBelow, offersCheck, allergenApproval, reprint, ignoredKeys],
  );
}

/** Ids a link like /alerts#below-target can land on. */
const ANCHORS = new Set(["check-cost", "below-target", "price-rises", "missing-price", "allergen-approval"]);

/**
 * The complete Today feed (it lives on /alerts): every alert kind in its own group, Open | Ignored, Review & Apply and
 * Show All. Home shows a ranked summary of the same alerts and links here.
 */
export function TodayFeed({ venueId, showHeading = true }: { venueId: number | null; showHeading?: boolean }) {
  const store = useStore();
  const [allUnder, setAllUnder] = useState(false);
  const [allRises, setAllRises] = useState(false);
  const [allCheck, setAllCheck] = useState(false);
  const [allHappy, setAllHappy] = useState(false);
  const [allMissing, setAllMissing] = useState(false);
  const [allStale, setAllStale] = useState(false);
  const [allGaps, setAllGaps] = useState(false);
  const [priceFor, setPriceFor] = useState<ItemCost | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [view, setView] = useAlertView();
  useRefreshIgnored();

  const { under, missing, rises, check, stale, gaps, happy, deals: dealRows, offersBelow, offersCheck, allergenApproval, reprint, ignoredKeys } = useOpenAlerts(venueId);
  const changes = useMemo(
    () =>
      buildReviewChanges(
        underTarget(store.itemCosts.values(), venueId).filter((c) => !ignoredKeys.has(belowTargetKey(c))),
        store.settings.gst_rate,
        gelatoServeStats(store.itemCosts.values()),
      ),
    [store.itemCosts, venueId, store.settings.gst_rate, ignoredKeys],
  );

  // a link from Home (/alerts#below-target, #price-rises, #missing-price, #check-cost) lands on its group once the feed is drawn
  const anchored = under.length + rises.length + missing.length + check.length;
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!ANCHORS.has(id) || view !== "open") return;
    const raf = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(raf);
  }, [view, anchored > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // the heading date follows the store's Brisbane `today`, so it moves at midnight in a tab left open
  const today = formatToday(store.today);
  const clear = !allergenApproval.length && !reprint.length && !offersBelow.length && !offersCheck.length && !missing.length && !under.length && !rises.length && !stale.length && !gaps.length && !check.length && !happy.length && !dealRows.length;
  const shownUnder = allUnder ? under : under.slice(0, 5);
  const shownRises = allRises ? rises : rises.slice(0, 3);
  const shownCheck = allCheck ? check : check.slice(0, 4);
  const shownMissing = allMissing ? missing : missing.slice(0, 4);
  const shownHappy = allHappy ? happy : happy.slice(0, 4);
  const shownStale = allStale ? stale : stale.slice(0, 4);
  const shownGaps = allGaps ? gaps : gaps.slice(0, 4);
  const ignoredCount = store.ignoredAlerts.length;
  const reviewButton =
    changes.length >= 2 ? (
      <button type="button" onClick={() => setReviewing(true)} className="-mb-1 min-h-[44px] px-1 text-[15px] font-semibold text-accent lg:min-h-[32px] lg:text-[13px]">
        Review &amp; Apply
      </button>
    ) : null;

  return (
    <section className={showHeading ? "mt-8" : "mt-2"}>
      {showHeading ? (
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-[22px] font-bold tracking-tight">Today</h2>
          <span className="text-[13px] text-label-2">{today}</span>
        </div>
      ) : null}

      <AlertTabs view={view} onChange={setView} ignoredCount={ignoredCount} className="mt-3" />

      {view === "ignored" ? (
        <>
          {venueId != null ? <p className="px-4 pt-2 text-[13px] text-label-2">Ignored alerts are shown for every venue.</p> : null}
          <IgnoredView />
        </>
      ) : (
        <>
          {clear ? (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-surface px-4 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
                <Check className="h-5 w-5" strokeWidth={2.5} />
              </span>
              <span>
                <span className="block text-[17px] font-semibold sm:text-[15px]">All Clear</span>
                <span className="block text-[15px] text-label-2 sm:text-[13px]">
                  Every dish is on target and prices are up to date.
                  {ignoredCount ? ` ${ignoredCount} ignored ${ignoredCount === 1 ? "alert is" : "alerts are"} under Ignored.` : ""}
                </span>
              </span>
            </div>
          ) : null}

          {/* safety first: allergen approval, then (lowest) a matrix that needs reprinting. No Ignore button: these cannot be ignored */}
          {allergenApproval.length ? (
            <div id="allergen-approval" className="scroll-mt-4">
              <Group title={`Allergen Approval · ${allergenApproval.length}`} className="mt-4" inset="3.75rem" footer="Dishes with no valid allergen sign-off read Not checked on the Allergy Matrix. These cannot be ignored.">
                {allergenApproval.map((a) => (
                  <Row
                    key={a.key}
                    href={a.href}
                    leading={
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-soft text-danger">
                        <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={2.25} />
                      </span>
                    }
                    title={approvalTitle(a.count)}
                    wrapSub
                    sub={[venueName(store, a.venueId), approvalSub(a)].filter(Boolean).join(" · ")}
                    trailing={<span className="text-[15px] font-semibold text-accent sm:text-[13px]">Review</span>}
                    chevron
                  />
                ))}
              </Group>
            </div>
          ) : null}

          <OffersFeed rows={offersBelow} checkRows={offersCheck} showVenue={venueId == null} />
          <DealsFeed rows={dealRows} />

          {/* price rises: the cause, before the symptoms */}
          {rises.length ? (
            <div id="price-rises" className="scroll-mt-4">
              <Group title={`Price Rises · Last 30 Days`} className="mt-4" inset="3.75rem">
                {shownRises.map((r) => (
                  <AlertRow
                    key={r.ingredient.id}
                    entry={priceRiseEntry(r)}
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
            </div>
          ) : null}

          {/* costs that look wrong: fix these before trusting any price */}
          {check.length ? (
            <div id="check-cost" className="scroll-mt-4">
              <Group title={`Check Cost · ${check.length}`} className="mt-6" inset="3.75rem" footer="These are left out of the average GP until the cost looks right.">
                {shownCheck.map((g) => (
                  <AlertRow
                    key={g.id}
                    entry={checkCostEntry(g)}
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

          {/* on the menu with no sell price: no GP, so nothing else flags them. Suggestions only, nothing is applied from here */}
          {missing.length ? (
            <div id="missing-price" className="scroll-mt-4">
              <Group
                title={`Missing Price · ${missing.length}`}
                className="mt-6"
                inset="3.75rem"
                footer="These are on the menu with no sell price, so they have no GP. Open one to enter a price. The price shown is only a suggestion."
              >
                {shownMissing.map((m) => (
                  <AlertRow
                    key={m.id}
                    entry={missingPriceEntry(m)}
                    href={m.href}
                    leading={
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warn-soft text-warn">
                        <CircleDollarSign className="h-[18px] w-[18px]" strokeWidth={2.25} />
                      </span>
                    }
                    title={m.count > 1 ? `${m.name} (${m.count} serves)` : m.name}
                    wrapSub
                    sub={[
                      venueName(store, m.venueId),
                      m.cost > 0 ? `Cost ${money(m.cost)}` : "No cost yet",
                      m.suggestedInc != null ? `${money(m.suggestedInc)} would give ${gp(m.targetGp, 0)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={<span className="text-[15px] font-semibold text-accent sm:text-[13px]">Add Price</span>}
                    chevron
                  />
                ))}
                {missing.length > 4 ? <Row onClick={() => setAllMissing((x) => !x)} title={<span className="text-accent">{allMissing ? "Show Fewer" : `Show All ${missing.length}`}</span>} /> : null}
              </Group>
            </div>
          ) : null}

          {/* below target, with the fix on the row */}
          {under.length ? (
            <div id="below-target" className="scroll-mt-4">
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
                    { key: "name", label: "Item", render: (r) => <span className="font-medium">{underRowName(r)}</span>, sort: (r) => underRowName(r) },
                    ...(venueId == null ? [{ key: "venue", label: "Venue", render: (r: UnderRow) => <span className="text-label-2">{venueShort(store, r)}</span>, sort: (r: UnderRow) => venueShort(store, r) }] : []),
                    { key: "gp", label: "GP / Target", align: "right", render: (r) => <span><span className="font-semibold text-danger">{gp(r.cost.gpPct, 1, r.cost.targetGp)}</span> <span className="text-label-2">/ {gp(r.cost.targetGp, 0)}</span></span>, sort: (r) => r.cost.gpPct },
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
                    { key: "ignore", label: "Ignore", align: "right", render: (r) => <IgnoreButton entry={belowTargetEntry(r, underRowName(r))} quiet /> },
                  ]}
                />
                <p className="px-4 pt-1.5 text-[13px] text-label-2">Set applies the suggested price (rounded up to the target GP). Tap a price to pick another. You can undo either.</p>
              </div>
            </div>
          ) : null}

          {/* happy hour prices under the same target */}
          {happy.length ? (
            <Group title={`Happy Hour · ${happy.length}`} className="mt-6" inset="3.75rem" footer="Happy hour prices are held to the same target GP as the normal price.">
              {shownHappy.map((h) => (
                <AlertRow
                  key={h.cost.item.id}
                  entry={happyHourEntry(h)}
                  href={`/items/${h.cost.item.id}`}
                  leading={
                    <span className={cx("flex h-9 w-9 items-center justify-center rounded-full", h.belowCost ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>
                      <Tag className="h-[18px] w-[18px]" strokeWidth={2.25} />
                    </span>
                  }
                  title={h.cost.item.name}
                  wrapSub
                  sub={`${venueName(store, h.cost.item.venue_id)} · ${money(h.hhPrice)} · ${h.belowCost ? `below cost (${money(h.cost.costPerPortion)})` : `${gp(h.hhGpPct, 0, h.cost.targetGp)} vs ${gp(h.cost.targetGp, 0)} target`}`}
                  trailing={<span className={cx("font-semibold", h.belowCost ? "text-danger" : "text-warn")}>{gp(h.hhGpPct, 0, h.cost.targetGp)}</span>}
                  chevron
                />
              ))}
              {happy.length > 4 ? <Row onClick={() => setAllHappy((x) => !x)} title={<span className="text-accent">{allHappy ? "Show Fewer" : `Show All ${happy.length}`}</span>} /> : null}
            </Group>
          ) : null}

          {/* ingredient prices not checked in 90 days: one row per ingredient, so each can be ignored on its own */}
          {stale.length ? (
            <Group
              title={`Price Not Checked · ${stale.length}`}
              className="mt-6"
              inset="3.75rem"
              trailing={
                <Link href="/ingredients?filter=stale" className="-mb-1 min-h-[44px] px-1 pt-3 text-[15px] font-semibold text-accent lg:min-h-[32px] lg:pt-1.5 lg:text-[13px]">
                  See List
                </Link>
              }
              footer="Only ingredients used in recipes, longest wait first. Update from your next invoice."
            >
              {shownStale.map((i) => (
                <AlertRow
                  key={i.id}
                  entry={stalePriceEntry(i)}
                  href={`/ingredients/${i.id}`}
                  leading={
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fill-2 text-label-2">
                      <Clock className="h-[18px] w-[18px]" strokeWidth={2.25} />
                    </span>
                  }
                  title={i.name}
                  sub={i.last_price_update ? `Last checked ${dateShort(i.last_price_update)} · ${daysAgo(i.last_price_update) ?? "over 90"} days ago` : "Never checked"}
                  chevron
                />
              ))}
              {stale.length > 4 ? <Row onClick={() => setAllStale((x) => !x)} title={<span className="text-accent">{allStale ? "Show Fewer" : `Show All ${stale.length}`}</span>} /> : null}
            </Group>
          ) : null}

          {gaps.length ? (
            <Group
              title={`Catalogue Differences · ${gaps.length}`}
              className="mt-6"
              inset="3.75rem"
              trailing={
                <Link href="/ingredients?filter=catalogue" className="-mb-1 min-h-[44px] px-1 pt-3 text-[15px] font-semibold text-accent lg:min-h-[32px] lg:pt-1.5 lg:text-[13px]">
                  See List
                </Link>
              }
              footer="Same supplier product code, different price per unit. Open one to update it."
            >
              {shownGaps.map((g) => (
                <AlertRow
                  key={g.ingredient.id}
                  entry={catalogueGapEntry(g)}
                  href={`/ingredients/${g.ingredient.id}`}
                  leading={
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <Store className="h-[18px] w-[18px]" strokeWidth={2.25} />
                    </span>
                  }
                  title={g.ingredient.name}
                  wrapSub
                  sub={`Catalogue ${g.diffPct > 0 ? "+" : ""}${Math.round(g.diffPct * 100)}% · ${money(g.theirs)} vs ${money(g.ours)} per ${g.ingredient.pack_unit}`}
                  chevron
                />
              ))}
              {gaps.length > 4 ? <Row onClick={() => setAllGaps((x) => !x)} title={<span className="text-accent">{allGaps ? "Show Fewer" : `Show All ${gaps.length}`}</span>} /> : null}
            </Group>
          ) : null}
          {reprint.length ? (
            <Group title={`Matrix Needs Reprinting · ${reprint.length}`} className="mt-6" inset="3.75rem" footer="The sheet on the wall no longer matches the matrix. Open the To Do list to see what changed. These cannot be ignored.">
              {reprint.map((a) => (
                <Row
                  key={a.key}
                  href={a.href}
                  leading={
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warn-soft text-warn">
                      <Printer className="h-[18px] w-[18px]" strokeWidth={2.25} />
                    </span>
                  }
                  title={reprintTitle(venueName(store, a.venueId))}
                  sub={reprintSub(a.count)}
                  chevron
                />
              ))}
            </Group>
          ) : null}
        </>
      )}

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
      <div className="flex items-start gap-2">
      <Link href={`/items/${c.item.id}`} className="block min-w-0 flex-1 transition-opacity active:opacity-60">
        <span className="block truncate text-[17px] leading-snug sm:text-[15px]">{underRowName(r)}</span>
        <span className="mt-0.5 block truncate text-[15px] leading-snug text-label-2 tnum sm:text-[13px]">
          {showVenue ? `${venueShort(store, r)} · ` : ""}
          <span className="text-danger">{gp(c.gpPct, 1, c.targetGp)}</span> vs {gp(c.targetGp, 0)}
        </span>
        {shared ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-label-2">Applies to all flavours. Suggested from the dearest, {c.item.name.split(" - ")[0]}.</span>
        ) : driver ? (
          <span className="mt-0.5 block truncate text-[13px] leading-snug text-label-2 tnum">Biggest cost: {driver}</span>
        ) : null}
      </Link>
      <IgnoreButton entry={belowTargetEntry(r, underRowName(r))} quiet className="-mr-3 -mt-1.5 shrink-0" />
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onPrice}
          aria-label={`Change price for ${underRowName(r)}, now ${money(c.sellInc)}`}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-fill px-3 text-[15px] font-medium tnum text-label transition active:scale-[0.97]"
        >
          Now {money(c.sellInc)} <span className="text-accent">· Change</span>
        </button>
        <SetPriceButton c={c} className="flex-1 justify-center" />
      </div>
    </div>
  );
}
