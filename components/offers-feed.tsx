"use client";

import { AlertTriangle, Tag } from "lucide-react";
import { useStore } from "@/lib/store";
import { gp, money } from "@/lib/format";
import { offerKindLabel, type OfferCost } from "@/lib/offers";
import type { Offer } from "@/lib/types";
import { VENUE_SHORT } from "./venue";
import { Group, Row } from "./ui";

type OfferRow = { offer: Offer; cost: OfferCost };

/**
 * Home Today: Live offers that have slipped below target (costs moved), and live offers whose components need checking
 * (no GP is claimed for those). Renders nothing when there are none.
 */
export function OffersFeed({ rows, checkRows = [], showVenue }: { rows: OfferRow[]; checkRows?: OfferRow[]; showVenue: boolean }) {
  const store = useStore();
  if (!rows.length && !checkRows.length) return null;
  const venueOf = (o: Offer) => (showVenue ? VENUE_SHORT[store.venueById.get(o.venue_id)?.slug ?? ""] : null);
  return (
    <>
      {rows.length ? (
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
              sub={[venueOf(offer), offerKindLabel(offer.kind), `${gp(cost.gpPct, 1, cost.targetGp)} vs ${gp(cost.targetGp, 0)}`, money(cost.offerPriceInc)].filter(Boolean).join(" · ")}
              chevron
            />
          ))}
        </Group>
      ) : null}
      {checkRows.length ? (
        <Group title={`Offers To Check · ${checkRows.length}`} className="mt-4" inset="3.75rem" footer="A component is missing or its cost looks wrong, so these are left out of the GP checks until it is fixed.">
          {checkRows.map(({ offer, cost }) => (
            <Row
              key={offer.id}
              href={`/specials/${offer.id}`}
              leading={
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warn-soft text-warn">
                  <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </span>
              }
              title={offer.name}
              wrapSub
              sub={[venueOf(offer), offerKindLabel(offer.kind), "Check components"].filter(Boolean).join(" · ")}
              chevron
            />
          ))}
        </Group>
      ) : null}
    </>
  );
}
