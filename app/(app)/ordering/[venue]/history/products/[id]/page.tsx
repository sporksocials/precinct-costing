"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadCountLinesForProduct } from "@/lib/ordering-data";
import { loadOrderHistoryForProduct, loadOrdersForSessions, loadSessionsPage } from "@/lib/ordering-screens-data";
import { productStory, storySummary } from "@/lib/ordering-history-view";
import { qtyText } from "@/lib/ordering";
import { unitTitle } from "@/lib/ordering-setup";
import type { OrderingCountLine, OrderingCountSession, OrderingOrder, OrderingOrderLine } from "@/lib/ordering-types";
import { Banner, Empty, PageHeader } from "@/components/ui";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { useVenueData } from "@/components/ordering/use-venue-data";
import { Tag, TouchBack, TouchLink } from "@/components/ordering/touch";

export default function OrderingProductHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const { venue, name, base } = useOrderingVenue();
  const { sb, data, status } = useVenueData(venue.id);
  const [sessions, setSessions] = useState<OrderingCountSession[] | null>(null);
  const [lines, setLines] = useState<OrderingCountLine[] | null>(null);
  const [orders, setOrders] = useState<OrderingOrder[]>([]);
  const [orderLines, setOrderLines] = useState<OrderingOrderLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSessions(null);
    setLines(null);
    (async () => {
      try {
        const [s, l, oh] = await Promise.all([loadSessionsPage(sb, venue.id, { limit: 52 }), loadCountLinesForProduct(sb, venue.id, id, 52), loadOrderHistoryForProduct(sb, venue.id, id)]);
        const all = await loadOrdersForSessions(sb, venue.id, s.map((x) => x.id));
        if (!live) return;
        const byId = new Map<string, OrderingOrder>();
        for (const o of [...all, ...oh.orders]) byId.set(o.id, o);
        setSessions(s);
        setLines(l);
        setOrders([...byId.values()]);
        setOrderLines(oh.lines);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [sb, venue.id, id]);

  const product = data?.products.find((p) => p.id === id) ?? null;
  const category = data?.categories.find((c) => c.id === product?.category_id) ?? null;
  const story = useMemo(() => (product && sessions && lines ? productStory({ product, sessions, lines, orders, orderLines }) : null), [product, sessions, lines, orders, orderLines]);
  const summary = useMemo(() => (story ? storySummary(story) : null), [story]);

  const backHref = `${base}/history`;
  const back = (
    <TouchBack path={backHref} fallback={backHref}>
      History
    </TouchBack>
  );

  if (!product) {
    return (
      <div className="max-w-4xl lg:pt-6">
        {back}
        {status === "loading" ? <p className="mt-6 text-[15px] text-label-2">Loading...</p> : <Empty title="Product Not Found" body="It may belong to another venue." action={<TouchLink href={backHref} variant="primary">Back To History</TouchLink>} />}
      </div>
    );
  }

  const second = category?.second_location_label ?? null;

  return (
    <div className="max-w-5xl lg:pt-6">
      {back}
      <PageHeader title={product.name} subtitle={`${name} · ${category?.name ?? ""} · ${unitTitle(product.unit_name)}`} trailing={<TouchLink href={`${base}/setup/products/${product.id}`}>Edit</TouchLink>} className="lg:!pt-2" />
      {error ? <Banner>{error}</Banner> : null}
      <p className="text-[13px] text-label-2">Build To now: {qtyText(product.par)}. Each row uses the level it was set to on the day.</p>

      {summary ? (
        <div className="mt-4 rounded-2xl bg-surface px-4 py-3 text-[15px]" role="status">
          {summary.sentences.map((s) => (
            <p key={s} className="py-0.5">
              {s}
            </p>
          ))}
        </div>
      ) : null}

      {!story ? <p className="mt-6 text-[15px] text-label-2">Loading counts...</p> : null}
      {story && story.length === 0 ? <Empty title="No counts yet" body="Once this product is counted, each week shows here with what was ordered." /> : null}

      {story && story.length > 0 ? (
        <>
          <ul className="group-list mt-4 xl:hidden" aria-label="Counts for this product">
            {story.map((r) => (
              <li key={r.sessionId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`${base}/history/counts/${r.sessionId}`} className="-my-1 flex min-h-[44px] items-center text-[17px]">
                    {r.dateLabel}
                  </Link>
                  <Tag tone={r.belowPar ? "warn" : r.over > 0 ? "accent" : "neutral"}>{r.position}</Tag>
                </div>
                {r.total == null ? null : (
                  <p className="mt-0.5 text-[15px] text-label-2 tnum">
                    Store {qtyText(r.store ?? 0)}
                    {second ? ` · ${second} ${qtyText(r.second ?? 0)}` : ""} · Total {qtyText(r.total)} · Build To {r.par == null ? "not set" : qtyText(r.par)}
                  </p>
                )}
                <p className="mt-1 text-[15px]">
                  {r.missed ? <Tag tone="warn">Check this</Tag> : null} <span className="align-middle">{r.orderNote}</span>
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 hidden overflow-hidden rounded-2xl bg-surface xl:block">
            <table className="w-full table-fixed text-left text-[15px]">
              <caption className="sr-only">Counts and orders for {product.name}, newest first</caption>
              <colgroup>
                <col className="w-[140px]" />
                <col className="w-[80px]" />
                <col className="w-[100px]" />
                <col className="w-[80px]" />
                <col className="w-[90px]" />
                <col className="w-[140px]" />
                <col />
              </colgroup>
              <thead>
                <tr className="text-[13px] text-label-2">
                  <th scope="col" className="px-4 py-2.5 font-medium">Count</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Store</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{second ?? "Second Place"}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Build To</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Where It Stood</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Ordered</th>
                </tr>
              </thead>
              <tbody>
                {story.map((r) => (
                  <tr key={r.sessionId} className="border-t border-[color:var(--separator)]">
                    <th scope="row" className="px-4 font-normal">
                      <Link href={`${base}/history/counts/${r.sessionId}`} className="flex min-h-[48px] items-center hover:underline">
                        {r.dateLabel}
                      </Link>
                    </th>
                    <td className="px-3 text-right tnum">{r.store == null ? "" : qtyText(r.store)}</td>
                    <td className="px-3 text-right tnum">{second && r.second != null ? qtyText(r.second) : ""}</td>
                    <td className="px-3 text-right tnum font-medium">{r.total == null ? "" : qtyText(r.total)}</td>
                    <td className="px-3 text-right tnum text-label-2">{r.par == null ? "" : qtyText(r.par)}</td>
                    <td className="px-3">{r.position}</td>
                    <td className="px-4">
                      {r.missed ? <Tag tone="warn">Check this</Tag> : null} <span className="align-middle">{r.orderNote}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
