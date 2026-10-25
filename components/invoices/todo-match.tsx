"use client";

import { useMemo } from "react";
import { itemsToMatch, onInvoices, supplierCards, useMatchGroups } from "@/lib/invoice-todo-match";
import { TouchLink } from "@/components/ordering/touch";

/**
 * To Do > Match Items: one card per supplier with items the app does not know yet, the supplier with the most first. The button
 * opens that supplier's items, where each is matched once for every invoice and every venue. Shows nothing while loading, when
 * the invoice tables are missing or anything fails, and when there is nothing to match (the To Do panel says that in its own words).
 * `venue` is a venue slug, or null for all venues.
 */
export function MatchItemsSection({ venue }: { venue: string | null }) {
  const { groups, available, error } = useMatchGroups(venue);
  const cards = useMemo(() => (groups ? supplierCards(groups) : []), [groups]);
  if (!groups || !available || error || cards.length === 0) return null;

  return (
    <section aria-labelledby="todo-match-title">
      <h2 id="todo-match-title" className="px-1 text-[20px] font-semibold leading-snug">
        Match Items
      </h2>
      <p className="px-1 pb-2 pt-0.5 text-[15px] leading-snug text-label-2">Tell the app what each supplier item is, once. It remembers.</p>
      <ul className="flex flex-col gap-3">
        {cards.map((c) => (
          <li key={c.param} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-[17px] font-semibold leading-snug">{c.name}</p>
              <p className="mt-0.5 text-[15px] text-label-2">
                {itemsToMatch(c.items)}
                <span className="text-label-3"> · </span>
                {onInvoices(c.invoices)}
              </p>
            </div>
            <TouchLink href={`/invoices/match/${c.param}`} variant="primary" className="min-h-[48px] w-full sm:w-auto" aria-label={`Match items for ${c.name}`}>
              Match Items
            </TouchLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
