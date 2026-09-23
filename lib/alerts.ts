import { priceMovePct } from "./costing";
import type { Ingredient, PriceLog } from "./types";

export interface PriceMove {
  log: PriceLog;
  ingredient: Ingredient | null;
  movePct: number;
}

/** Price log rows in the last `days` that moved more than `alertPct` (either direction). */
export function priceMoves(logs: PriceLog[], ingredients: Map<string, Ingredient>, alertPct: number, days = 30): PriceMove[] {
  const since = Date.now() - days * 86_400_000;
  const out: PriceMove[] = [];
  for (const log of logs) {
    const t = new Date(log.changed_at).getTime();
    if (Number.isNaN(t) || t < since) continue;
    const m = priceMovePct(log.old_price, log.new_price);
    if (m == null || Math.abs(m) <= alertPct) continue;
    out.push({ log, ingredient: ingredients.get(log.ingredient_id) ?? null, movePct: m });
  }
  out.sort((a, b) => new Date(b.log.changed_at).getTime() - new Date(a.log.changed_at).getTime());
  return out;
}
