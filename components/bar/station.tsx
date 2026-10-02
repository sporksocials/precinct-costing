"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { barPhotoSrc, glassType, ingredientDisplay, syncedLabel, type BarItem, type BarMenu } from "@/lib/bar";
import { cx } from "../ui";
import { GlassIcon } from "./glass-icon";

/** A reference photo that quietly disappears (no broken-image box, no orphaned caption) when this item has no file yet. */
function Photo({ name, className }: { name: string; className: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return <img src={barPhotoSrc(name)} alt="" className={className} onError={() => setBroken(true)} />;
}

function PhotoColumn({ name }: { name: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <div className="w-full text-center sm:w-[216px] sm:shrink-0">
      <img
        src={barPhotoSrc(name)}
        alt=""
        className="h-[260px] w-full rounded-[14px] border-[0.5px] border-white/10 object-cover sm:h-[460px]"
        onError={() => setBroken(true)}
      />
      <p className="mt-[6px] text-[12px] text-[#6E6C66]">Drink should look similar to this once finished</p>
    </div>
  );
}

/**
 * The cocktail station: one venue's cocktails on an iPad behind the bar, glanceable from about a metre away.
 * A port of the approved prototype (grid → one recipe full screen). No login; the iPad stays on this page,
 * so it refreshes its data in the background and drops back to the grid when left on a recipe.
 */

const IDLE_MS = 120_000; // back to the grid after 2 minutes untouched on a recipe
const REFRESH_MS = 5 * 60_000; // fetch the latest recipes every 5 minutes
const RETRY_MS = 30_000; // ...or every 30 seconds while the first load is failing

const CATS = [
  { key: "all", label: "All" },
  { key: "Cocktail", label: "Cocktails" },
  { key: "Mocktail", label: "Mocktails" },
] as const;
type CatKey = (typeof CATS)[number]["key"];

const CARD = "rounded-2xl border-[0.5px] border-white/[0.08] bg-[#1C1C1F]";
const ROW = "border-t-[0.5px] border-white/[0.07]";
const HEADING = "text-[15px] font-medium tracking-[0.5px] text-[#9B9890]";

export function BarStation({ slug, venueName, initial }: { slug: string; venueName: string; initial: BarMenu | null }) {
  const [menu, setMenu] = useState<BarMenu | null>(initial);
  const [view, setView] = useState<"grid" | "detail">("grid");
  const [activeCategory, setActiveCategory] = useState<CatKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const gridScroll = useRef(0);

  // ---------- background refresh (keeps the last good copy when the network drops) ----------
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/bar/${slug}`, { cache: "no-store" });
      if (!res.ok) return;
      setMenu((await res.json()) as BarMenu);
    } catch {
      // offline: keep showing what we have; "Synced … ago" tells the truth
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
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const items = useMemo(() => menu?.items ?? [], [menu]);
  const selected = items.find((c) => c.id === selectedId) ?? null;

  // ---------- views ----------
  const openCocktail = (id: string) => {
    gridScroll.current = window.scrollY;
    (document.activeElement as HTMLElement | null)?.blur?.(); // put the iPad keyboard away
    setSelectedId(id);
    setView("detail");
  };
  const goBack = useCallback(() => setView("grid"), []);

  useLayoutEffect(() => {
    window.scrollTo(0, view === "detail" ? 0 : gridScroll.current);
  }, [view]);

  // a recipe that disappears in a refresh (deleted, made inactive) sends the screen back to the grid
  useEffect(() => {
    if (view === "detail" && !selected) setView("grid");
  }, [view, selected]);

  // idle auto-return: any touch, scroll or key on a recipe restarts the 2 minute clock; leaving the recipe clears it
  useEffect(() => {
    if (view !== "detail") return;
    let t = window.setTimeout(goBack, IDLE_MS);
    const reset = () => {
      window.clearTimeout(t);
      t = window.setTimeout(goBack, IDLE_MS);
    };
    const events = ["pointerdown", "touchstart", "wheel", "scroll", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [view, goBack]);

  // ---------- grid filtering (search covers every category and hides the chips) ----------
  const query = searchQuery.trim().toLowerCase();
  const hasSearch = query.length > 0;
  const tiles = hasSearch ? items.filter((c) => c.name.toLowerCase().includes(query)) : activeCategory === "all" ? items : items.filter((c) => c.category === activeCategory);

  return (
    <div className={cx(`bar-${slug}`, "bar-root flex min-h-[100dvh] w-full flex-col bg-[#0E0E10] text-[#F5F3EE]")}>
      {view === "detail" && selected ? (
        <Detail item={selected} onBack={goBack} />
      ) : (
        <div className="flex w-full flex-col">
          <div className="mx-auto w-full max-w-[1000px] px-6 pb-[18px] pt-[calc(28px+env(safe-area-inset-top))]">
            <Link href="/bar" className="inline-flex min-h-[32px] items-center gap-[6px] text-[14px] font-medium text-[color:var(--bar-accent)]">
              <span aria-hidden className="text-[16px] leading-none">
                &#8592;
              </span>
              All Venues
            </Link>
            <div className="mt-[6px] flex items-baseline justify-between gap-4">
              <h1 className="font-display text-[48px] uppercase leading-none tracking-[1px]">{menu?.venue.name ?? venueName}</h1>
              {menu ? (
                <p className="shrink-0 text-[13px] text-[#9B9890]" aria-live="polite">
                  {syncedLabel(menu.syncedAt, now)}
                </p>
              ) : null}
            </div>
            <p className="mt-[2px] text-[16px] text-[#9B9890]">Cocktail Station</p>

            {items.length ? (
              <>
                <div className="relative mt-4">
                  <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6E6C66" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2">
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
                    placeholder="Search cocktails"
                    aria-label="Search Cocktails"
                    enterKeyHint="search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="h-[58px] w-full rounded-[14px] border-[0.5px] border-white/10 bg-[#1C1C1F] px-[50px] text-[19px] text-[#F5F3EE] outline-none placeholder:text-[#6E6C66] focus:border-white/25"
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

                {!hasSearch ? (
                  <div className="mt-[14px] flex flex-wrap gap-2" role="group" aria-label="Category">
                    {CATS.map((cat) => {
                      const on = cat.key === activeCategory;
                      return (
                        <button
                          key={cat.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setActiveCategory(cat.key)}
                          className={cx(
                            "min-h-[40px] rounded-full px-[17px] py-[10px] text-[15px] font-medium leading-[20px]",
                            on ? "bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "border-[0.5px] border-white/[0.18] bg-transparent text-[#F5F3EE]",
                          )}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-1">
            {!menu ? (
              <EmptyState title="Can’t Load Recipes" body="Check the iPad’s Wi-Fi. This screen tries again every 30 seconds." action={{ label: "Try Again", onClick: () => void refresh() }} />
            ) : !items.length ? (
              <EmptyState title="No Cocktails Added Yet" body="A cocktail shows here once it has a glass, method or garnish in Precinct Costing." />
            ) : !tiles.length ? (
              hasSearch ? (
                <EmptyState title="No Matches" body={`Nothing matches “${searchQuery.trim()}”.`} />
              ) : (
                <EmptyState title={activeCategory === "Mocktail" ? "No Mocktails Added Yet" : "No Cocktails Added Yet"} />
              )
            ) : (
              <div className="grid grid-cols-2 gap-[14px]">
                {tiles.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openCocktail(c.id)}
                    className={cx(CARD, "flex flex-col overflow-hidden text-left transition-transform duration-150 active:scale-[0.98] active:bg-[#232327]")}
                  >
                    <Photo name={c.name} className="h-[230px] w-full object-cover" />
                    <div className="px-4 pb-[18px] pt-[14px]">
                      <span className="text-[26px] font-medium leading-[1.2]">{c.name}</span>
                      {c.glass ? (
                        <span className="mt-[9px] flex items-center gap-2 text-[#9B9890]">
                          <GlassIcon type={glassType(c.glass)} size={22} className="shrink-0" />
                          <span className="text-[15px]">{c.glass}</span>
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; onClick: () => void } }) {
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

function Detail({ item, onBack }: { item: BarItem; onBack: () => void }) {
  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-[calc(84px+env(safe-area-inset-top))] w-full items-center justify-center gap-[14px] bg-[color:var(--bar-accent)] px-5 pb-6 pt-[calc(24px+env(safe-area-inset-top))] text-[28px] font-bold leading-tight text-[color:var(--bar-on)] active:opacity-90"
      >
        <span aria-hidden className="text-[34px] font-bold leading-none">
          &#8592;
        </span>
        BACK TO ALL COCKTAILS
      </button>

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
                    const d = ingredientDisplay(line);
                    return (
                      <li key={i} className={cx(ROW, "flex items-start gap-[14px] py-[14px]")}>
                        <div className="w-[112px] shrink-0">
                          {d.shots ? (
                            <>
                              <p className="text-[30px] font-medium leading-[1.1] text-[#D9C3A0]">{d.shots}</p>
                              <p className="mt-[2px] text-[13px] text-[#6E6C66]">{d.qty}</p>
                            </>
                          ) : (
                            <p className="text-[27px] font-medium leading-[1.15] text-[#D9C3A0]">{d.plain}</p>
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
          <PhotoColumn name={item.name} />
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
