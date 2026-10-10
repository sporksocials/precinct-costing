"use client";

import React from "react";
import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import type { SetupModel } from "@/lib/finish-setup";
import { cx } from "../ui";

/** Scrolls to a section of the page (instant when the person asked for less motion) and briefly outlines it when it is marked data-flash. */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  // a section that asks for it (data-flash, the Allergens And Dietary card) is outlined for a moment so the eye finds it
  if (el.hasAttribute("data-flash")) {
    el.classList.add("ring-2", "ring-[color:var(--accent-fill)]");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-[color:var(--accent-fill)]"), 1600);
  }
}

/**
 * Finish Setting Up This Dish (lib/finish-setup.ts): the checklist at the top of a food dish's page until every step is done. Each
 * row is a 44px+ button that scrolls to its section; the first step not done is highlighted. It sits in the normal page flow, so it
 * never covers or moves the Save bar.
 */
export function FinishSetup({ model }: { model: SetupModel }) {
  if (model.complete) return null;
  return (
    <section aria-label="Finish setting up this dish" className="mt-5">
      <div className="flex items-baseline justify-between px-1 pb-1.5">
        <h2 className="text-[17px] font-semibold tracking-tight">Finish Setting Up This Dish</h2>
        <span className="text-[13px] text-label-2 tnum">
          {model.doneCount} of {model.steps.length} done
        </span>
      </div>
      <div className="group-list">
        {model.steps.map((s) => {
          const isNext = model.next === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.anchor)}
              aria-current={isNext ? "step" : undefined}
              className={cx("flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-fill hover:bg-fill", isNext && "bg-accent-soft")}
            >
              {s.done ? <CircleCheck aria-hidden className="h-[22px] w-[22px] shrink-0 text-good" strokeWidth={2.25} /> : <Circle aria-hidden className={cx("h-[22px] w-[22px] shrink-0", isNext ? "text-accent" : "text-label-3")} strokeWidth={2.25} />}
              <span className="min-w-0 flex-1">
                <span className={cx("block text-[17px] leading-snug sm:text-[15px]", s.done && "text-label-2", isNext && "font-semibold")}>{s.label}</span>
                <span className="block text-[13px] leading-snug text-label-2">{s.sub}</span>
              </span>
              {isNext ? <span className="shrink-0 text-[13px] font-semibold text-accent">Next</span> : null}
              <ChevronRight aria-hidden className="h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
