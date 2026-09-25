"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { happyHourRows } from "@/lib/insights";
import { offerKindLabel, offerWindowLabel, OFFER_STATUSES } from "@/lib/offers";
import { gp, money } from "@/lib/format";
import type { ItemCost } from "@/lib/costing";
import type { OfferStatus } from "@/lib/types";
import { useVenue, venueQuery, VenueFilter, VENUE_SHORT } from "@/components/venue";
import { StatusPill } from "@/components/offers-parts";
import { AddButton, Chips, cx, Empty, Group, PageHeader, Row, Segmented } from "@/components/ui";

const ORDER: Record<OfferStatus, number> = { live: 0, draft: 1, retired: 2 };

export default function SpecialsPage() {
  const store = useStore();
  const router = useRouter();
  const { venue } = useVenue();
  const [tab, setTab] = useState<"offers" | "hh">("offers");
  const [status, setStatus] = useState<OfferStatus | "all">("all");
  const q = venueQuery(venue);

  const offers = useMemo(
    () =>
      store.offers
        .filter((o) => (!venue || o.venue_id === venue.id) && (status === "all" || o.status === status))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)),
    [store.offers, venue, status],
  );
  const hh = useMemo(() => {
    const flagged = happyHourRows(store.itemCosts.values(), venue?.id ?? null);
    const flaggedIds = new Set(flagged.map((r) => r.cost.item.id));
    const rest = [...store.itemCosts.values()]
      .filter((c) => c.item.active && c.hhSellInc != null && (!venue || c.item.venue_id === venue.id) && !flaggedIds.has(c.item.id))
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
    return { flagged: flagged.map((r) => r.cost), rest };
  }, [store.itemCosts, venue]);

  const go = (kind?: string) => router.push(`/specials/new${kind || q ? `?${[kind ? `kind=${kind}` : "", venue ? `venue=${venue.slug}` : ""].filter(Boolean).join("&")}` : ""}`);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Specials" trailing={<AddButton label="New Offer" onClick={() => go()} />} />
      <VenueFilter className="mb-3" />
      <Segmented
        ariaLabel="Specials view"
        className="lg:w-96"
        value={tab}
        onChange={setTab}
        options={[
          { value: "offers", label: "Offers" },
          { value: "hh", label: "Happy Hour Prices" },
        ]}
      />

      {tab === "offers" ? (
        <>
          <p className="mt-4 px-1 text-[15px] text-label-2">Combos, happy hours and specials, worked out and saved apart from the master menu.</p>
          <div className="mt-3">
            <button type="button" className="btn-tinted w-full sm:w-auto" onClick={() => go("combo")}>
              Try A Combo
            </button>
          </div>
          {store.offers.length > 0 ? <Chips ariaLabel="Status" className="mt-4" value={status} onChange={setStatus} options={[{ value: "all" as const, label: "All" }, ...OFFER_STATUSES.map((s) => ({ value: s.value, label: s.label }))]} /> : null}

          {store.offers.length === 0 ? (
            <Empty title="No Specials Yet" body="Try A Combo to see the GP." />
          ) : offers.length === 0 ? (
            <Empty title="Nothing Here" body="No offers match this filter." />
          ) : (
            <Group title={`${offers.length} ${offers.length === 1 ? "Offer" : "Offers"}`} className="mt-5">
              {offers.map((o) => {
                const c = store.offerCosts.get(o.id);
                const v = store.venueById.get(o.venue_id);
                const n = c?.lines.length ?? 0;
                const win = offerWindowLabel(o);
                return (
                  <Row
                    key={o.id}
                    href={`/specials/${o.id}`}
                    title={<span className={cx(o.status === "retired" && "text-label-2")}>{o.name}</span>}
                    sub={
                      <span className="inline-flex max-w-full items-center gap-1.5">
                        <StatusPill status={o.status} />
                        <span className="truncate">{[offerKindLabel(o.kind), venue ? null : VENUE_SHORT[v?.slug ?? ""], `${n} ${n === 1 ? "item" : "items"}`, win || null].filter(Boolean).join(" · ")}</span>
                      </span>
                    }
                    trailing={
                      <>
                        <span>{money(c?.offerPriceInc)}</span>
                        <span className={cx("w-14 text-right font-semibold", c?.gpPct == null ? "text-label-3" : c.underTarget ? "text-danger" : "text-good")}>{gp(c?.gpPct, 1, c?.targetGp)}</span>
                      </>
                    }
                    chevron
                  />
                );
              })}
            </Group>
          )}
        </>
      ) : (
        <>
          <p className="mt-4 px-1 text-[15px] text-label-2">Happy hour prices set on menu items and tap beer, checked against the same target GP. Open one to change its price.</p>
          {hh.flagged.length + hh.rest.length === 0 ? (
            <Empty title="No Happy Hour Prices" body="Add a happy hour price on a menu item or a tap beer and it shows here." />
          ) : (
            <>
              {hh.flagged.length ? <HhGroup title={`Below Target · ${hh.flagged.length}`} rows={hh.flagged} showVenue={!venue} /> : null}
              {hh.rest.length ? <HhGroup title={`On Target · ${hh.rest.length}`} rows={hh.rest} showVenue={!venue} /> : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

function HhGroup({ title, rows, showVenue }: { title: string; rows: ItemCost[]; showVenue: boolean }) {
  const store = useStore();
  return (
    <Group title={title} className="mt-5">
      {rows.map((c) => {
        const v = store.venueById.get(c.item.venue_id);
        const bad = c.hhUnderTarget || c.hhBelowCost;
        return (
          <Row
            key={c.item.id}
            href={`/items/${encodeURIComponent(c.item.id)}`}
            title={c.item.name}
            sub={[showVenue ? VENUE_SHORT[v?.slug ?? ""] : null, `regular ${money(c.sellInc)}`, `target ${gp(c.targetGp, 0)}`, c.hhBelowCost ? "below cost" : null].filter(Boolean).join(" · ")}
            trailing={
              <>
                <span>{money(c.hhSellInc)}</span>
                <span className={cx("w-14 text-right font-semibold", bad ? "text-danger" : "text-good")}>{gp(c.hhGpPct, 1, c.targetGp)}</span>
              </>
            }
            chevron
          />
        );
      })}
    </Group>
  );
}
