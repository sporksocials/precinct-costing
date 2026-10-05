"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Copy } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { VenueAccent } from "@/components/venue";
import { usePersonName } from "@/components/use-person-name";
import { Banner, Empty, ListSkeleton, PageHeader } from "@/components/ui";
import { money } from "@/lib/format";
import { orderingVenueName, qtyText, qtyWithUnit } from "@/lib/ordering";
import { SEND_METHOD_LABEL, brisbaneStamp, countLabel, linePrice, plural, sentLine, sentSummary, unitsText } from "@/lib/ordering-orders-ui";
import type { OrderingOrder, OrderingOrderLine, OrderingSupplier } from "@/lib/ordering-types";
import { useStore } from "@/lib/store";
import type { Venue } from "@/lib/types";
import { MethodBadge, SupplierFacts } from "./order-card";
import { copyText } from "./clipboard";
import { Notice, StatusPill, btnPlain, btnPrimary, btnText, useWide } from "./parts";
import { UnknownVenue } from "./orders-screen";
import { fetchOrderDetail, useVenueOrders } from "./use-orders-data";

/** A saved order at /ordering/<venue>/orders/<id>: the exact text sent, who and when, and the lines with their prices. */
export function OrderDetailScreen() {
  const { venue: slug, id } = useParams<{ venue: string; id: string }>();
  const store = useStore();
  const venue = store.venues.find((v) => v.slug === slug) ?? null;
  if (!store.ready && !store.venues.length) return <ListSkeleton rows={4} />;
  if (!venue) return <UnknownVenue />;
  return <DetailForVenue venue={venue} orderId={id} />;
}

function DetailForVenue({ venue, orderId }: { venue: Venue; orderId: string }) {
  const nameOf = usePersonName();
  const { data, status: venueStatus, error: venueError } = useVenueOrders(venue.id);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; error: string | null; order: OrderingOrder | null; lines: OrderingOrderLine[] }>({ status: "loading", error: null, order: null, lines: [] });
  useEffect(() => {
    let live = true;
    setState({ status: "loading", error: null, order: null, lines: [] });
    fetchOrderDetail(venue.id, orderId)
      .then((r) => live && setState({ status: "ready", error: null, order: r.order, lines: r.lines }))
      .catch((e) => live && setState({ status: "error", error: e instanceof Error ? e.message : "That order could not be loaded.", order: null, lines: [] }));
    return () => {
      live = false;
    };
  }, [venue.id, orderId]);

  const back = `/ordering/${venue.slug}/orders`;
  const venueName = orderingVenueName(venue);
  const { order, lines } = state;
  const supplier = data?.suppliers.find((s) => s.id === order?.supplier_id) ?? null;
  const session = data?.sessions.find((s) => s.id === order?.session_id) ?? null;

  return (
    <div className="max-w-[960px] lg:pt-4">
      <VenueAccent slug={venue.slug} />
      <BackLink path={back} fallback={back} className={`${btnText} -ml-2 !gap-0 !text-[17px]`}>
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
        Orders
      </BackLink>
      {state.status === "loading" || venueStatus === "loading" ? <ListSkeleton rows={4} /> : null}
      {state.status === "error" ? <Banner>{state.error}</Banner> : null}
      {venueStatus === "error" ? <Banner>{venueError}</Banner> : null}
      {state.status === "ready" && !order ? <Empty title="Order Not Found" body="It may belong to a different venue, or it may have been removed." action={<Link href={back} className={btnPrimary}>Back To Orders</Link>} /> : null}
      {state.status === "ready" && order ? (
        <OrderDetail venueName={venueName} order={order} lines={lines} supplierName={supplier?.name ?? "Supplier"} supplierFacts={supplier} countText={session ? countLabel(session, nameOf) : null} nameOf={nameOf} />
      ) : null}
    </div>
  );
}

function OrderDetail({
  venueName,
  order,
  lines,
  supplierName,
  supplierFacts,
  countText,
  nameOf,
}: {
  venueName: string;
  order: OrderingOrder;
  lines: OrderingOrderLine[];
  supplierName: string;
  supplierFacts: OrderingSupplier | null;
  countText: string | null;
  nameOf: (email: string | null | undefined) => string | null;
}) {
  const sent = order.status === "sent";
  const summary = useMemo(() => sentSummary(lines), [lines]);
  const [ref, wide] = useWide<HTMLDivElement>(720);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const showPrices = order.show_prices;
  const text = order.body_text ?? "";

  const doCopy = () => {
    void copyText(text).then((ok) => {
      window.clearTimeout(timer.current);
      setFailed(!ok);
      setCopied(ok);
      if (ok) timer.current = window.setTimeout(() => setCopied(false), 4000);
      else window.requestAnimationFrame(() => { area.current?.focus(); area.current?.select(); });
    });
  };

  return (
    <>
      <PageHeader title={order.subject || `${venueName} Order`} subtitle={`${supplierName}. ${order.kind === "top_up" ? "Top-up order" : "From a count"}.`} />
      <section className="rounded-2xl bg-surface px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill sent={sent} />
          {supplierFacts ? <MethodBadge method={supplierFacts.method} /> : null}
        </div>
        <p className="mt-2 text-[17px] font-medium text-label">
          {sent ? sentLine(order, nameOf) : `Saved ${brisbaneStamp(order.created_at)}, not marked as sent`}
        </p>
        <p className="mt-0.5 text-[14px] text-label-2">
          {sent && order.method ? `Way sent: ${SEND_METHOD_LABEL[order.method]}. ` : ""}
          {order.kind === "top_up" ? "Not tied to a count." : countText ? `${countText}.` : ""}
        </p>
        {supplierFacts ? <SupplierFacts supplier={supplierFacts} /> : null}
        {!sent ? (
          <Notice tone="warn" className="mt-3" role="status">
            This order was saved but never marked as sent, so it may not have gone to the supplier. Check with whoever started it.
          </Notice>
        ) : null}
        {order.warning_text ? (
          <Notice tone="neutral" className="mt-3">
            Warning at the time: {order.warning_text}.
          </Notice>
        ) : null}
      </section>

      <section ref={ref} className="mt-4 overflow-hidden rounded-2xl bg-surface" aria-label="Order lines">
        {wide ? <DetailTable lines={lines} showPrices={showPrices} /> : <DetailList lines={lines} showPrices={showPrices} />}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-[color:var(--separator)] px-4 py-3">
          <p className="text-[15px] text-label-2 tnum">
            {plural(summary.products, "product")}, {unitsText(lines)}
          </p>
          {summary.totals.pricedLines > 0 ? (
            <p className="text-right tnum">
              <span className="block text-[17px] font-semibold text-label">{money(summary.totals.inc)} <span className="text-[13px] font-normal text-label-2">inc GST</span></span>
              <span className="block text-[14px] text-label-2">{money(summary.totals.ex)} ex GST</span>
            </p>
          ) : (
            <p className="text-[13px] text-label-2">No prices were saved with this order.</p>
          )}
        </div>
        {summary.totals.pricedLines > 0 && !showPrices ? <p className="px-4 pb-3 text-[13px] text-label-2">Prices were not included in the text sent to the supplier.</p> : null}
      </section>

      <section className="mt-4 rounded-2xl bg-surface px-4 py-4" aria-label="The text that was sent">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-label">{sent ? "The Exact Text Sent" : "The Saved Text"}</h2>
          {text ? (
            <button type="button" onClick={doCopy} className={btnPlain}>
              {copied ? <Check aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.5} /> : <Copy aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />}
              {copied ? "Copied" : "Copy Order"}
            </button>
          ) : null}
        </div>
        {text ? (
          <>
            <p className="mt-2 text-[13px] text-label-2">
              Subject <span className="text-label">{order.subject}</span>
            </p>
            <label className="mt-2 block">
              <span className="sr-only">The exact text of this order</span>
              <textarea ref={area} readOnly rows={Math.min(20, Math.max(5, text.split("\n").length + 1))} value={text} className="block w-full resize-y rounded-xl bg-fill px-3.5 py-3 text-[15px] leading-relaxed text-label outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]" />
            </label>
            <p role="status" aria-live="polite" className={copied ? "mt-2 text-[14px] font-medium text-good" : "sr-only"}>
              {copied ? "Copied." : ""}
            </p>
            {failed ? <Notice tone="warn" className="mt-2" role="alert">Your browser would not copy it. The text is selected above, so press Ctrl+C (Cmd+C on a Mac) to copy it by hand.</Notice> : null}
          </>
        ) : (
          <p className="mt-2 text-[15px] text-label-2">No text was saved because this order was not marked as sent.</p>
        )}
      </section>
    </>
  );
}

function ProductCell({ l }: { l: OrderingOrderLine }) {
  return (
    <>
      <span className="block text-[16px] font-medium text-label">{l.product_name}</span>
      <span className="block text-[13px] text-label-2">
        {l.unit_name ? `Per ${l.unit_name}` : "Typed line"}
        {l.supplier_item_code ? ` · Item ${l.supplier_item_code}` : ""}
      </span>
    </>
  );
}

/** One price per line: the line total inc GST, with what one costs small. ex GST is only in the order total. */
function Price({ qty, priceInc }: { qty: number; priceInc: number | null }) {
  const p = linePrice(qty, priceInc);
  if (!p) return <span className="text-[13px] text-label-2">No price</span>;
  return (
    <span className="block text-[16px] font-medium leading-snug text-label tnum">
      {p.total}
      <span className="block text-[12px] font-normal text-label-2">{p.each}</span>
    </span>
  );
}

function DetailTable({ lines, showPrices }: { lines: OrderingOrderLine[]; showPrices: boolean }) {
  return (
    <table className="w-full table-fixed text-left">
      <thead>
        <tr className="text-[12px] font-medium uppercase tracking-wide text-label-2">
          <th scope="col" className="px-4 pb-1 pt-3 font-medium">Product</th>
          <th scope="col" className="w-[90px] px-1 pb-1 pt-3 text-right font-medium">Suggested</th>
          <th scope="col" className="w-[110px] px-3 pb-1 pt-3 text-right font-medium">Ordered</th>
          {showPrices ? <th scope="col" className="w-[130px] px-1 pb-1 pt-3 font-medium">Price</th> : null}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="border-t border-[color:var(--separator)] align-middle">
            <td className="px-4 py-2.5"><ProductCell l={l} /></td>
            <td className="px-1 py-2.5 text-right text-[15px] tnum text-label-2">{l.suggested_qty == null ? "-" : qtyText(l.suggested_qty)}</td>
            <td className="px-3 py-2.5 text-right text-[16px] font-semibold tnum text-label">{qtyWithUnit(l.ordered_qty, l.unit_name)}</td>
            {showPrices ? <td className="px-1 py-2.5"><Price qty={l.ordered_qty} priceInc={l.price_inc_gst} /></td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailList({ lines, showPrices }: { lines: OrderingOrderLine[]; showPrices: boolean }) {
  return (
    <ul>
      {lines.map((l) => (
        <li key={l.id} className="flex items-start gap-3 border-t border-[color:var(--separator)] px-4 py-3 first:border-t-0">
          <div className="min-w-0 flex-1">
            <ProductCell l={l} />
            {l.suggested_qty != null ? <span className="mt-0.5 block text-[13px] text-label-2 tnum">Suggested {qtyText(l.suggested_qty)}</span> : null}
          </div>
          <div className="shrink-0 text-right">
            <span className="block text-[16px] font-semibold tnum text-label">{qtyWithUnit(l.ordered_qty, l.unit_name)}</span>
            {showPrices ? <Price qty={l.ordered_qty} priceInc={l.price_inc_gst} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
