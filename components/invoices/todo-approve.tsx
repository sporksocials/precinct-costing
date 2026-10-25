"use client";

import { approveSummary } from "@/lib/invoice-todo-approve";
import { TouchLink } from "@/components/ordering/touch";
import { useApprovePrices } from "./approve-use-data";

/**
 * To Do > Approve Prices: one card that says how many prices changed and how many are small, with one big button to the list.
 * Renders nothing while loading, when nothing is waiting, or when the invoice tables cannot be read (the To Do page then simply
 * has no card). `venue` is a venue slug, or null for all venues.
 */
export function ApprovePricesSection({ venue }: { venue: string | null }) {
  const { data } = useApprovePrices(venue);
  if (!data || data.missing || data.rows.length === 0) return null;
  const href = venue ? `/invoices/approve?venue=${venue}` : "/invoices/approve";
  return (
    <section aria-labelledby="todo-approve">
      <h2 id="todo-approve" className="px-1 pb-2 text-[22px] font-bold tracking-tight">
        Approve Prices
      </h2>
      <div className="rounded-2xl bg-surface px-4 py-4">
        <p className="text-[17px] leading-snug sm:text-[15px]">{approveSummary(data.rows, data.limit)}</p>
        <TouchLink href={href} variant="primary" className="mt-3 w-full !min-h-[48px] sm:w-auto">
          Review Prices
        </TouchLink>
      </div>
    </section>
  );
}
