"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { bottleMl, bottleSizeText, premixLineDisplay, premixUseDisplay, type BarPremix, type Premix } from "@/lib/bar-premix";
import { syncedLabel } from "@/lib/bar";
import { cx } from "../ui";
import { BottleIcon } from "./glass-icon";
import { CARD, EmptyState, HEADING, IDLE_MS, REFRESH_MS, RETRY_MS, ROW, StaleBanner } from "./station";

/**
 * Pre-Mix Bottles: the drink pre-mixes the bar makes before service, one card per 700 ml bottle. Opens from the "Pre-Mix Bottles"
 * row on the drinks station and works the same way: no login, refreshes in the background every 5 minutes, keeps the last good
 * copy when the Wi-Fi drops (the service worker holds the page and its data), and drops back to the station after 2 minutes untouched.
 */
export function BarPremixPage({ slug, venueName, initial }: { slug: string; venueName: string; initial: BarPremix | null }) {
  const router = useRouter();
  const [data, setData] = useState<BarPremix | null>(initial);
  // starts at the copy's own timestamp so the server HTML and the first client render agree; the effect below moves it to the real time
  const [now, setNow] = useState(() => (initial ? Date.parse(initial.syncedAt) : 0));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/bar/${slug}/premix`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as BarPremix;
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

  // idle auto-return to the drinks grid: any touch, scroll or key restarts the 2 minute clock
  useEffect(() => {
    const goBack = () => router.push(`/bar/${slug}`);
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
  }, [router, slug]);

  const premixes = data?.premixes ?? [];

  return (
    <div className={cx(`bar-${slug}`, "bar-root flex min-h-[100dvh] w-full flex-col bg-[#0E0E10] text-[#F5F3EE]")}>
      <Link
        href={`/bar/${slug}`}
        className="flex min-h-[calc(84px+env(safe-area-inset-top))] w-full items-center justify-center gap-[14px] bg-[color:var(--bar-accent)] px-5 pb-6 pt-[calc(24px+env(safe-area-inset-top))] text-[28px] font-bold leading-tight text-[color:var(--bar-on)] active:opacity-90"
      >
        <span aria-hidden className="text-[34px] font-bold leading-none">
          &#8592;
        </span>
        BACK TO ALL DRINKS
      </Link>
      <StaleBanner syncedAt={data?.syncedAt ?? null} now={now} />

      <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-7">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-[52px] leading-none tracking-[0.5px]">PRE-MIX BOTTLES</h1>
          {data ? (
            <p className="shrink-0 text-[13px] text-[#9B9890]" aria-live="polite">
              {syncedLabel(data.syncedAt, now)}
            </p>
          ) : null}
        </div>
        <p className="mt-[6px] text-[18px] leading-snug text-[#9B9890]">{data?.venue.name ?? venueName}. Made up before service and labelled with the drink.</p>

        {!data ? (
          <div className="mt-6">
            <EmptyState title="Can’t Load Pre-Mixes" body="Check the iPad’s Wi-Fi. This screen tries again every 30 seconds." action={{ label: "Try Again", onClick: () => void refresh() }} />
          </div>
        ) : !premixes.length ? (
          <div className="mt-6">
            <EmptyState title="No Pre-Mixes Added Yet" body="A pre-mix shows here once it is added in Precinct Costing." />
          </div>
        ) : (
          <>
            {premixes.length > 3 ? (
              <nav aria-label="Jump to a pre-mix" className="mt-5 flex flex-wrap gap-2">
                {premixes.map((p) => (
                  <a key={p.id} href={`#${anchorId(p)}`} className="inline-flex min-h-[44px] items-center rounded-full border-[0.5px] border-white/[0.18] px-[17px] text-[16px] font-medium text-[#F5F3EE] active:bg-[#232327]">
                    {shortName(p.name)}
                  </a>
                ))}
              </nav>
            ) : null}
            <div className="mt-5 grid gap-4">
              {premixes.map((p) => (
                <PremixCard key={p.id} premix={p} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "Bulcock Banger Pre-Mix" reads "Bulcock Banger" in the jump chips: every card is a pre-mix, so the suffix adds nothing there. */
function shortName(name: string): string {
  return name.replace(/\s+pre-?mix$/i, "").trim() || name;
}

function anchorId(p: Premix): string {
  return `premix-${p.id}`;
}

function PremixCard({ premix: p }: { premix: Premix }) {
  const bottle = bottleMl(p);
  const size = bottleSizeText(p);
  return (
    <section id={anchorId(p)} className={cx(CARD, "scroll-mt-4 px-5 py-5")}>
      <div className="flex items-start gap-4">
        <BottleIcon size={40} className="mt-[2px] shrink-0 text-[color:var(--bar-text)]" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[40px] leading-[1.02] tracking-[0.5px]">{p.name}</h2>
          {size ? <p className="mt-[6px] text-[20px] font-medium text-[color:var(--bar-text)]">{size}</p> : null}
        </div>
      </div>

      {p.lines.length ? (
        <div className="mt-4">
          <h3 className={cx(HEADING, "mb-1 uppercase")}>Ingredients</h3>
          <ul>
            {p.lines.map((l, i) => {
              const d = premixLineDisplay(l);
              return (
                <li key={i} className={cx(ROW, "flex items-start gap-[14px] py-[13px]")}>
                  <div className="w-[128px] shrink-0">
                    <p className="text-[30px] font-medium leading-[1.1] text-[#D9C3A0]">{d.amount}</p>
                    {d.shots ? <p className="mt-[2px] text-[15px] text-[#9B9890]">{d.shots}</p> : null}
                  </div>
                  <p className="min-w-0 pt-[2px] text-[24px] leading-[1.2] [overflow-wrap:anywhere] sm:text-[27px]">{d.name}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className={cx(HEADING, "mb-1 uppercase")}>Used In</h3>
        {p.usedIn.length ? (
          <ul>
            {p.usedIn.map((u, i) => {
              const d = premixUseDisplay(u, bottle);
              return (
                <li key={i} className={cx(ROW, "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-[13px]")}>
                  <p className="min-w-0 text-[26px] leading-[1.2]">{d.drink}</p>
                  <p className="ml-auto text-right">
                    <span className="text-[26px] font-medium text-[#D9C3A0]">{d.pour}</span>
                    {d.serves ? <span className="block text-[15px] text-[#9B9890]">{d.serves}</span> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={cx(ROW, "pt-3 text-[18px] text-[#9B9890]")}>Not used in a drink yet.</p>
        )}
      </div>
    </section>
  );
}
