"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { loadOrders } from "@/lib/ordering-data";
import { loadLinesForSessions, loadSessionsPage } from "@/lib/ordering-screens-data";
import { orderListRows, sessionRows, tallyBySession } from "@/lib/ordering-history-view";
import type { OrderingCountSession, OrderingOrder } from "@/lib/ordering-types";
import { Banner, cx, Empty, PageHeader } from "@/components/ui";
import { usePersonName } from "@/components/use-person-name";
import { useUrlState } from "@/components/use-url-state";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { useVenueData } from "@/components/ordering/use-venue-data";
import { Tag, TouchBack, TouchButton, TouchSegmented } from "@/components/ordering/touch";

const PAGE = 12;

type Tab = "counts" | "orders";

export default function OrderingHistoryPage() {
  const { venue, name, base } = useOrderingVenue();
  const nameOf = usePersonName();
  const { sb, data } = useVenueData(venue.id);
  const [tabRaw, setTab] = useUrlState("tab", "counts");
  const tab: Tab = tabRaw === "orders" ? "orders" : "counts";

  const [sessions, setSessions] = useState<OrderingCountSession[] | null>(null);
  const [more, setMore] = useState(false);
  const [tallies, setTallies] = useState<Map<string, number> | null>(null);
  const [orders, setOrders] = useState<OrderingOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadTallies = useCallback(
    async (list: OrderingCountSession[], into?: Map<string, number>) => {
      const lines = await loadLinesForSessions(sb, list.map((s) => s.id));
      const t = tallyBySession(lines);
      return new Map([...(into ?? []), ...t, ...list.filter((s) => !t.has(s.id)).map((s) => [s.id, 0] as [string, number])]);
    },
    [sb],
  );

  useEffect(() => {
    let live = true;
    setSessions(null);
    setTallies(null);
    setOrders(null);
    setError(null);
    (async () => {
      try {
        const first = await loadSessionsPage(sb, venue.id, { limit: PAGE });
        if (!live) return;
        setSessions(first);
        setMore(first.length === PAGE);
        void loadOrders(sb, venue.id, { limit: 100 }).then((o) => live && setOrders(o)).catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
        const t = await loadTallies(first);
        if (live) setTallies(t);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [sb, venue.id, loadTallies]);

  async function showOlder() {
    if (!sessions?.length) return;
    setLoadingMore(true);
    try {
      const older = await loadSessionsPage(sb, venue.id, { limit: PAGE, before: sessions[sessions.length - 1].started_at });
      setSessions([...sessions, ...older]);
      setMore(older.length === PAGE);
      setTallies(await loadTallies(older, tallies ?? undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const activeProducts = (data?.products ?? []).filter((p) => p.active).length;
  const rows = useMemo(() => (sessions ? sessionRows(sessions, tallies, activeProducts, nameOf) : null), [sessions, tallies, activeProducts, nameOf]);
  const orderRows = useMemo(() => (orders ? orderListRows(orders, data?.suppliers ?? [], nameOf) : null), [orders, data?.suppliers, nameOf]);

  return (
    <div className="max-w-4xl lg:pt-6">
      <TouchBack path={base} fallback={base}>
        {name}
      </TouchBack>
      <PageHeader title="History" subtitle={`${name} only`} className="lg:!pt-2" />
      <TouchSegmented
        ariaLabel="History view"
        className="lg:w-96"
        value={tab}
        onChange={(v: Tab) => setTab(v)}
        options={[
          { value: "counts", label: "Counts" },
          { value: "orders", label: "Orders" },
        ]}
      />
      {error ? <Banner>{error}</Banner> : null}

      {tab === "counts" ? (
        rows == null ? (
          <p className="mt-6 text-[15px] text-label-2">Loading counts...</p>
        ) : rows.length === 0 ? (
          <Empty title="No counts yet" body={`When ${name} finishes a count it appears here, with who counted and how much was counted.`} />
        ) : (
          <>
            {/* phones and tablets: rows */}
            <ul className="group-list mt-4 xl:hidden" aria-label="Counts">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`${base}/history/counts/${r.id}`} className="flex min-h-[68px] items-center gap-3 px-4 py-2.5 active:bg-fill hover:bg-fill">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px]">{r.dateLabel}</span>
                      <span className="block text-[13px] text-label-2">
                        {r.timeLabel} · {r.who}
                      </span>
                      {r.progressLabel ? <span className="block text-[13px] text-label-2">{r.progressLabel}</span> : null}
                    </span>
                    <Tag tone={r.inProgress ? "accent" : "neutral"}>{r.statusLabel}</Tag>
                    <ChevronRight className="-mr-1 h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            {/* desktop: a table */}
            <div className="mt-4 hidden overflow-hidden rounded-2xl bg-surface xl:block">
              <table className="w-full text-left text-[15px]">
                <caption className="sr-only">Counts, newest first</caption>
                <thead>
                  <tr className="text-[13px] text-label-2">
                    <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Counted By</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Counted</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="relative border-t border-[color:var(--separator)] hover:bg-fill">
                      <th scope="row" className="px-4 font-normal">
                        <Link href={`${base}/history/counts/${r.id}`} className="flex min-h-[56px] items-center after:absolute after:inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--label)]">
                          {r.dateLabel}
                          <span className="ml-2 text-[13px] text-label-2">{r.timeLabel}</span>
                        </Link>
                      </th>
                      <td className="px-3 text-label-2">{r.who}</td>
                      <td className="px-3 text-right tnum">{r.counted == null ? "" : `${r.counted} of ${r.total}`}</td>
                      <td className="px-4">
                        <Tag tone={r.inProgress ? "accent" : "neutral"}>{r.statusLabel}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {more ? (
              <div className="mt-4 flex justify-center">
                <TouchButton onClick={() => void showOlder()} disabled={loadingMore}>
                  {loadingMore ? "Loading..." : "Show Older Counts"}
                </TouchButton>
              </div>
            ) : null}
          </>
        )
      ) : orderRows == null ? (
        <p className="mt-6 text-[15px] text-label-2">Loading orders...</p>
      ) : orderRows.length === 0 ? (
        <Empty title="No orders yet" body={`Orders ${name} makes from a count, and top-up orders, are kept here with the exact text that was sent.`} />
      ) : (
        <>
          <ul className="group-list mt-4 xl:hidden" aria-label="Orders">
            {orderRows.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/orders/${r.id}`} className="flex min-h-[68px] items-center gap-3 px-4 py-2.5 active:bg-fill hover:bg-fill">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px]">{r.supplierName}</span>
                    <span className="block text-[13px] text-label-2">
                      {r.dateLabel} · {r.kindLabel}
                    </span>
                    <span className="block text-[13px] text-label-2">{r.whoLabel}</span>
                  </span>
                  <Tag tone={r.status === "Draft" ? "warn" : "neutral"}>{r.status}</Tag>
                  <ChevronRight className="-mr-1 h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 hidden overflow-hidden rounded-2xl bg-surface xl:block">
            <table className="w-full text-left text-[15px]">
              <caption className="sr-only">Orders, newest first</caption>
              <thead>
                <tr className="text-[13px] text-label-2">
                  <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Supplier</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Sent By</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Kind</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orderRows.map((r) => (
                  <tr key={r.id} className="relative border-t border-[color:var(--separator)] hover:bg-fill">
                    <th scope="row" className="px-4 font-normal">
                      <Link href={`${base}/orders/${r.id}`} className={cx("flex min-h-[56px] items-center after:absolute after:inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--label)]")}>
                        {r.dateLabel}
                      </Link>
                    </th>
                    <td className="px-3">{r.supplierName}</td>
                    <td className="px-3 text-label-2">{r.whoLabel.replace("Sent by ", "")}</td>
                    <td className="px-3 text-label-2">{r.kindLabel}</td>
                    <td className="px-4">
                      <Tag tone={r.status === "Draft" ? "warn" : "neutral"}>{r.status}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
