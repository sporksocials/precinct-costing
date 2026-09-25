"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { parseVirtualItemId } from "@/lib/gelato";
import { isBeerItemId, parseBeerItemId } from "@/lib/beer";
import { money } from "@/lib/format";
import { indexDoc, search } from "@/lib/search";
import type { OfferLine, OfferStatus } from "@/lib/types";
import { cx, Row, SearchField, Sheet } from "./ui";

const PILL: Record<OfferStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-fill-2 text-label-2" },
  live: { label: "Live", className: "bg-good-soft text-good" },
  retired: { label: "Retired", className: "bg-fill text-label-3" },
};

/** Draft / Live / Retired as a small status pill. */
export function StatusPill({ status, className }: { status: OfferStatus; className?: string }) {
  const p = PILL[status];
  return <span className={cx("inline-flex h-[20px] items-center rounded-full px-2 text-[12px] font-semibold leading-none", p.className, className)}>{p.label}</span>;
}

export type NewOfferLine = Omit<OfferLine, "id" | "offer_id">;

/**
 * Pick a component for an offer: a menu item or a tap beer serve from the offer's own venue.
 * Gelato flavour x serve items are computed (they have no stored id), so they are not offered here.
 */
export function ComponentPicker({ open, onClose, venueId, onPick }: { open: boolean; onClose: () => void; venueId: number | null; onPick: (line: NewOfferLine) => void }) {
  const store = useStore();
  const [q, setQ] = useState("");
  const docs = useMemo(
    () =>
      store.items
        .filter((i) => i.active && i.venue_id === venueId && !parseVirtualItemId(i.id))
        .map((i) => {
          const c = store.itemCosts.get(i.id);
          const beer = isBeerItemId(i.id);
          return {
            ...indexDoc({ kind: "item" as const, id: i.id, title: i.name, sub: "", href: "", extra: i.category }),
            beer,
            category: i.category,
            sell: c?.sellInc ?? null,
            cost: c?.costPerPortion ?? null,
          };
        }),
    [store.items, store.itemCosts, venueId],
  );
  const sections = useMemo(() => {
    if (q.trim()) return [{ title: null as string | null, rows: search(docs, q, 60).map((h) => h.doc) }];
    const beers = docs.filter((d) => d.beer).sort((a, b) => a.title.localeCompare(b.title));
    const food = docs.filter((d) => !d.beer).sort((a, b) => a.title.localeCompare(b.title));
    return [
      { title: "Tap Beer" as string | null, rows: beers.slice(0, 40) },
      { title: "Menu Items" as string | null, rows: food.slice(0, 60) },
    ].filter((x) => x.rows.length);
  }, [docs, q]);

  function choose(id: string) {
    const b = parseBeerItemId(id);
    onPick(
      b
        ? { component_kind: "beer_serve", item_id: null, beer_id: b.beerId, serve_id: b.serveId, qty: 1, price_inc_override: null, sort: 0 }
        : { component_kind: "item", item_id: id, beer_id: null, serve_id: null, qty: 1, price_inc_override: null, sort: 0 },
    );
    setQ("");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add To Offer" cancelLabel="Cancel" size="md">
      <div className="pb-2 pt-3">
        <SearchField value={q} onChange={setQ} placeholder="Search menu items and tap beer" autoFocus />
        {sections.length === 0 ? (
          <p className="px-1 pt-4 text-[15px] text-label-2">{docs.length ? "Nothing matches." : "This venue has no priced menu items or tap beer yet."}</p>
        ) : (
          sections.map((sec) => (
            <div key={sec.title ?? "results"} className="mt-3">
              {sec.title ? <p className="section-label !px-1">{sec.title}</p> : null}
              <div className="group-list">
                {sec.rows.map((d) => (
                  <Row key={d.id} onClick={() => choose(d.id)} title={d.title} sub={d.beer ? "Tap Beer" : d.category} trailing={<span className="text-label-2">{money(d.sell)}</span>} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
