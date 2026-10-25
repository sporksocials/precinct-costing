"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/format";
import {
  docTitle,
  filterDocs,
  groupByDay,
  hiddenCounts,
  hiddenKind,
  hiddenLabel,
  hiddenSentence,
  numberLabel,
  outcomeFor,
  outcomeView,
  PAGE,
  PAGE_STEP,
  shortDay,
  sortDocs,
  type DocOutcomeStats,
} from "@/lib/invoice-view";
import type { ListData } from "@/lib/invoice-data";
import type { InvoiceDocumentRow } from "@/lib/invoice-types";
import { useStore } from "@/lib/store";
import { VENUE_SHORT } from "@/components/venue";
import { VenueTag } from "@/components/brand";
import { Empty } from "@/components/ui";
import { TouchButton, TouchSearch } from "@/components/ordering/touch";
import { StatusLabel } from "./inv-parts";

const LG_COLS = "lg:grid-cols-[minmax(0,2.2fr)_110px_minmax(0,1fr)_110px_minmax(0,1.5fr)]";
const LG_COLS_NO_VENUE = "lg:grid-cols-[minmax(0,2.4fr)_110px_110px_minmax(0,1.5fr)]";

/**
 * All Invoices: the archive, kept calm. A search box (supplier or number), then a plain list under day headings. Each row is the
 * supplier, "#793369 · 20 Oct", the total when it is known, and one short phrase for what happened. Duplicates, ignored documents,
 * invoices still being read and the ones that could not be read stay out of the list until someone asks for them.
 */
export function AllInvoices({ data, outcomes, venueId, showVenue, today }: { data: ListData; outcomes: Map<string, DocOutcomeStats>; venueId: number | null; showVenue: boolean; today: string }) {
  const { venueById } = useStore();
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [query, venueId, showHidden]);

  const titleOf = (d: InvoiceDocumentRow) => docTitle(d, d.supplier_id ? (data.supplierNames.get(d.supplier_id) ?? null) : null);
  const inVenue = useMemo(() => data.documents.filter((d) => venueId == null || d.venue_id === venueId), [data.documents, venueId]);
  const hidden = useMemo(() => hiddenCounts(inVenue), [inVenue]);
  const hiddenText = hiddenSentence(hidden);
  const numberById = useMemo(() => new Map(data.documents.map((d) => [d.id, d.invoice_number])), [data.documents]);

  const docs = useMemo(() => {
    const pool = showHidden ? inVenue : inVenue.filter((d) => !hiddenKind(d));
    return sortDocs(filterDocs(pool, { venueId: null, query, titleOf }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inVenue, showHidden, query, data.supplierNames]);
  const shown = docs.slice(0, limit);
  const groups = useMemo(() => groupByDay(shown, today), [shown, today]);

  const venueTag = (d: InvoiceDocumentRow) => {
    const v = venueById.get(d.venue_id);
    return v ? <VenueTag slug={v.slug} name={VENUE_SHORT[v.slug] ?? v.name} size={16} /> : null;
  };
  const outcomeOf = (d: InvoiceDocumentRow) => {
    const kind = hiddenKind(d);
    if (kind) {
      const v = outcomeView(d, outcomeFor(outcomes, d.id));
      return { ...v, word: hiddenLabel(kind, kind === "duplicate" && d.duplicate_of ? numberById.get(d.duplicate_of) : null) };
    }
    return outcomeView(d, outcomeFor(outcomes, d.id));
  };
  const dateOf = (d: InvoiceDocumentRow) => shortDay(d.invoice_date || d.created_at, today);
  const hasTotal = (d: InvoiceDocumentRow) => d.total_inc != null && Number.isFinite(Number(d.total_inc));

  return (
    <div>
      <TouchSearch value={query} onChange={setQuery} placeholder="Search supplier or invoice number" label="Search invoices" />
      {docs.length === 0 ? (
        <Empty title={query.trim() ? "No Matches" : "No Invoices To Show"} body={query.trim() ? `Nothing matches "${query.trim()}".` : "Invoices appear here once they have been read."} action={query ? <TouchButton onClick={() => setQuery("")}>Clear Search</TouchButton> : undefined} />
      ) : (
        <div className="mt-4">
          <div className={`hidden gap-3 px-4 pb-1.5 text-[13px] font-medium text-label-3 lg:grid ${showVenue ? LG_COLS : LG_COLS_NO_VENUE}`} aria-hidden>
            <span>Supplier</span>
            <span>Date</span>
            {showVenue ? <span>Venue</span> : null}
            <span className="text-right">Total</span>
            <span>Outcome</span>
          </div>
          {groups.map((g) => (
            <section key={g.heading} className="mb-5" aria-label={g.heading}>
              <h2 className="px-1 pb-1.5 text-[13px] font-medium text-label-2 lg:px-4">{g.heading}</h2>
              <ul className="group-list">
                {g.docs.map((d) => {
                  const out = outcomeOf(d);
                  return (
                    <li key={d.id}>
                      <Link href={`/invoices/${d.id}`} className="block transition-colors hover:bg-[color:var(--fill)] active:bg-fill">
                        {/* phone and tablet */}
                        <span className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 lg:hidden">
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-[17px] font-semibold leading-snug">{titleOf(d)}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[15px] text-label-2">
                              <span>{[numberLabel(d.invoice_number), dateOf(d)].filter(Boolean).join(" · ")}</span>
                              {showVenue ? venueTag(d) : null}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-0.5">
                            {hasTotal(d) ? <span className="text-[17px] tnum text-label">{money(d.total_inc)}</span> : null}
                            <StatusLabel view={out} className="text-[14px]" />
                          </span>
                        </span>
                        {/* desktop */}
                        <span className={`hidden min-h-[56px] items-center gap-3 px-4 py-2.5 lg:grid ${showVenue ? LG_COLS : LG_COLS_NO_VENUE}`}>
                          <span className="min-w-0">
                            <span className="block truncate text-[15px] font-semibold">{titleOf(d)}</span>
                            <span className="block truncate text-[13px] text-label-2">{numberLabel(d.invoice_number)}</span>
                          </span>
                          <span className="text-[15px] text-label-2">{dateOf(d)}</span>
                          {showVenue ? <span>{venueTag(d)}</span> : null}
                          <span className="text-right text-[15px] tnum text-label">{hasTotal(d) ? money(d.total_inc) : ""}</span>
                          <StatusLabel view={out} className="text-[14px]" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {docs.length > limit ? (
            <TouchButton className="w-full" onClick={() => setLimit((l) => l + PAGE_STEP)}>
              {`Show More (${docs.length - limit})`}
            </TouchButton>
          ) : null}
        </div>
      )}
      {hiddenText ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-1 px-1">
          <p className="text-[13px] text-label-2">{showHidden ? hiddenText.replace(/ hidden\.$/, " shown.") : hiddenText}</p>
          <TouchButton variant="text" className="!text-[15px] sm:!text-[13px]" aria-expanded={showHidden} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Hide" : "Show"}
          </TouchButton>
        </div>
      ) : null}
    </div>
  );
}
