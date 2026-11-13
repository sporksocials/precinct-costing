"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useVenue } from "@/components/venue";
import { cx } from "@/components/ui";

export const CHEAT_SHEET_LABEL = "Print Cheat Sheet";
export const CHEAT_SHEET_NEEDS_VENUE = "Choose a venue first";

/** The preview address for one venue's Kitchen Cheat Sheet. */
export const cheatSheetHref = (slug: string): string => `/print/cheat-sheet?venue=${encodeURIComponent(slug)}`;

/**
 * Print Cheat Sheet: one quiet plain button on the Menu page, beside Download POS List. The cheat sheet is one venue's food
 * pass sheet, so it needs a venue: with a venue tile chosen it opens that venue's print preview; with All chosen it stays
 * visible but disabled, with the reason written beside it. 44px at every width.
 */
export function CheatSheetButton({ className }: { className?: string }) {
  const { venue } = useVenue();
  const base = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-[15px] font-semibold transition";
  if (!venue) {
    return (
      <span className={cx("inline-flex flex-wrap items-center gap-x-2", className)}>
        <button type="button" disabled aria-describedby="cheat-sheet-why" className={cx(base, "text-accent opacity-40")}>
          <Printer className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
          {CHEAT_SHEET_LABEL}
        </button>
        <span id="cheat-sheet-why" className="text-[13px] text-label-2">
          {CHEAT_SHEET_NEEDS_VENUE}
        </span>
      </span>
    );
  }
  return (
    <Link href={cheatSheetHref(venue.slug)} className={cx(base, "text-accent active:opacity-70", className)}>
      <Printer className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
      {CHEAT_SHEET_LABEL}
    </Link>
  );
}
