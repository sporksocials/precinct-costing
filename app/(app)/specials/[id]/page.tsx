"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { draftFromOffer, emptyDraft, OfferBuilder } from "@/components/offer-builder";
import { Empty } from "@/components/ui";
import type { OfferKind } from "@/lib/types";

export default function OfferPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const store = useStore();
  const isNew = id === "new";
  const offer = isNew ? undefined : store.offers.find((o) => o.id === id);
  const lines = useMemo(() => store.offerLines.filter((l) => l.offer_id === id), [store.offerLines, id]);
  const venueSlug = params.get("venue");
  const kindParam = params.get("kind");
  const kind: OfferKind = kindParam === "special" || kindParam === "happy_hour" ? kindParam : "combo";
  const venueId = store.venues.find((v) => v.slug === venueSlug)?.id ?? store.venues.find((v) => v.slug === "drift")?.id ?? store.venues[0]?.id ?? null;

  if (isNew) return <OfferBuilder key="new" offerId={null} initial={emptyDraft(venueId, kind)} />;
  if (!offer)
    return (
      <Empty
        title="Offer Not Found"
        body="It may have been deleted, or specials aren’t set up yet."
        action={
          <Link href="/specials" className="btn-primary">
            Back To Specials
          </Link>
        }
      />
    );
  return <OfferBuilder key={offer.id} offerId={offer.id} initial={draftFromOffer(offer, lines)} />;
}
