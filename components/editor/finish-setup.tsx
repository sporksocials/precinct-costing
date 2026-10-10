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
  // a section that asks for it (data-flash, the Allergens And Dietary card and its Menu Labels block) is outlined for a moment so the eye finds it
  if (el.hasAttribute("data-flash")) {
    el.classList.add("ring-2", "ring-[color:var(--accent-fill)]");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-[color:var(--accent-fill)]"), 1600);
  }
}

/**
 * Finish Setting Up This Dish (lib/finish-setup.ts): a short card at the top of a food dish's page until every step is done. All five
 * steps are listed and any of them can be tapped to jump to its section (Troy, 10 Oct 2026); rows are 48px, the next step is marked
 * and is the only one that shows its one line of help, so the card stays about half the height of the first version and the
 * ingredients still show on the first phone screen. It sits in the normal page flow, so it never covers or moves the bottom bar.
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
      <ul className="group-list divide-y divide-[color:var(--separator)]">
        {model.steps.map((s) => {
          const isNext = s.id === model.next;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => scrollToSection(s.anchor)}
                aria-current={isNext ? "step" : undefined}
                className={cx("flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-fill active:bg-fill", isNext && "bg-fill")}
              >
                {s.done ? <CircleCheck aria-hidden className="h-[22px] w-[22px] shrink-0 text-good" strokeWidth={2.25} /> : <Circle aria-hidden className="h-[22px] w-[22px] shrink-0 text-label-3" strokeWidth={2.25} />}
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-[17px] leading-snug sm:text-[15px]", s.done ? "text-label-2" : "font-semibold")}>{s.label}</span>
                  {isNext ? <span className="block text-[13px] leading-snug text-label-2">{s.sub}</span> : null}
                </span>
                {isNext ? <span className="text-[13px] font-semibold text-accent">Next</span> : null}
                <ChevronRight aria-hidden className="h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
