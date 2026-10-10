"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { groupItems, groupLabel, kitchenPhotoSrc, matchesName, yieldText, type KitchenData, type KitchenDish, type KitchenPrep } from "@/lib/kitchen";
import type { BadgeModel } from "@/lib/allergen-badges";
import { buildKitchenModel, dishBadges, prepBadges } from "@/lib/kitchen-model";
import { syncedLabel } from "@/lib/bar";
import { cx } from "../ui";
import { DishDetail, PrepDetail } from "./detail";
import { BadgeStrip, KitchenLegend } from "./badges";
import { CARD, Chevron, EmptyState, StaleBanner, TilePhoto } from "./parts";

/**
 * The kitchen station: one venue's signed-off dishes and preps on an iPad at the pass, readable with gloves on from arm's length.
 * Same shape as the drinks station (components/bar/station.tsx): grid → one record full screen. No login; the iPad stays on this
 * page, so it refreshes its data in the background and drops back to the grid when left on a recipe.
 */

const IDLE_MS = 120_000; // back to the grid after 2 minutes untouched on a recipe
const REFRESH_MS = 5 * 60_000; // fetch the latest recipes every 5 minutes
const RETRY_MS = 30_000; // ...or every 30 seconds while the first load is failing

const TABS = [
  { key: "dishes", label: "Dishes" },
  { key: "prep", label: "Prep" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Where the screen is. An empty trail is the grid; opening a record pushes it, so Back from a prep opened via a dish returns to that dish. */
type Screen = { kind: "dish" | "prep"; id: string };

export function KitchenStation({ slug, venueName, initial }: { slug: string; venueName: string; initial: KitchenData | null }) {
  const [data, setData] = useState<KitchenData | null>(initial);
  const [tab, setTab] = useState<TabKey>("dishes");
  const [trail, setTrail] = useState<Screen[]>([]);
  const [section, setSection] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  // starts at the copy's own timestamp so the server HTML and the first client render agree; the effect below moves it to the real time after mount
  const [now, setNow] = useState(() => (initial ? Date.parse(initial.syncedAt) : 0));

  // ---------- background refresh (keeps the last good copy when the network drops) ----------
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/kitchen/${slug}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as KitchenData;
      // the iPad's offline copy can hand back an older reply: never swap a newer copy on screen for it
      setData((prev) => (prev && Date.parse(next.syncedAt) < Date.parse(prev.syncedAt) ? prev : next));
    } catch {
      // offline: keep showing what we have; "Synced … ago" tells the truth
    }
  }, [slug]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), data ? REFRESH_MS : RETRY_MS);
    return () => window.clearInterval(id);
  }, [refresh, data]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!data || Date.now() - Date.parse(data.syncedAt) > 60_000)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, data]);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const model = useMemo(() => (data ? buildKitchenModel(data) : null), [data]);
  const dishes = useMemo(() => data?.dishes ?? [], [data]);
  // the badge strip for every dish and prep on the grid, worked out once per copy of the data (not on every keystroke in the search box)
  const dishBadgeMap = useMemo(() => new Map(model ? dishes.map((d) => [d.id, dishBadges(model, d.id)] as const) : []), [model, dishes]);
  const prepBadgeMap = useMemo(() => new Map(model && data ? data.preps.filter((p) => p.ready).map((p) => [p.id, prepBadges(model, p.id)] as const) : []), [model, data]);

  // ---------- views ----------
  // a record that disappears in a refresh (un-ticked, deleted) drops out of the trail, so Back never lands on nothing
  const live = useMemo(() => (model ? trail.filter((s) => (s.kind === "dish" ? model.dishes.has(s.id) : model.preps.has(s.id))) : []), [model, trail]);
  useEffect(() => {
    if (live.length !== trail.length) setTrail(live);
  }, [live, trail.length]);

  const top = live[live.length - 1] ?? null;
  const open = (s: Screen) => {
    (document.activeElement as HTMLElement | null)?.blur?.(); // put the iPad keyboard away
    setTrail((t) => [...t, s]);
  };
  const goBack = useCallback(() => setTrail((t) => t.slice(0, -1)), []);
  const goGrid = useCallback(() => setTrail([]), []);

  const topKey = top ? `${top.kind}:${top.id}` : "grid";
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [topKey]);

  // idle auto-return: any touch, scroll or key on a recipe restarts the 2 minute clock; leaving the recipes clears it
  useEffect(() => {
    if (!top) return;
    let t = window.setTimeout(goGrid, IDLE_MS);
    const reset = () => {
      window.clearTimeout(t);
      t = window.setTimeout(goGrid, IDLE_MS);
    };
    const events = ["pointerdown", "touchstart", "wheel", "scroll", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [top, goGrid]);

  const stale = <StaleBanner syncedAt={data?.syncedAt ?? null} now={now} />;

  // ---------- a record full screen ----------
  if (model && top) {
    const prev = live[live.length - 2];
    const backLabel = !prev
      ? top.kind === "dish"
        ? "BACK TO ALL DISHES"
        : "BACK TO ALL PREPS"
      : `BACK TO ${(prev.kind === "dish" ? model.dishes.get(prev.id)?.name : model.preps.get(prev.id)?.name)?.toUpperCase() ?? "LAST SCREEN"}`;
    const shared = { model, backLabel, onBack: goBack, onOpenPrep: (id: string) => open({ kind: "prep", id }), onOpenDish: (id: string) => open({ kind: "dish", id }), syncedAt: data?.syncedAt ?? null, now };
    return (
      <div role="main" className={cx(`kitchen-${slug}`, "kitchen-root flex min-h-[100dvh] w-full touch-manipulation flex-col bg-[#0E0E10] text-[#F5F3EE]")}>
        {top.kind === "dish" ? <DishDetail key={top.id} dish={model.dishes.get(top.id)!} {...shared} /> : <PrepDetail key={top.id} prep={model.preps.get(top.id)!} {...shared} />}
      </div>
    );
  }

  // ---------- the grid ----------
  const readyPreps = data?.preps.filter((p) => p.ready) ?? [];
  const onDishes = tab === "dishes";
  const total = onDishes ? dishes.length : readyPreps.length;

  const query = searchQuery.trim();
  const hasSearch = query.length > 0;
  const sections = groupItems(dishes, (d) => d.section).map((g) => g.label);
  const activeSection = sections.includes(section) ? section : "all";
  const shownDishes = dishes.filter((d) => (hasSearch ? matchesName(d.name, query) : activeSection === "all" || groupLabel(d.section) === activeSection));
  const shownPreps = readyPreps.filter((p) => matchesName(p.name, query));
  const groups = onDishes ? groupItems(shownDishes, (d) => d.section) : groupItems(shownPreps, (p) => p.prepType, []);

  return (
    <div role="main" className={cx(`kitchen-${slug}`, "kitchen-root flex min-h-[100dvh] w-full touch-manipulation flex-col bg-[#0E0E10] text-[#F5F3EE]")}>
      <div className="flex w-full flex-col">
        {stale}
        <div className="mx-auto w-full max-w-[1000px] px-6 pb-[18px] pt-[calc(28px+env(safe-area-inset-top))]">
          <Link href="/kitchen" className="inline-flex min-h-[44px] items-center gap-[6px] pr-3 text-[16px] font-medium text-[color:var(--bar-text)]">
            <span aria-hidden className="text-[18px] leading-none">
              &#8592;
            </span>
            All Kitchens
          </Link>
          <div className="mt-[6px] flex items-baseline justify-between gap-4">
            <h1 className="font-display text-[48px] uppercase leading-none tracking-[1px]">{venueName}</h1>
            {data ? (
              <p className="shrink-0 text-[14px] text-[#9B9890]" aria-live="polite">
                {syncedLabel(data.syncedAt, now)}
              </p>
            ) : null}
          </div>
          <p className="mt-[2px] text-[18px] text-[#9B9890]">Kitchen Station</p>

          {data ? (
            <div role="tablist" aria-label="Kitchen Station" className="mt-5 grid grid-cols-2 gap-[6px] rounded-[18px] border-[0.5px] border-white/10 bg-[#1C1C1F] p-[6px]">
              {TABS.map((t) => {
                const on = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(t.key)}
                    className={cx("min-h-[64px] rounded-[13px] text-[26px] font-semibold", on ? "bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "text-[#F5F3EE] active:bg-[#232327]")}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {data ? (
            <Link
              href={`/kitchen/${slug}/matrix`}
              className="mt-3 flex min-h-[72px] items-center gap-4 rounded-[18px] border-[0.5px] border-white/10 bg-[#1C1C1F] px-5 py-3 text-left active:bg-[#232327]"
            >
              <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:var(--bar-accent)] text-[22px] font-bold leading-none text-[color:var(--bar-on)]">
                !
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[24px] font-semibold leading-tight">Allergy Matrix</span>
                <span className="block text-[17px] leading-snug text-[#9B9890]">What each guest can eat, dish by dish</span>
              </span>
              <Chevron className="shrink-0 text-[#8E8C85]" />
            </Link>
          ) : null}

          {total ? (
            <>
              <div className="relative mt-4">
                <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8E8C85" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.2" y2="16.2" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  placeholder={onDishes ? "Search dishes" : "Search preps"}
                  aria-label={onDishes ? "Search Dishes" : "Search Preps"}
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="h-[58px] w-full rounded-[14px] border-[0.5px] border-white/10 bg-[#1C1C1F] px-[50px] text-[19px] text-[#F5F3EE] outline-none placeholder:text-[#8E8C85] focus:border-white/25"
                />
                {hasSearch ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear Search"
                    className="absolute right-[10px] top-1/2 flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-full bg-[#2A2A2E] text-[18px] text-[#9B9890] before:absolute before:-inset-[9px] before:content-['']"
                  >
                    &#215;
                  </button>
                ) : null}
              </div>

              {onDishes && !hasSearch && sections.length > 1 ? (
                <div className="mt-[14px] flex flex-wrap gap-2" role="group" aria-label="Section">
                  {["all", ...sections].map((s) => {
                    const on = s === activeSection;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSection(s)}
                        className={cx(
                          "min-h-[48px] rounded-full px-5 py-[10px] text-[18px] font-medium leading-[24px]",
                          on ? "bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "border-[0.5px] border-white/[0.18] bg-transparent text-[#F5F3EE]",
                        )}
                      >
                        {s === "all" ? "All" : s}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div role="tabpanel" className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-1">
          {!data ? (
            <EmptyState title="Can’t Load Recipes" body="Check the iPad’s Wi-Fi. This screen tries again every 30 seconds." action={{ label: "Try Again", onClick: () => void refresh() }} />
          ) : !total ? (
            onDishes ? (
              <EmptyState title="No Dishes Ready For The Kitchen Yet" body="Head chef: tick Ready For Kitchen on a dish in the costing app and it shows here within five minutes." />
            ) : (
              <EmptyState title="No Preps Ready For The Kitchen Yet" body="Head chef: tick Ready For Kitchen on a prep in the costing app and it shows here within five minutes." />
            )
          ) : !groups.length ? (
            <EmptyState title="No Matches" body={`Nothing matches “${query}”.`} />
          ) : (
            groups.map((g) => (
              <section key={g.label} aria-label={g.label} className="mb-6">
                <h2 className="mb-[10px] mt-2 text-[24px] font-semibold leading-tight text-[color:var(--bar-text)]">{g.label}</h2>
                <div className={cx("grid gap-[14px]", onDishes ? "grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 min-[520px]:grid-cols-2")}>
                  {onDishes
                    ? (g.items as KitchenDish[]).map((d) => <DishTile key={d.id} dish={d} badges={dishBadgeMap.get(d.id)} onOpen={() => open({ kind: "dish", id: d.id })} />)
                    : (g.items as KitchenPrep[]).map((p) => <PrepTile key={p.id} prep={p} badges={prepBadgeMap.get(p.id)} onOpen={() => open({ kind: "prep", id: p.id })} />)}
                </div>
              </section>
            ))
          )}
          {data && onDishes && total ? <KitchenLegend /> : null}
        </div>
      </div>
    </div>
  );
}

const TILE = cx(CARD, "flex h-full flex-col overflow-hidden text-left transition-transform duration-150 active:scale-[0.98] active:bg-[#232327]");

function DishTile({ dish, badges, onOpen }: { dish: KitchenDish; badges: BadgeModel | undefined; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={TILE}>
      <TilePhoto src={kitchenPhotoSrc(dish.photo)} className="h-[200px] w-full shrink-0" />
      <div className="flex flex-1 flex-col gap-3 px-4 pb-[18px] pt-[14px]">
        <span className="text-[24px] font-medium leading-[1.2]">{dish.name}</span>
        {badges ? <BadgeStrip m={badges} /> : null}
      </div>
    </button>
  );
}

function PrepTile({ prep, badges, onOpen }: { prep: KitchenPrep; badges: BadgeModel | undefined; onOpen: () => void }) {
  const makes = yieldText(prep.yieldQty, prep.yieldUnit);
  return (
    <button type="button" onClick={onOpen} className={cx(CARD, "flex min-h-[72px] items-center gap-3 px-5 py-4 text-left transition-transform duration-150 active:scale-[0.98] active:bg-[#232327]")}>
      <span className="min-w-0 flex-1">
        <span className="block text-[24px] font-medium leading-[1.2]">{prep.name}</span>
        {makes ? <span className="mt-1 block text-[18px] text-[#9B9890]">{makes}</span> : null}
        {badges ? (
          <span className="mt-3 block">
            <BadgeStrip m={badges} />
          </span>
        ) : null}
      </span>
      <Chevron className="shrink-0 text-[#8E8C85]" />
    </button>
  );
}
