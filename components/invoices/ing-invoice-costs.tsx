"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Ingredient } from "@/lib/types";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { computeIngredientCosts } from "@/lib/invoice-cost-stats";
import { loadIngredientInvoiceLines, type IngInvoiceLine } from "@/lib/invoice-data-extra";
import { COST_NOTE, costLines, countableLines, type IngDocLite } from "@/lib/invoice-ingredient-view";
import { invoiceSettingsFromRows } from "@/lib/invoice-settings-view";
import type { IngredientInvoiceCost } from "@/lib/invoice-types";

/**
 * "Cost From Invoices": what this ingredient last cost on a real invoice, with delivery and fees spread in (landed), and the
 * average over the look-back window. Sits under the price. It shows only when invoices name this ingredient, and says plainly that
 * recipes still cost on the price above. Any failure (no tables yet, no lines, a reading problem) draws nothing.
 */
export function IngInvoiceCosts({ ing }: { ing: Ingredient }) {
  const store = useStore();
  const averageDays = invoiceSettingsFromRows(store.rawSettings).averageDays;
  const [data, setData] = useState<{ lines: IngInvoiceLine[]; docs: Map<string, IngDocLite> } | null>(null);

  // reload when the price moves, so an invoice that just applied shows at once
  useEffect(() => {
    let live = true;
    void loadIngredientInvoiceLines(getSupabaseBrowser(), ing.id).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [ing.id, ing.pack_price, ing.last_price_update]);

  const view = useMemo(() => {
    if (!data) return null;
    try {
      const lines = countableLines(data.lines, ing.id);
      if (!lines.length) return null;
      const costs: IngredientInvoiceCost[] = computeIngredientCosts(lines, { averageDays }, store.today);
      return costLines(costs.find((c) => c.ingredient_id === ing.id), data.docs, store.today);
    } catch {
      return null;
    }
  }, [data, ing.id, averageDays, store.today]);

  if (!view || view.length === 0) return null;
  return (
    <section className="mt-4 rounded-3xl bg-surface p-5" aria-label="Cost from invoices">
      <h2 className="text-[13px] font-medium text-label-2">Cost From Invoices</h2>
      <ul className="mt-2 divide-y divide-[color:var(--separator)]">
        {view.map((l) => (
          <li key={l.key} className="flex min-h-[44px] items-center gap-3 py-2">
            <span className="min-w-0 flex-1 text-[17px] leading-snug tnum sm:text-[15px]">{l.text}</span>
            {l.documentId && l.key === "last" ? (
              <Link href={`/invoices/${l.documentId}`} className="inline-flex min-h-[44px] shrink-0 items-center gap-0.5 pl-2 text-[15px] font-medium text-accent">
                View Invoice
                <ChevronRight className="h-4 w-4" strokeWidth={2.5} aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-label-2">{COST_NOTE}</p>
    </section>
  );
}
