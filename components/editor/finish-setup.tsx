"use client";

import React from "react";
import { ChevronRight, Circle } from "lucide-react";
import type { SetupModel } from "@/lib/finish-setup";
import { cx } from "../ui";

/** Scrolls to a section of the page (instant when the person asked for less motion) and briefly outlines it when it is marked data-flash. */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  // a section that asks for it (data-flash, the Allergens And Dietary card and its Menu Labels block) is outlined for a moment so the eye finds it
  if (el.hasAttribute("data-flash")) {
    el.classList.add("ring-2", "ring-[color:var(--accent-fill)]");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-[color:var(--accent-fill)]"), 1600);
  }
}

/**
 * Finish Setting Up This Dish (lib/finish-setup.ts): a compact card at the top of a food dish's page until every step is done. It is ONE
 * short card (a five step progress strip and the next step as a single 52px button that scrolls to its section), so the ingredients stay
 * on the first screen of a phone; the page's sections already run in the checklist's own order (ingredients, allergens, Menu Labels,
 * method, Ready For Kitchen). It sits in the normal page flow, so it never covers or moves the bottom bar.
 */
export function FinishSetup({ model }: { model: SetupModel }) {
  if (model.complete) return null;
  const next = model.steps.find((s) => s.id === model.next) ?? model.steps[0];
  return (
    <section aria-label="Finish setting up this dish" className="mt-5">
      <div className="flex items-baseline justify-between px-1 pb-1.5">
        <h2 className="text-[17px] font-semibold tracking-tight">Finish Setting Up This Dish</h2>
        <span className="text-[13px] text-label-2 tnum">
          {model.doneCount} of {model.steps.length} done
        </span>
      </div>
      <div className="group-list">
        <div className="flex gap-1.5 px-4 pt-3" role="img" aria-label={`${model.doneCount} of ${model.steps.length} steps done`}>
          {model.steps.map((s) => (
            <span key={s.id} aria-hidden className={cx("h-1.5 flex-1 rounded-full", s.done ? "bg-good" : s.id === next.id ? "bg-accent-fill" : "bg-fill")} />
          ))}
        </div>
        <button type="button" onClick={() => scrollToSection(next.anchor)} aria-current="step" className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-fill active:bg-fill">
          <Circle aria-hidden className="h-[22px] w-[22px] shrink-0 text-accent" strokeWidth={2.25} />
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-snug sm:text-[15px]">
              <span className="text-accent">Next: </span>
              {next.label}
            </span>
            <span className="block text-[13px] leading-snug text-label-2">{next.sub}</span>
          </span>
          <ChevronRight aria-hidden className="h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} />
        </button>
      </div>
    </section>
  );
}
