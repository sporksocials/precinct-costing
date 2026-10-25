"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { money } from "@/lib/format";
import { brisbaneStamp } from "@/lib/ordering-orders-ui";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  brisbaneDate,
  changeView,
  dayLabel,
  docStats,
  docTitle,
  filterDocs,
  inRange,
  numberLabel,
  PAGE,
  PAGE_STEP,
  PERIOD_OPTIONS,
  periodRange,
  readPeriod,
  readStatusFilter,
  sortDocs,
  statsFor,
  statusView,
  STATUS_FILTERS,
  type ChangeView,
  type DocStats,
  type PeriodId,
  type StatusFilterId, isUnread,
} from "@/lib/invoice-view";
import { loadChangeLookups, useInvoiceList, type ChangeLookups } from "@/lib/invoice-data";
import type { InvoiceDocumentRow, InvoicePriceChangeRow } from "@/lib/invoice-types";
import { VenueFilter, useVenue, VENUE_SHORT } from "@/components/venue";
import { VenueTag } from "@/components/brand";
import { DataTable, type Column } from "@/components/table";
import { Banner, Empty, ListSkeleton, PageHeader } from "@/components/ui";
import { TouchButton, TouchChips, TouchSegmented } from "@/components/ordering/touch";
import { usePersonName } from "@/components/use-person-name";
import { useUrlState } from "@/components/use-url-state";
import { InvoiceTabs } from "./inv-tabs";
import { MoveLabel, StatusLabel } from "./inv-parts";
import { UndoChangeSheet } from "./inv-undo";
import { DiscountsView } from "./inv-discounts";

type View = "invoices" | "changes" | "discounts";
const EMPTY_LOOKUPS: ChangeLookups = { lines: new Map(), products: new Map() };

/** Supplier Prices | Invoices: the Invoices tab. A list of invoices, or (view=changes) every price the invoices changed. */
export function InvoicesScreen() {
  const store = useStore();
  const { venue } = useVenue();
  const list = useInvoiceList();
  const [periodRaw, setPeriod] = useUrlState("period", "week");
  const [statusRaw, setStatus] = useUrlState("status", "all");
  const [viewRaw, setView] = useUrlState("view", "invoices");
  const period = readPeriod(periodRaw);
  const status = readStatusFilter(statusRaw);
  const view: View = viewRaw === "changes" ? "changes" : viewRaw === "discounts" ? "discounts" : "invoices";
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [period, status, view, venue?.id]);

  const data = list.data;
  const range = useMemo(() => periodRange(period, store.today), [period, store.today]);
  const stats = useMemo(() => (data ? docStats(data.changes, data.questions, data.approvalLines) : new Map<string, DocStats>()), [data]);
  const docs = useMemo(() => (data ? sortDocs(filterDocs(data.documents, { venueId: venue?.id ?? null, range, status }, stats)) : []), [data, venue?.id, range, status, stats]);
  const changes = useMemo(() => {
    if (!data) return [] as InvoicePriceChangeRow[];
    return data.changes.filter((c) => c.kind === "price_change" && (!venue || c.venue_id === venue.id) && (!range.from && !range.to ? true : inRange(brisbaneDate(c.applied_at), range)));
  }, [data, venue, range]);

  const reset = () => {
    setPeriod("all");
    setStatus("all");
  };

  const body = (() => {
    // Discounts We Found reads its own lines, so it does not wait on (or hide behind) the invoice list
    if (view === "discounts") return <DiscountsView venueId={venue?.id ?? null} />;
    if (list.loading && !data) return <ListSkeleton rows={8} />;
    if (list.error && !data) return <Banner action={<TouchButton onClick={() => void list.reload()}>Try Again</TouchButton>}>{list.error}</Banner>;
    if (!data) return null;
    if (data.missing)
      return <Empty title="Invoices Are Not Set Up Yet" body="Once they are, every scanned invoice appears here with what it changed." />;
    if (data.documents.length === 0) return <Empty title="No Invoices Yet" body="Scan one and it appears here." />;
    if (view === "changes") return <ChangesView changes={changes} data={data} onReset={reset} showVenue={!venue} limit={limit} setLimit={setLimit} onChanged={() => void list.reload()} filtered={period !== "all"} />;
    return (
      <DocsView
        docs={docs}
        stats={stats}
        supplierNames={data.supplierNames}
        showVenue={!venue}
        limit={limit}
        setLimit={setLimit}
        onReset={reset}
        filtered={period !== "all" || status !== "all" || !!venue}
      />
    );
  })();

  return (
    <div>
      <PageHeader title="Invoices" subtitle="Scanned supplier invoices" />
      <InvoiceTabs active="invoices" />
      <VenueFilter stats={false} compact />
      <div className="mt-3 space-y-3">
        <TouchSegmented<View>
          ariaLabel="View"
          className="sm:max-w-lg [&>button]:whitespace-normal [&>button]:px-2 [&>button]:leading-tight"
          value={view}
          onChange={(v) => setView(v === "invoices" ? "" : v)}
          options={[
            { value: "invoices", label: "Invoices" },
            { value: "changes", label: "Prices Changed" },
            { value: "discounts", label: "Discounts We Found" },
          ]}
        />
        {view !== "discounts" ? <TouchChips<PeriodId> ariaLabel="Period" value={period} onChange={(v) => setPeriod(v === "week" ? "" : v)} options={PERIOD_OPTIONS} /> : null}
        {view === "invoices" ? <TouchChips<StatusFilterId> ariaLabel="Status" value={status} onChange={(v) => setStatus(v === "all" ? "" : v)} options={STATUS_FILTERS} /> : null}
      </div>
      <div className="mt-4">{body}</div>
      {venue ? <p className="sr-only">{VENUE_SHORT[venue.slug] ?? venue.name}</p> : null}
    </div>
  );
}

function NothingHere({ onReset, filtered }: { onReset: () => void; filtered: boolean }) {
  return (
    <Empty
      title="Nothing Here"
      body={filtered ? "No invoices match these filters." : "No invoices to show."}
      action={filtered ? <TouchButton onClick={onReset}>Show All Invoices</TouchButton> : undefined}
    />
  );
}

function ShowMore({ left, onMore }: { left: number; onMore: () => void }) {
  if (left <= 0) return null;
  return (
    <TouchButton className="mt-3 w-full" onClick={onMore}>
      Show More ({left})
    </TouchButton>
  );
}

// ---------------------------------------------------------------- invoices

function DocsView({
  docs,
  stats,
  supplierNames,
  showVenue,
  limit,
  setLimit,
  onReset,
  filtered,
}: {
  docs: InvoiceDocumentRow[];
  stats: Map<string, DocStats>;
  supplierNames: Map<string, string>;
  showVenue: boolean;
  limit: number;
  setLimit: (f: (n: number) => number) => void;
  onReset: () => void;
  filtered: boolean;
}) {
  const { venueById } = useStore();
  if (docs.length === 0) return <NothingHere onReset={onReset} filtered={filtered} />;
  const shown = docs.slice(0, limit);
  const titleOf = (d: InvoiceDocumentRow) => docTitle(d, d.supplier_id ? (supplierNames.get(d.supplier_id) ?? null) : null);
  const dateOf = (d: InvoiceDocumentRow) => dayLabel(d.invoice_date) || dayLabel(d.created_at);
  const venueOf = (d: InvoiceDocumentRow) => venueById.get(d.venue_id);
  const columns: Column<InvoiceDocumentRow>[] = [
    { key: "supplier", label: "Supplier", render: (d) => <span className="font-medium text-label">{titleOf(d)}</span>, sort: (d) => titleOf(d).toLowerCase() },
    { key: "number", label: "Invoice", render: (d) => <span className="text-label-2">{numberLabel(d.invoice_number)}</span> },
    { key: "date", label: "Date", render: (d) => <span className="text-label-2">{dateOf(d)}</span>, sort: (d) => d.invoice_date ?? d.created_at },
    ...(showVenue
      ? [{ key: "venue", label: "Venue", render: (d: InvoiceDocumentRow) => <VenueTag slug={venueOf(d)?.slug} name={VENUE_SHORT[venueOf(d)?.slug ?? ""] ?? venueOf(d)?.name ?? ""} size={16} /> } satisfies Column<InvoiceDocumentRow>]
      : []),
    { key: "total", label: "Total Inc GST", align: "right", render: (d) => <span className="text-label">{money(d.total_inc)}</span>, sort: (d) => d.total_inc },
    { key: "status", label: "Status", render: (d) => <StatusLabel view={statusView(d.status, statsFor(stats, d.id), isUnread(d))} /> },
  ];
  return (
    <>
      <p className="px-1 pb-1.5 text-[13px] text-label-2">{`${docs.length} ${docs.length === 1 ? "invoice" : "invoices"}`}</p>
      <ul className="group-list lg:hidden">
        {shown.map((d) => {
          const v = venueOf(d);
          return (
            <li key={d.id}>
              <Link href={`/invoices/${d.id}`} className="flex min-h-[64px] flex-col justify-center gap-1 px-4 py-3 transition-colors active:bg-fill hover:bg-[color:var(--fill)]">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[17px] font-semibold leading-snug">{titleOf(d)}</span>
                  <span className="shrink-0 text-[17px] tnum text-label">{money(d.total_inc)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] text-label-2">
                  <span>{numberLabel(d.invoice_number)}</span>
                  <span aria-hidden>·</span>
                  <span>{dateOf(d)}</span>
                  {showVenue && v ? (
                    <>
                      <span aria-hidden>·</span>
                      <VenueTag slug={v.slug} name={VENUE_SHORT[v.slug] ?? v.name} size={16} />
                    </>
                  ) : null}
                </span>
                <StatusLabel view={statusView(d.status, statsFor(stats, d.id), isUnread(d))} />
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden lg:block">
        <DataTable rows={shown} columns={columns} rowKey={(d) => d.id} href={(d) => `/invoices/${d.id}`} />
      </div>
      <ShowMore left={docs.length - limit} onMore={() => setLimit((l) => l + PAGE_STEP)} />
    </>
  );
}

// ---------------------------------------------------------------- prices changed

function ChangesView({
  changes,
  data,
  onReset,
  showVenue,
  limit,
  setLimit,
  onChanged,
  filtered,
}: {
  changes: InvoicePriceChangeRow[];
  data: { documents: InvoiceDocumentRow[]; supplierNames: Map<string, string> };
  onReset: () => void;
  showVenue: boolean;
  limit: number;
  setLimit: (f: (n: number) => number) => void;
  onChanged: () => void;
  filtered: boolean;
}) {
  const { ingredients, venueById } = useStore();
  const nameOf = usePersonName();
  const [lookups, setLookups] = useState<ChangeLookups>(EMPTY_LOOKUPS);
  const [undoing, setUndoing] = useState<InvoicePriceChangeRow | null>(null);
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

  const docById = useMemo(() => new Map(data.documents.map((d) => [d.id, d])), [data.documents]);
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const itemName = (c: InvoicePriceChangeRow) => (c.target === "ingredient" ? ingById.get(c.target_id)?.name : lookups.products.get(c.target_id)?.name) ?? lookups.lines.get(c.line_id)?.description ?? "An item";
  const currentPrice = (c: InvoicePriceChangeRow) => (c.target === "ingredient" ? (ingById.get(c.target_id)?.pack_price ?? null) : (lookups.products.get(c.target_id)?.price ?? null));
  const docLabel = (c: InvoicePriceChangeRow) => {
    const d = docById.get(c.document_id);
    if (!d) return "Invoice";
    const sup = d.supplier_id ? data.supplierNames.get(d.supplier_id) : null;
    return [sup || d.supplier_name_read, numberLabel(d.invoice_number)].filter(Boolean).join(" ");
  };
  const who = (c: InvoicePriceChangeRow) => `${c.mode === "auto" ? "Automatic" : (nameOf(c.applied_by) ?? "Someone")}, ${brisbaneStamp(c.applied_at)}`;
  const whoLong = (c: InvoicePriceChangeRow) => (c.mode === "auto" ? `Applied automatically, ${brisbaneStamp(c.applied_at)}` : `Approved by ${nameOf(c.applied_by) ?? "someone"}, ${brisbaneStamp(c.applied_at)}`);
  const venueTag = (c: InvoicePriceChangeRow) => {
    const v = venueById.get(c.venue_id);
    return v ? <VenueTag slug={v.slug} name={VENUE_SHORT[v.slug] ?? v.name} size={16} /> : null;
  };
  const undoBtn = (c: InvoicePriceChangeRow) =>
    c.status === "applied" ? (
      <TouchButton className="!px-3 !text-[15px]" onClick={() => setUndoing(c)} aria-label={`Undo the change to ${itemName(c)}`}>
        Undo
      </TouchButton>
    ) : (
      <span className="text-[13px] text-label-3">Put back</span>
    );

  if (changes.length === 0) return <Empty title="No Price Changes" body={filtered ? "No invoice has changed a price in this period." : "No invoice has changed a price yet."} action={filtered ? <TouchButton onClick={onReset}>Show All Periods</TouchButton> : undefined} />;

  const columns: Column<InvoicePriceChangeRow>[] = [
    { key: "item", label: "Item", render: (c) => <span className="font-medium text-label">{itemName(c)}</span> },
    { key: "price", label: "Old To New", render: (c) => <span className="text-label">{`${money(c.old_price)} to ${money(c.new_price)}`}</span> },
    { key: "move", label: "Change", render: (c) => <MoveLabel move={changeView(c, "").move} /> },
    {
      key: "invoice",
      label: "Invoice",
      render: (c) => (
        <Link href={`/invoices/${c.document_id}`} className="text-accent" onClick={(e) => e.stopPropagation()}>
          {docLabel(c)}
        </Link>
      ),
    },
    ...(showVenue ? [{ key: "venue", label: "Venue", render: (c: InvoicePriceChangeRow) => venueTag(c) } satisfies Column<InvoicePriceChangeRow>] : []),
    { key: "who", label: "Who And When", render: (c) => <span className="text-label-2">{who(c)}</span> },
    { key: "mode", label: "How", render: (c) => <span className="text-label-2">{changeView(c, "").mode}</span> },
    { key: "undo", label: "", align: "right", render: (c) => <span onClick={(e) => e.stopPropagation()}>{undoBtn(c)}</span> },
  ];
  const undoing_ = undoing;
  return (
    <>
      <p className="px-1 pb-1.5 text-[13px] text-label-2">{`${changes.length} ${changes.length === 1 ? "price" : "prices"} changed`}</p>
      <ul className="group-list lg:hidden">
        {shown.map((c) => {
          const v: ChangeView = changeView(c, itemName(c));
          return (
            <li key={c.id} className={v.reverted ? "opacity-70" : undefined}>
              <div className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[17px] font-semibold leading-snug">{v.itemName}</span>
                  <span className="shrink-0 text-[17px] tnum text-label">{`${money(v.oldPrice)} to ${money(v.newPrice)}`}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-label-2">
                  <MoveLabel move={v.move} />
                  <Link href={`/invoices/${c.document_id}`} className="inline-flex min-h-[44px] items-center text-accent">
                    {docLabel(c)}
                  </Link>
                  {showVenue ? venueTag(c) : null}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-[13px] text-label-2">{whoLong(c)}</span>
                  {undoBtn(c)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="hidden lg:block">
        <DataTable rows={shown} columns={columns} rowKey={(c) => c.id} />
      </div>
      <ShowMore left={changes.length - limit} onMore={() => setLimit((l) => l + PAGE_STEP)} />
      <UndoChangeSheet change={undoing_} itemName={undoing_ ? itemName(undoing_) : ""} currentPrice={undoing_ ? currentPrice(undoing_) : null} onClose={() => setUndoing(null)} onDone={onChanged} />
    </>
  );
}
