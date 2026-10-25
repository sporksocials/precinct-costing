"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { money } from "@/lib/format";
import { brisbaneTime } from "@/lib/ordering-orders-ui";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { brisbaneDate, changeView, dayHeading, numberLabel, PAGE, PAGE_STEP } from "@/lib/invoice-view";
import { loadChangeLookups, type ChangeLookups } from "@/lib/invoice-data";
import type { InvoiceDocumentRow, InvoicePriceChangeRow } from "@/lib/invoice-types";
import { VENUE_SHORT } from "@/components/venue";
import { VenueTag } from "@/components/brand";
import { Empty } from "@/components/ui";
import { TouchButton } from "@/components/ordering/touch";
import { usePersonName } from "@/components/use-person-name";
import { MoveLabel } from "./inv-parts";
import { UndoChangeSheet } from "./inv-undo";

const EMPTY_LOOKUPS: ChangeLookups = { lines: new Map(), products: new Map() };

/**
 * Changes: every price an invoice changed, newest first, under day headings. One row per price: the item, old to new with the move
 * in words and an arrow, which invoice, who or what applied it, and an Undo that opens the existing confirm sheet.
 */
export function ChangesView({
  changes: all,
  documents,
  supplierNames,
  venueId,
  showVenue,
  onChanged,
}: {
  changes: InvoicePriceChangeRow[];
  documents: InvoiceDocumentRow[];
  supplierNames: Map<string, string>;
  venueId: number | null;
  showVenue: boolean;
  onChanged: () => void;
}) {
  const { ingredients, venueById, today } = useStore();
  const nameOf = usePersonName();
  const [lookups, setLookups] = useState<ChangeLookups>(EMPTY_LOOKUPS);
  const [undoing, setUndoing] = useState<InvoicePriceChangeRow | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const changes = useMemo(() => all.filter((c) => c.kind === "price_change" && (venueId == null || c.venue_id === venueId)), [all, venueId]);
  useEffect(() => setLimit(PAGE), [venueId]);
  const shown = useMemo(() => changes.slice(0, limit), [changes, limit]);
  const key = shown.map((c) => c.id).join(",");
  useEffect(() => {
    let live = true;
    void loadChangeLookups(getSupabaseBrowser(), shown).then((l) => live && setLookups(l));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const docById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const itemName = (c: InvoicePriceChangeRow) => (c.target === "ingredient" ? ingById.get(c.target_id)?.name : lookups.products.get(c.target_id)?.name) ?? lookups.lines.get(c.line_id)?.description ?? "An item";
  const currentPrice = (c: InvoicePriceChangeRow) => (c.target === "ingredient" ? (ingById.get(c.target_id)?.pack_price ?? null) : (lookups.products.get(c.target_id)?.price ?? null));
  const invoiceLabel = (c: InvoicePriceChangeRow) => {
    const d = docById.get(c.document_id);
    if (!d) return "Invoice";
    const sup = d.supplier_id ? supplierNames.get(d.supplier_id) : null;
    return [sup || d.supplier_name_read, numberLabel(d.invoice_number)].filter(Boolean).join(" ");
  };
  const how = (c: InvoicePriceChangeRow) => (c.mode === "auto" ? "Auto" : `Approved by ${nameOf(c.applied_by) ?? "someone"}`);

  const groups = useMemo(() => {
    const out: { heading: string; rows: InvoicePriceChangeRow[] }[] = [];
    for (const c of shown) {
      const heading = dayHeading(brisbaneDate(c.applied_at), today);
      const last = out[out.length - 1];
      if (last && last.heading === heading) last.rows.push(c);
      else out.push({ heading, rows: [c] });
    }
    return out;
  }, [shown, today]);

  if (changes.length === 0) return <Empty title="No Price Changes" body="No invoice has changed a price yet. They appear here, with an Undo, when one does." />;

  return (
    <>
      {groups.map((g) => (
        <section key={g.heading} className="mb-5" aria-label={g.heading}>
          <h2 className="px-1 pb-1.5 text-[13px] font-medium text-label-2">{g.heading}</h2>
          <ul className="group-list">
            {g.rows.map((c) => {
              const v = changeView(c, itemName(c));
              const venue = venueById.get(c.venue_id);
              return (
                <li key={c.id} className={v.reverted ? "opacity-70" : undefined}>
                  <div className="px-4 pb-2 pt-1">
                    <Link href={`/invoices/${c.document_id}`} className="block min-h-[44px] pt-2 transition-colors active:opacity-70">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-[17px] font-semibold leading-snug">{v.itemName}</span>
                        <span className="shrink-0 text-[17px] tnum text-label">{`${money(v.oldPrice)} to ${money(v.newPrice)}`}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[15px] text-label-2 sm:text-[13px]">
                        <span>{invoiceLabel(c)}</span>
                        <span aria-hidden>·</span>
                        <span>{`${how(c)}, ${brisbaneTime(c.applied_at)}`}</span>
                        {showVenue && venue ? <VenueTag slug={venue.slug} name={VENUE_SHORT[venue.slug] ?? venue.name} size={16} /> : null}
                      </span>
                    </Link>
                    <div className="flex items-center justify-between gap-3">
                      <MoveLabel move={v.move} />
                      {c.status === "applied" ? (
                        <TouchButton className="!px-3 !text-[15px]" onClick={() => setUndoing(c)} aria-label={`Undo the change to ${itemName(c)}`}>
                          Undo
                        </TouchButton>
                      ) : (
                        <span className="px-1 text-[13px] text-label-3">Put back</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {changes.length > limit ? (
        <TouchButton className="w-full" onClick={() => setLimit((l) => l + PAGE_STEP)}>
          {`Show More (${changes.length - limit})`}
        </TouchButton>
      ) : null}
      <UndoChangeSheet change={undoing} itemName={undoing ? itemName(undoing) : ""} currentPrice={undoing ? currentPrice(undoing) : null} onClose={() => setUndoing(null)} onDone={onChanged} />
    </>
  );
}
