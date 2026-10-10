"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { ingredientsToReview, type ReviewIngredient, type ReviewOptions } from "@/lib/ingredient-review";

/** The ingredients still waiting for their allergens to be checked, worked out live from the store (most dishes first). */
export function useIngredientsToReview(opts: ReviewOptions = {}): ReviewIngredient[] {
  const { items, allLines, ingredients, preps } = useStore();
  const dishId = opts.dishId ?? null;
  const venueId = opts.venueId ?? null;
  return useMemo(() => ingredientsToReview(items, allLines, ingredients, preps, { dishId, venueId }), [items, allLines, ingredients, preps, dishId, venueId]);
}
