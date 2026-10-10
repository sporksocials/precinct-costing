"use client";

import React from "react";
import { CircleCheck, ShieldCheck, TriangleAlert } from "lucide-react";
import type { SignOffState } from "@/lib/dish-allergens";
import { cx } from "../ui";

/** The id of the shared card; the Finish Setting Up rows and the post-save nudge scroll to it. */
export const SAFETY_CARD_ID = "allergens-dietary";

/**
 * The shared food safety card on a food dish (Troy, 10 Oct 2026): Dish Allergens and Menu Labels (the GF, V, VG marks and the GFO, VO, VGO, DFO options) sit together in
 * ONE card, "Allergens And Dietary", on a slightly tinted background with a quiet border, so it reads as its own important section.
 * Only existing tokens: the venue accent's soft tint (`bg-accent-soft`) and the separator line. Nothing in it is collapsed.
 * The header answers "is this section done?" in words, an icon and the existing status colours (never colour alone).
 */
export function SafetyCard({ status, children, className }: { status: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={SAFETY_CARD_ID} data-flash aria-labelledby="safety-card-title" className={cx("scroll-mt-20 rounded-2xl border border-[color:var(--separator)] bg-accent-soft transition-shadow duration-300", className)}>
      <header className="px-4 pb-3 pt-4">
        <h2 id="safety-card-title" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
          <ShieldCheck aria-hidden className="h-5 w-5 text-accent" strokeWidth={2.25} />
          Allergens And Dietary
        </h2>
        <div className="mt-1.5">{status}</div>
      </header>
      <div className="divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">{children}</div>
    </section>
  );
}

/**
 * One block inside the card. Both blocks use the same heading, the same one-line explanation, the same spacing and the same
 * footer helper text, so they read as siblings. Children manage their own side padding (toggle rows and chip areas use px-4).
 */
export function SafetyBlock({ id, title, explain, trailing, footer, children }: { id?: string; title: string; explain: string; trailing?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div id={id} data-flash={id ? "" : undefined} className={cx("pb-4 pt-4", id && "scroll-mt-20 transition-shadow duration-300")}>
      <div className="px-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-label-2">{explain}</p>
      </div>
      <div className="mt-3 divide-y divide-[color:var(--separator)]">{children}</div>
      {footer ? <p className="mt-2 px-4 text-[13px] leading-snug text-label-2">{footer}</p> : null}
    </div>
  );
}

/** The header status line: icon + words + colour. "Allergens Confirmed" (by and date), "Not Confirmed Yet", or "Re-check Needed: ingredients changed". */
export function SafetyStatus({ state, detail }: { state: SignOffState; detail?: string | null }) {
  const ok = state === "valid";
  const recheck = state === "changed" || state === "legacy";
  const word = ok ? "Allergens Confirmed" : recheck ? "Re-check Needed: ingredients changed" : "Not Confirmed Yet";
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <div role="status">
      <p className={cx("flex items-center gap-1.5 text-[15px] font-semibold sm:text-[13px]", ok ? "text-good" : "text-warn")}>
        <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
        {word}
      </p>
      {detail ? <p className="mt-0.5 pl-[22px] text-[13px] leading-snug text-label-2">{detail}</p> : null}
    </div>
  );
}
