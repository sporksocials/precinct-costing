"use client";

import { useState } from "react";
import type { AllergenDisplay } from "@/lib/kitchen-model";
import { isStale, staleAge } from "@/lib/bar";
import { ALLERGEN_NOTICE } from "@/lib/allergens";
import { cx } from "../ui";

/** Pieces shared by the kitchen station's grid and detail screens: the same look as the cocktail station (components/bar/station.tsx). */

export const CARD = "rounded-2xl border-[0.5px] border-white/[0.08] bg-[#1C1C1F]";
export const ROW = "border-t-[0.5px] border-white/[0.07]";
export const HEADING = "text-[15px] font-medium tracking-[0.5px] text-[#9B9890]";

/** Shown only when the recipes on screen are 15+ minutes old (Wi-Fi down, server unreachable). Big on purpose: a cook must know before trusting a weight. */
export function StaleBanner({ syncedAt, now }: { syncedAt: string | null; now: number }) {
  if (!syncedAt || !isStale(syncedAt, now)) return null;
  return (
    <div role="alert" className="border-y-[0.5px] border-[#F2C46D]/40 bg-[#2B2210] px-6 py-4 text-center">
      <p className="text-[20px] font-semibold leading-tight text-[#F2C46D]">Recipes May Be Out Of Date</p>
      <p className="mt-1 text-[18px] leading-snug text-[#F2C46D]">Last updated {staleAge(syncedAt, now)}. Check the iPad&rsquo;s Wi-Fi. This screen keeps trying.</p>
    </div>
  );
}

/** Full-bleed bar across the top of a detail screen: the whole width is the Back target (gloves, an iPad across the pass). */
export function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex min-h-[calc(84px+env(safe-area-inset-top))] w-full items-center justify-center gap-[14px] bg-[color:var(--bar-accent)] px-5 pb-6 pt-[calc(24px+env(safe-area-inset-top))] text-[22px] font-bold leading-tight text-[color:var(--bar-on)] active:opacity-90 sm:text-[28px]"
    >
      <span aria-hidden className="text-[34px] font-bold leading-none">
        &#8592;
      </span>
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

export function Chevron({ className }: { className?: string }) {
  return (
    <svg aria-hidden width="14" height="22" viewBox="0 0 14 22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3,3 11,11 3,19" />
    </svg>
  );
}

/** A plate with a fork and knife: stands in where a dish has no photo yet. */
export function PlateIcon({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="24" cy="24" r="10.5" />
      <circle cx="24" cy="24" r="6.5" />
      <path d="M7 10v8a3 3 0 0 0 3 3v17M13 10v11M10 10v11" />
      <path d="M41 38V10c-3 2-4.500 6-4.500 11 0 2 1 3 2.500 3h2" />
    </svg>
  );
}

/** A dish photo for a grid tile. Without one (or if it fails to load) a plain plate block keeps every tile the same height. */
export function TilePhoto({ src, className }: { src: string | null; className: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    // plain <img>: the iPad's offline cache holds these exact files (next/image would route through the optimiser instead)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cx(className, "object-cover")} onError={() => setBroken(true)} />;
  }
  return (
    <div aria-hidden className={cx(className, "flex flex-col items-center justify-center gap-2 bg-[#232327] text-[#8E8C85]")}>
      <PlateIcon />
      <span className="text-[15px]">No photo yet</span>
    </div>
  );
}

/** The plated photo beside the components (stacked above them on a phone). Quietly absent when the dish has no photo or it won't load. */
export function PhotoColumn({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <div className="w-full text-center sm:w-[280px] sm:shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-[260px] w-full rounded-[14px] border-[0.5px] border-white/10 object-cover sm:h-[360px]" onError={() => setBroken(true)} />
      <p className="mt-[6px] text-[14px] text-[#8E8C85]">Plate it to look like this</p>
    </div>
  );
}

/* ------------------------------------------------------------------ allergens */

const CHIP = "rounded-full border-[0.5px] px-[11px] py-[5px] font-medium";
const CONTAINS_CHIP = "border-[#FF7A8A]/40 bg-[#2E1F23] text-[#FFB3BC]";
const AMBER_CHIP = "border-[#F2C46D]/40 bg-[#2B2210] text-[#F2C46D]";
const DIET_CHIP = "border-[#8FD9A4]/40 bg-[#172619] text-[#8FD9A4]";

/**
 * The allergen line on a grid tile: what the dish contains, or the amber "Allergens Not Reviewed" chip when any ingredient
 * hasn't been checked. A recipe is only ever called clear when every ingredient has been reviewed (see AllergenDisplay.none).
 */
export function AllergenChips({ a }: { a: AllergenDisplay }) {
  return (
    <ul className="flex flex-wrap items-center gap-[6px]" aria-label="Allergens">
      {a.contains.length ? <li className="mr-[2px] text-[16px] text-[#9B9890]">Contains</li> : null}
      {a.contains.map((l) => (
        <li key={l} className={cx(CHIP, CONTAINS_CHIP, "text-[16px] leading-[20px]")}>
          {l}
        </li>
      ))}
      {a.notReviewed ? <li className={cx(CHIP, AMBER_CHIP, "text-[16px] leading-[20px]")}>Allergens Not Reviewed</li> : null}
      {a.none ? <li className="text-[16px] text-[#9B9890]">No allergens listed</li> : null}
    </ul>
  );
}

/** The allergen block at the foot of a dish or prep. The notice sits under it every time. */
export function AllergenCard({ a }: { a: AllergenDisplay }) {
  return (
    <section className={cx(CARD, "mt-4 px-[22px] py-5")}>
      <h2 className={cx(HEADING, "mb-3")}>ALLERGENS</h2>

      {a.notReviewed ? (
        <div role="note" className="mb-4 rounded-xl border-[0.5px] border-[#F2C46D]/40 bg-[#2B2210] px-4 py-4">
          <p className="text-[24px] font-semibold leading-tight text-[#F2C46D]">Allergens Not Reviewed &ndash; check with the chef</p>
          {a.unreviewed.length ? <p className="mt-2 text-[18px] leading-snug text-[#F2C46D]">Not yet checked: {a.unreviewed.join(", ")}.</p> : null}
        </div>
      ) : null}

      {a.contains.length ? (
        <div className="mb-3">
          <p className="mb-2 text-[18px] font-medium text-[#9B9890]">Contains:</p>
          <ul className="flex flex-wrap gap-2">
            {a.contains.map((l) => (
              <li key={l} className={cx(CHIP, CONTAINS_CHIP, "text-[20px] leading-[26px]")}>
                {l}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {a.may.length ? (
        <div className="mb-3">
          <p className="mb-2 text-[18px] font-medium text-[#9B9890]">May contain (unconfirmed):</p>
          <ul className="flex flex-wrap gap-2">
            {a.may.map((l) => (
              <li key={l} className={cx(CHIP, AMBER_CHIP, "text-[20px] leading-[26px]")}>
                {l}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {a.none ? <p className="mb-3 text-[22px] leading-snug">No allergens listed</p> : null}

      {a.notes.length ? (
        <ul className="mb-3 space-y-1">
          {a.notes.map((n) => (
            <li key={n.label} className="text-[18px] leading-snug text-[#F5F3EE]">
              <span className="font-medium">{n.label}:</span> {n.note}
            </li>
          ))}
        </ul>
      ) : null}

      {a.diet.length ? (
        <ul className="mb-3 flex flex-wrap gap-2" aria-label="Diet">
          {a.diet.map((l) => (
            <li key={l} className={cx(CHIP, DIET_CHIP, "text-[20px] leading-[26px]")}>
              {l}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[16px] leading-snug text-[#9B9890]">{ALLERGEN_NOTICE}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ lists */

/** Numbered steps, one per row, top-aligned: a kitchen step is often a full sentence, not a one-liner. */
export function Steps({ title, steps, circle }: { title: string; steps: string[]; circle: string }) {
  if (!steps.length) return null;
  return (
    <section className={cx(CARD, "mt-4 px-[22px] py-5")}>
      <h2 className={cx(HEADING, "mb-1")}>{title}</h2>
      <ol>
        {steps.map((text, i) => (
          <li key={i} className={cx(ROW, "flex items-start gap-[18px] py-[18px]")}>
            <span aria-hidden className={cx("mt-[1px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px] font-medium", circle)}>
              {i + 1}
            </span>
            <span className="min-w-0 text-[24px] font-medium leading-[1.3]">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={cx(CARD, "mt-2 px-6 py-14 text-center")}>
      <p className="text-[26px] font-medium leading-[1.2]">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-[460px] text-[18px] leading-snug text-[#9B9890]">{body}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-6 min-h-[56px] rounded-full bg-[color:var(--bar-accent)] px-7 text-[19px] font-semibold text-[color:var(--bar-on)]">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
