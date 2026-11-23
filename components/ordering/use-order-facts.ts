"use client";

import { useMemo } from "react";
import { factsFrom, type FactsOf } from "@/lib/ordering-facts";
import { useStore } from "@/lib/store";

/**
 * The facts of an order item (its price, GST, free-unit deal and whether it still needs an ingredient), worked out from the
 * loaded costing data by lib/ordering-facts.ts. Every order screen and the Setup > Products list read prices through this, so
 * a price is typed once, on the ingredient. An item whose ingredient is not in the loaded list reads as its stored values.
 */
export function useOrderFacts(): FactsOf {
  const { ingredients, dealsByIngredient, settings, today } = useStore();
  return useMemo(() => {
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    return factsFrom({ ingredientById: (id) => byId.get(id), dealsFor: (id) => dealsByIngredient.get(id), gstRate: settings.gst_rate, today });
  }, [ingredients, dealsByIngredient, settings.gst_rate, today]);
}
