"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { barChips, barPhotoSrc, glassType, ingredientDisplay, isStale, staleAge, syncedLabel, usesShots, type BarCategory, type BarItem, type BarMenu } from "@/lib/bar";
import type { BarPremix } from "@/lib/bar-premix";
import { drinksInView, flavourCount, goBack as navBack, goHome, NAV_START, openDrink as navOpenDrink, openGroup as navOpenGroup, resolveScreen, sameNav, stationCards, type StationCard, type StationNav } from "@/lib/menu-groups";
import { cx } from "../ui";
import { useFromChooser } from "../station-chooser";
import { BottleIcon, GlassIcon } from "./glass-icon";

/**
 * Tracks whether a photo failed to load. The server-rendered <img> can finish failing before the page hydrates, so React's
 * onError never fires for it: on mount a ref also checks whether the image has already finished loading with no picture.
 */
function useBrokenPhoto() {
  const [broken, setBroken] = useState(false);
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setBroken(true);
  }, []);
  return { broken, ref, onError: () => setBroken(true) };
}

/** A reference photo that quietly disappears (no broken-image box, no orphaned caption) when this item has no file yet. */
function Photo({ name, photo, className }: { name: string; photo: string | null; className: string }) {
  const { broken, ref, onError } = useBrokenPhoto();
  if (broken) return null;
  // plain <img>: the iPad's offline cache holds these exact files (next/image would route through the optimiser instead)
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={barPhotoSrc(name, photo)} alt="" className={className} onError={onError} />;
}

function PhotoColumn({ name, photo }: { name: string; photo: string | null }) {
  const { broken, ref, onError } = useBrokenPhoto();
  if (broken) return null;
  return (
    <div className="w-full text-center sm:w-[260px] sm:shrink-0">
      {/* object-contain on the photos' own 3:4 shape: the whole glass, drink and garnish always show, nothing is cropped */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={barPhotoSrc(name, photo)}
        alt=""
        className="mx-auto aspect-[3/4] w-[240px] rounded-[14px] border-[0.5px] border-white/10 bg-[#161618] object-contain sm:w-full"
        onError={onError}
      />
      <p className="mt-[6px] text-[12px] text-[#8E8C85]">Drink should look similar to this once finished</p>
    </div>
  );
}

/**
 * The drinks station: one venue's cocktails, mocktails and cold drinks on an iPad behind the bar, glanceable from about a metre away.
 * A port of the approved prototype (grid → one recipe full screen). No login; the iPad stays on this page,
 * so it refreshes its data in the background and drops back to the grid when left on a recipe.
 */

/** Shown only when the recipes on screen are 15+ minutes old (Wi-Fi down, server unreachable). Big on purpose: a bartender must know before trusting a measure. */
export function StaleBanner({ syncedAt, now }: { syncedAt: string | null; now: number }) {
  if (!syncedAt || !isStale(syncedAt, now)) return null;
  return (
    <div role="alert" className="border-y-[0.5px] border-[#F2C46D]/40 bg-[#2B2210] px-6 py-4 text-center">
      <p className="text-[20px] font-semibold leading-tight text-[#F2C46D]">Recipes May Be Out Of Date</p>
      <p className="mt-1 text-[16px] leading-snug text-[#F2C46D]">Last updated {staleAge(syncedAt, now)}. Check the iPad&rsquo;s Wi-Fi. This screen keeps trying.</p>
    </div>
  );
}

export const IDLE_MS = 120_000; // back to the grid after 2 minutes untouched on a recipe
export const REFRESH_MS = 5 * 60_000; // fetch the latest recipes every 5 minutes
export const RETRY_MS = 30_000; // ...or every 30 seconds while the first load is failing

export const CARD = "rounded-2xl border-[0.5px] border-white/[0.08] bg-[#1C1C1F]";
export const ROW = "border-t-[0.5px] border-white/[0.07]";
export const HEADING = "text-[15px] font-medium tracking-[0.5px] text-[#9B9890]";

export function BarStation({ slug, venueName, initial, premixCount: initialPremixCount = 0 }: { slug: string; venueName: string; initial: BarMenu | null; premixCount?: number }) {
  const [menu, setMenu] = useState<BarMenu | null>(initial);
  // the way back to the venue chooser shows only when this session came through it: an iPad opened on its own bar never offers another
  const fromChooser = useFromChooser("bar");
  // how many pre-mix bottles the venue has; the "Pre-Mix Bottles" row shows only when there is at least one
  const [premixCount, setPremixCount] = useState(initialPremixCount);
  // where the screen is: the main grid, an open flavour list (a menu group) and/or an open recipe (lib/menu-groups.ts)
  const [nav, setNav] = useState<StationNav>(NAV_START);
  const [pickedCategory, setPickedCategory] = useState<"all" | BarCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // starts at the copy's own timestamp so the server HTML and the first client render agree (a page cached hours ago would otherwise
  // hydrate with a different "Synced" line and banner); the effect below moves it to the real time straight after mount
  const [now, setNow] = useState(() => (initial ? Date.parse(initial.syncedAt) : 0));

  // ---------- background refresh (keeps the last good copy when the network drops) ----------
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/bar/${slug}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as BarMenu;
      // the iPad's offline copy can hand back an older reply: never swap a newer copy on screen for it
      setMenu((prev) => (prev && Date.parse(next.syncedAt) < Date.parse(prev.syncedAt) ? prev : next));
    } catch {
      // offline: keep showing what we have; "Synced … ago" tells the truth
    }
    try {
      const res = await fetch(`/api/bar/${slug}/premix`, { cache: "no-store" });
      if (res.ok) setPremixCount(((await res.json()) as BarPremix).premixes.length);
    } catch {
      // the row stays as it was
    }
  }, [slug]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), menu ? REFRESH_MS : RETRY_MS);
    return () => window.clearInterval(id);
  }, [refresh, menu]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!menu || Date.now() - Date.parse(menu.syncedAt) > 60_000)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, menu]);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const items = useMemo(() => menu?.items ?? [], [menu]);

  // ---------- grid filtering (search covers every category and hides the chips) ----------
  const query = searchQuery.trim().toLowerCase();
  const hasSearch = query.length > 0;
  // only the categories this venue has get a chip; a chip whose last drink went inactive in a refresh falls back to All
  const chips = useMemo(() => barChips(items), [items]);
  const activeCategory = chips.some((c) => c.key === pickedCategory) ? pickedCategory : "all";
  const category = activeCategory === "all" ? null : activeCategory;
  // what the grid shows: a search lists matching drinks flat (group name as a quiet line); otherwise the chip's drinks, with
  // flavours of one menu group folded into a single card when two or more are in view
  const cards = useMemo(() => stationCards(drinksInView(items, { query: searchQuery, category }), { searching: hasSearch }), [items, searchQuery, category, hasSearch]);
  // the group cards the chip alone would give: a flavour list stays valid whatever is typed in the (hidden) search box
  const groupCards = useMemo(() => stationCards(drinksInView(items, { query: "", category })), [items, category]);
  const here = useMemo(() => resolveScreen(nav, items, groupCards), [nav, items, groupCards]);
  const screen = here.screen;
  const selected = here.item;
  const openGroupCard = here.group;

  // a recipe or flavour list that disappears in a refresh (deleted, made inactive, a flavour left alone) drops back instead of going blank
  useEffect(() => {
    if (!sameNav(nav, here.nav)) setNav(here.nav);
  }, [nav, here.nav]);

  // ---------- views ----------
  const openDrink = (id: string) => {
    (document.activeElement as HTMLElement | null)?.blur?.(); // put the iPad keyboard away
    setNav((n) => navOpenDrink(n, id));
  };
  const openGroup = (key: string) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setNav((n) => navOpenGroup(n, key));
  };
  const goBack = useCallback(() => setNav(navBack), []);
  const goGrid = useCallback(() => setNav(goHome()), []);

  const scrollKey = `${screen}|${nav.group ?? ""}`;
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [scrollKey]);

  // idle auto-return: any touch, scroll or key on a recipe or flavour list restarts the 2 minute clock; the main grid has none.
  // Left alone it goes all the way back to the main grid.
  useEffect(() => {
    if (screen === "grid") return;
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
  }, [screen, goGrid]);

  return (
    <div role="main" className={cx(`bar-${slug}`, "bar-root flex min-h-[100dvh] w-full touch-manipulation flex-col bg-[#0E0E10] text-[#F5F3EE]")}>
      {screen === "detail" && selected ? (
        <Detail item={selected} onBack={goBack} backLabel={openGroupCard ? `BACK TO ${openGroupCard.name.toUpperCase()}` : "BACK TO ALL DRINKS"} menu={menu} now={now} />
      ) : screen === "group" && openGroupCard ? (
        <GroupList card={openGroupCard} onBack={goBack} onOpen={openDrink} menu={menu} now={now} />
      ) : (
        <div className="flex w-full flex-col">
          <StaleBanner syncedAt={menu?.syncedAt ?? null} now={now} />
          <div className="mx-auto w-full max-w-[1000px] px-6 pb-[18px] pt-[calc(28px+env(safe-area-inset-top))]">
            {fromChooser ? (
              <Link href="/bar" className="inline-flex min-h-[44px] items-center gap-[6px] pr-3 text-[16px] font-medium text-[color:var(--bar-text)]">
                <span aria-hidden className="text-[16px] leading-none">
                  &#8592;
                </span>
                All Venues
              </Link>
            ) : null}
            <div className={cx("flex items-baseline justify-between gap-4", fromChooser && "mt-[6px]")}>
              <h1 className="font-display text-[48px] uppercase leading-none tracking-[1px]">{menu?.venue.name ?? venueName}</h1>
              {menu ? (
                <p className="shrink-0 text-[13px] text-[#9B9890]" aria-live="polite">
                  {syncedLabel(menu.syncedAt, now)}
                </p>
              ) : null}
            </div>
            <p className="mt-[2px] text-[16px] text-[#9B9890]">Drinks</p>

            {items.length ? (
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
                    placeholder="Search drinks"
                    aria-label="Search Drinks"
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
                      className="absolute right-[10px] top-1/2 flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-full bg-[#2A2A2E] text-[18px] text-[#9B9890] before:absolute before:-inset-[3px] before:content-['']"
                    >
                      &#215;
                    </button>
                  ) : null}
                </div>

                {!hasSearch && (chips.length || premixCount > 0) ? (
                  <div className="mt-[14px] grid grid-cols-2 gap-2 sm:grid-flow-col sm:auto-cols-fr" role="group" aria-label="Category">
                    {chips.map((cat) => {
                      const on = cat.key === activeCategory;
                      return (
                        <button
                          key={cat.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setPickedCategory(cat.key)}
                          className={cx(
                            "min-h-[58px] rounded-[14px] px-3 py-3 text-[19px] font-semibold leading-[24px]",
                            on ? "bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "border-[0.5px] border-white/[0.18] bg-transparent text-[#F5F3EE]",
                          )}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                    {premixCount > 0 ? (
                      <Link
                        href={`/bar/${slug}/premix`}
                        className="col-span-2 flex min-h-[58px] items-center justify-center gap-2 rounded-[14px] border-[0.5px] border-[color:var(--bar-accent)] px-3 py-3 text-[19px] font-semibold leading-[24px] text-[color:var(--bar-text)] transition-transform duration-150 active:scale-[0.98] sm:col-span-1"
                      >
                        <BottleIcon size={22} className="shrink-0" />
                        Pre-Mix Bottles
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-1">
            {!menu ? (
              <EmptyState title="Can’t Load Recipes" body="Check the iPad’s Wi-Fi. This screen tries again every 30 seconds." action={{ label: "Try Again", onClick: () => void refresh() }} />
            ) : !items.length ? (
              <EmptyState title="No Drinks On This Screen Yet" body="A drink shows here once it has a glass and a method in the CFP App. Drinks that are still being built out are not displayed." />
            ) : !cards.length ? (
              // only a search can come up empty: a chip exists only for a category that has drinks
              <EmptyState title="No Matches" body={`Nothing matches “${searchQuery.trim()}”.`} />
            ) : (
              <div className="grid grid-cols-2 gap-[14px]">
                {cards.map((c) => (c.kind === "group" ? <GroupCard key={`g-${c.key}`} card={c} onOpen={() => openGroup(c.key)} /> : <DrinkCard key={c.key} item={c.item} onOpen={() => openDrink(c.item.id)} groupLine={hasSearch ? c.item.menuGroup : null} />))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={cx(CARD, "mt-2 px-6 py-14 text-center")}>
      <p className="text-[26px] font-medium leading-[1.2]">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-[460px] text-[17px] leading-snug text-[#9B9890]">{body}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-6 min-h-[48px] rounded-full bg-[color:var(--bar-accent)] px-6 text-[17px] font-semibold text-[color:var(--bar-on)]">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function Detail({ item, onBack, backLabel, menu, now }: { item: BarItem; onBack: () => void; backLabel: string; menu: BarMenu | null; now: number }) {
  return (
    <div className="flex w-full flex-col">
      <BackBar label={backLabel} onBack={onBack} />
      <StaleBanner syncedAt={menu?.syncedAt ?? null} now={now} />

      <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-7">
        <div className="flex flex-col items-start gap-5 sm:flex-row">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[52px] leading-none tracking-[0.5px]">{item.name}</h1>
            {item.glass ? (
              <div className="mt-[10px] flex items-center gap-[9px] text-[#D9C3A0]">
                <GlassIcon type={glassType(item.glass)} size={22} className="shrink-0" />
                <p className="text-[18px] font-medium">{item.glass}</p>
              </div>
            ) : null}

            {item.lines.length ? (
              <section className={cx(CARD, "mt-5 px-5 py-[18px]")}>
                <h2 className={cx(HEADING, "mb-2")}>INGREDIENTS</h2>
                <ul>
                  {item.lines.map((line, i) => {
                    const d = ingredientDisplay(line, { shots: usesShots(item.category) });
                    return (
                      <li key={i} className={cx(ROW, "flex items-start gap-[14px] py-[14px]")}>
                        <div className="w-[128px] shrink-0">
                          {d.shots ? (
                            <>
                              <p className="text-[30px] font-medium leading-[1.1] text-[#D9C3A0]">{d.shots}</p>
                              <p className="mt-[2px] text-[13px] text-[#8E8C85]">{d.qty}</p>
                            </>
                          ) : (
                            <p className={cx("font-medium text-[#D9C3A0] [overflow-wrap:anywhere]", d.plain.length > 9 ? "text-[20px] leading-[1.2]" : "text-[27px] leading-[1.15]")}>{d.plain}</p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[27px] leading-[1.2]">{d.name}</p>
                          {d.aside ? <p className="mt-1 text-[18px] leading-snug text-[#9B9890]">{d.aside}</p> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
          <PhotoColumn name={item.name} photo={item.photo} />
        </div>

        {item.method.length ? <Steps title="METHOD" steps={item.method} circle="bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" /> : null}
        {item.garnish.length ? <Steps title="GARNISH" steps={item.garnish} circle="bg-[#D9C3A0] text-[#20191A]" /> : null}
      </div>
    </div>
  );
}

function Steps({ title, steps, circle }: { title: string; steps: string[]; circle: string }) {
  return (
    <section className={cx(CARD, "mt-4 px-[22px] py-5")}>
      <h2 className={cx(HEADING, "mb-1")}>{title}</h2>
      <ol>
        {steps.map((text, i) => (
          <li key={i} className={cx(ROW, "flex items-center gap-[18px] py-[18px]")}>
            <span aria-hidden className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px] font-medium", circle)}>
              {i + 1}
            </span>
            <span className="text-[27px] font-medium leading-[1.2]">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The big accent bar across the top of a recipe or a flavour list: one tap back, the whole width, readable from a metre away. */
function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex min-h-[calc(84px+env(safe-area-inset-top))] w-full items-center justify-center gap-[14px] bg-[color:var(--bar-accent)] px-5 pb-6 pt-[calc(24px+env(safe-area-inset-top))] text-center text-[28px] font-bold leading-tight text-[color:var(--bar-on)] active:opacity-90"
    >
      <span aria-hidden className="text-[34px] font-bold leading-none">
        &#8592;
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
    </button>
  );
}

/** One drink on the grid: photo, name, glass. `groupLine` is the quiet menu-group name shown on a search result. */
function DrinkCard({ item, onOpen, groupLine }: { item: BarItem; onOpen: () => void; groupLine?: string | null }) {
  return (
    <button type="button" onClick={onOpen} className={cx(CARD, "flex flex-col overflow-hidden text-left transition-transform duration-150 active:scale-[0.98] active:bg-[#232327] motion-reduce:transition-none motion-reduce:active:scale-100")}>
      <Photo name={item.name} photo={item.photo} className="h-[270px] w-full bg-[#161618] object-contain" />
      <div className="px-4 pb-[18px] pt-[14px]">
        <span className="text-[26px] font-medium leading-[1.2]">{item.name}</span>
        {groupLine ? <span className="mt-1 block text-[15px] text-[#9B9890]">{groupLine}</span> : null}
        {item.glass ? (
          <span className="mt-[9px] flex items-center gap-2 text-[#9B9890]">
            <GlassIcon type={glassType(item.glass)} size={22} className="shrink-0" />
            <span className="text-[15px]">{item.glass}</span>
          </span>
        ) : null}
      </div>
    </button>
  );
}

type GroupCardData = Extract<StationCard<BarItem>, { kind: "group" }>;

/** One quarter of the collage. A photo that fails to load leaves a blank dark tile and tells the collage, so it can tell when none loaded. */
function CollageTile({ item, onBroken }: { item: BarItem; onBroken: (id: string) => void }) {
  const { broken, ref, onError } = useBrokenPhoto();
  useEffect(() => {
    if (broken) onBroken(item.id);
  }, [broken, item.id, onBroken]);
  if (broken) return <div className="h-full w-full bg-[#161618]" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={barPhotoSrc(item.name, item.photo)} alt="" className="h-full w-full bg-[#161618] object-cover object-center" onError={onError} />;
}

/**
 * The photo area of a group card: up to four members' own photos (2 side by side, 3 as two over one, 4 as a 2 x 2), so it never
 * shows one flavour as if it were the whole group. A member without a photo is a blank dark tile; when no member has one the
 * area shows the glass icon, like the other cards without a picture.
 */
function GroupPhotos({ members }: { members: BarItem[] }) {
  const shown = members.slice(0, 4);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const mark = useCallback((id: string) => setBroken((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  if (shown.every((m) => broken.has(m.id)))
    return (
      <div className="flex h-[270px] w-full items-center justify-center bg-[#161618] text-[#8E8C85]">
        <GlassIcon type={glassType(members[0]?.glass)} size={72} />
      </div>
    );
  return (
    <div className={cx("grid h-[270px] w-full gap-[2px] overflow-hidden bg-[#0E0E10]", shown.length === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2")}>
      {shown.map((m, i) => (
        <div key={m.id} className={cx("min-h-0 min-w-0 overflow-hidden", shown.length === 3 && i === 2 && "col-span-2")}>
          <CollageTile item={m} onBroken={mark} />
        </div>
      ))}
    </div>
  );
}

/** A menu group on the grid: same size and style as a drink card, the group name, how many flavours, and a collage of their photos. */
function GroupCard({ card, onOpen }: { card: GroupCardData; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cx(CARD, "flex flex-col overflow-hidden text-left transition-transform duration-150 active:scale-[0.98] active:bg-[#232327] motion-reduce:transition-none motion-reduce:active:scale-100")}>
      <GroupPhotos members={card.members} />
      <div className="px-4 pb-[18px] pt-[14px]">
        <span className="text-[26px] font-medium leading-[1.2]">{card.name}</span>
        <span className="mt-[9px] flex items-center justify-between gap-2 text-[#9B9890]">
          <span className="text-[15px]">{flavourCount(card.members.length)}</span>
          <span aria-hidden className="text-[20px] leading-none">
            &#8250;
          </span>
        </span>
      </div>
    </button>
  );
}

/** The flavours of one menu group, as ordinary drink cards. Tapping one opens its recipe; Back from the recipe returns here. */
function GroupList({ card, onBack, onOpen, menu, now }: { card: GroupCardData; onBack: () => void; onOpen: (id: string) => void; menu: BarMenu | null; now: number }) {
  return (
    <div className="flex w-full flex-col">
      <BackBar label="BACK TO ALL DRINKS" onBack={onBack} />
      <StaleBanner syncedAt={menu?.syncedAt ?? null} now={now} />
      <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-7">
        <h1 className="font-display text-[52px] uppercase leading-none tracking-[0.5px]">{card.name}</h1>
        <p className="mb-5 mt-2 text-[16px] text-[#9B9890]">{flavourCount(card.members.length)}. Tap one for the recipe.</p>
        <div className="grid grid-cols-2 gap-[14px]">
          {card.members.map((m) => (
            <DrinkCard key={m.id} item={m} onOpen={() => onOpen(m.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
