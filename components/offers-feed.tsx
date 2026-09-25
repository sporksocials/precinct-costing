"use client";

import { Tag } from "lucide-react";
import { useStore } from "@/lib/store";
import { gp, money } from "@/lib/format";
import { offerKindLabel, type OfferCost } from "@/lib/offers";
import type { Offer } from "@/lib/types";
import { VENUE_SHORT } from "./venue";
import { Group, Row } from "./ui";

/** Home Today: Live offers that have slipped below target (costs moved). Renders nothing when there are none. */
export function OffersFeed({ rows, showVenue }: { rows: { offer: Offer; cost: OfferCost }[]; showVenue: boolean }) {
  const store = useStore();
  if (!rows.length) return null;
  return (
    <Group title={`Offers Below Target · ${rows.length}`} className="mt-4" inset="3.75rem" footer="Live specials and combos whose GP fell under target after a cost change.">
      {rows.map(({ offer, cost }) => (
        <Row
          key={offer.id}
          href={`/specials/${offer.id}`}
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-soft text-danger">
              <Tag className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </span>
          }
          title={offer.name}
          sub={[showVenue ? VENUE_SHORT[store.venueById.get(offer.venue_id)?.slug ?? ""] : null, offerKindLabel(offer.kind), `${gp(cost.gpPct)} vs ${gp(cost.targetGp, 0)}`, money(cost.offerPriceInc)].filter(Boolean).join(" · ")}
          chevron
        />
      ))}
    </Group>
  );
}
