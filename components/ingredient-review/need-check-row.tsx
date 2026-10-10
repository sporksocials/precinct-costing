"use client";

import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { needsCheckText } from "@/lib/ingredient-review";
import { useIngredientsToReview } from "./use-review-queue";

/**
 * The quiet row at the top of the Ingredients list: how many ingredients that active Food dishes use still need their allergens
 * checked, and a way into /allergens/review. Shown only when the count is above zero.
 */
export function IngredientsNeedCheckRow() {
  const { ready } = useStore();
  const waiting = useIngredientsToReview();
  const text = ready ? needsCheckText(waiting.length) : null;
  if (!text) return null;
  return (
    <Link
      href="/allergens/review"
      className="mb-3 flex min-h-[44px] items-center gap-2.5 rounded-2xl bg-warn-soft px-4 py-2.5 text-[15px] font-medium text-warn active:opacity-70"
    >
      <TriangleAlert aria-hidden className="h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
      <span className="min-w-0 flex-1">{text}</span>
      <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold">
        Check Them
        <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={2.5} />
      </span>
    </Link>
  );
}
