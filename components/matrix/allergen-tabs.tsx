"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import { allTodos, approvalCount } from "@/lib/matrix-todo";
import { allergenTabHref, ALLERGEN_TABS, type AllergenTab } from "@/lib/allergen-tabs";
import { useAllergenIndex } from "../allergen-picker";
import { cx } from "../ui";

/**
 * Allergens has ONE home in the menu (Troy, 10 Oct 2026: "this has to be as easy and simple to use"): this strip switches between
 * its three views, Matrix, To Do and Menu Labels, the same way Ingredients switches to Preps. 44px at every width, the venue choice
 * is carried across, and To Do carries the number of dishes waiting for approval so the strip itself says whether anything needs doing.
 */
export function AllergenTabs({ current, venueSlug }: { current: AllergenTab; venueSlug?: string | null }) {
  const store = useStore();
  const idx = useAllergenIndex();
  usePathname(); // re-render on navigation so the active tab follows
  const waiting = useMemo(() => {
    if (!store.ready) return 0;
    return allTodos(store.venues, store.items, idx, null)
      .filter((t) => !venueSlug || t.venue.slug === venueSlug)
      .reduce((n, t) => n + approvalCount(t), 0);
  }, [store.ready, store.venues, store.items, idx, venueSlug]);
  return (
    <nav aria-label="Allergens" className="mb-3 flex rounded-[12px] bg-fill p-[2px] print:hidden sm:max-w-md">
      {ALLERGEN_TABS.map((t) => {
        const on = t.id === current;
        return (
          <Link
            key={t.id}
            href={allergenTabHref(t.id, venueSlug)}
            aria-current={on ? "page" : undefined}
            className={cx(
              "flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 text-[15px] font-semibold transition-colors active:opacity-70",
              on ? "bg-surface text-label shadow-sm" : "text-label-2",
            )}
          >
            {t.label}
            {t.id === "todo" && waiting > 0 ? <span className="rounded-full bg-warn-soft px-1.5 text-[13px] font-semibold text-warn">{waiting}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
