"use client";

import { CalendarClock, CalendarX } from "lucide-react";
import { dealSummary } from "@/lib/deals";
import type { DealFeedRow } from "@/lib/insights";
import { money } from "@/lib/format";
import { Group, Row } from "@/components/ui";

/** Home Today rows for supplier deals: "Deals Ending" (still costing) and "Deal Expired" (already back on the base price). */
export function DealsFeed({ rows }: { rows: DealFeedRow[] }) {
  const ending = rows.filter((r) => r.kind === "deal_ending");
  const expired = rows.filter((r) => r.kind === "deal_expired");
  if (!rows.length) return null;
  return (
    <>
      {expired.length ? (
        <Group title={`Deal Expired · ${expired.length}`} className="mt-6" inset="3.75rem" footer="Costing is back on the base price. Update the price if the supplier has a new deal or price.">
          {expired.map((r) => (
            <Row
              key={r.deal.id}
              href={`/ingredients/${r.ingredient.id}`}
              leading={
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-soft text-danger">
                  <CalendarX className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </span>
              }
              title={r.ingredient.name}
              wrapSub
              sub={`${dealSummary(r.deal)} · back on ${money(r.ingredient.pack_price)} a pack`}
              chevron
            />
          ))}
        </Group>
      ) : null}
      {ending.length ? (
        <Group title={`Deals Ending · ${ending.length}`} className="mt-6" inset="3.75rem" footer="These stop costing on their end date and the base price comes back.">
          {ending.map((r) => (
            <Row
              key={r.deal.id}
              href={`/ingredients/${r.ingredient.id}`}
              leading={
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warn-soft text-warn">
                  <CalendarClock className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </span>
              }
              title={r.ingredient.name}
              wrapSub
              sub={`${dealSummary(r.deal)} · ${r.days === 0 ? "ends today" : r.days === 1 ? "ends tomorrow" : `ends in ${r.days} days`}`}
              chevron
            />
          ))}
        </Group>
      ) : null}
    </>
  );
}
