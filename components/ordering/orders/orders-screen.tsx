"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, Plus } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { VenueAccent } from "@/components/venue";
import { usePersonName } from "@/components/use-person-name";
import { Banner, Empty, ListSkeleton, PageHeader } from "@/components/ui";
import { ORDER_SIGN_OFF, buildSupplierOrders, orderingVenueName } from "@/lib/ordering";
import { brisbaneDay, brisbaneTime, countLabel, draftLinesFromGroup, finalisedCounts, orderCardGroups, pickCount, plural, sentOrdersFor } from "@/lib/ordering-orders-ui";
import type { OrderingCountSession, SuggestedLine, SupplierOrderGroup } from "@/lib/ordering-types";
import { useStore } from "@/lib/store";
import type { Venue } from "@/lib/types";
import { OrderCard, type SentEntry } from "./order-card";
import { ChoiceChips, Notice, btnPrimary, btnText } from "./parts";
import { PastOrders } from "./past-orders";
import { TopUpPanel } from "./topup";
import { useCountLines, useSentOrderLines, useVenueOrders } from "./use-orders-data";

/** The order builder at /ordering/<venue>/orders. */
export function OrdersScreen() {
  const { venue: slug } = useParams<{ venue: string }>();
  const store = useStore();
  const venue = store.venues.find((v) => v.slug === slug) ?? null;
  if (!store.ready && !store.venues.length) return <ListSkeleton rows={4} />;
  if (!venue) return <UnknownVenue />;
  return <OrdersForVenue venue={venue} />;
}

export function UnknownVenue() {
  return <Empty title="Venue Not Found" body="That venue is not in the list. Go back to Ordering and pick one." action={<Link href="/more" className={btnPrimary}>Back To More</Link>} />;
}

/** Chip labels for the finished counts: the day, plus the time when two counts share a day. */
function countChips(counts: readonly OrderingCountSession[]): { value: string; label: string }[] {
  const day = (s: OrderingCountSession) => brisbaneDay(s.finalised_at ?? s.started_at);
  return counts.slice(0, 6).map((s) => {
    const same = counts.filter((o) => day(o) === day(s)).length > 1;
    return { value: s.id, label: same ? `${day(s)} ${brisbaneTime(s.finalised_at ?? s.started_at)}` : day(s) };
  });
}

function OrdersForVenue({ venue }: { venue: Venue }) {
  const store = useStore();
  const nameOf = usePersonName();
  const senderName = ORDER_SIGN_OFF;
  const { status, error, data, orders, reloadOrders } = useVenueOrders(venue.id);
  const [wanted, setWanted] = useState<string | null>(null);
  const [topUp, setTopUp] = useState(false);

  const finished = useMemo(() => (data ? finalisedCounts(data.sessions) : []), [data]);
  const session = data ? pickCount(data.sessions, wanted) : null;
  const { lines: countLines, error: linesError } = useCountLines(session?.id ?? null);
  const sessionOrders = useMemo(() => (session ? orders.filter((o) => o.session_id === session.id && o.status === "sent") : []), [orders, session]);
  const sentLines = useSentOrderLines(sessionOrders);

  const groups = useMemo<SupplierOrderGroup[] | null>(() => (data && countLines ? buildSupplierOrders(data.products, countLines, { suppliers: data.suppliers, categories: data.categories }) : null), [data, countLines]);
  const sentSuppliers = useMemo(() => new Set(sessionOrders.map((o) => o.supplier_id)), [sessionOrders]);
  const cards = useMemo(() => (groups ? orderCardGroups(groups, sentSuppliers) : null), [groups, sentSuppliers]);

  const venueName = orderingVenueName(venue);
  const back = `/ordering/${venue.slug}`;

  return (
    <div className="max-w-[960px] lg:pt-4">
      <VenueAccent slug={venue.slug} />
      <BackLink path={back} fallback={back} className={`${btnText} -ml-2 !gap-0 !text-[17px]`}>
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
        Ordering
      </BackLink>
      <PageHeader
        title="Orders"
        subtitle={venueName}
        trailing={
          status === "ready" ? (
            <button type="button" onClick={() => setTopUp(true)} className={btnPrimary} aria-expanded={topUp}>
              <Plus aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.5} />
              New Top-Up Order
            </button>
          ) : null
        }
      />

      {status === "loading" ? <ListSkeleton rows={4} /> : null}
      {status === "error" ? <Banner>{error}</Banner> : null}

      {status === "ready" && data ? (
        <>
          {topUp ? <TopUpPanel venue={venue} suppliers={data.suppliers} products={data.products} senderName={senderName} userEmail={store.userEmail} nameOf={nameOf} onSaved={() => void reloadOrders()} onClose={() => setTopUp(false)} /> : null}

          <section className="mt-6" aria-label="Count to order from">
            <h2 className="px-1 pb-2 text-[13px] font-medium text-label-2">Count To Order From</h2>
            {session ? (
              <>
                {finished.length > 1 ? <ChoiceChips label="Choose a finished count" options={countChips(finished)} value={session.id} onChange={setWanted} /> : null}
                <p className="mt-2 flex flex-wrap items-center gap-x-3 px-1 text-[15px] text-label">
                  <span>
                    {countLabel(session, nameOf)} <span className="text-label-2">at {brisbaneTime(session.finalised_at ?? session.started_at)}</span>
                  </span>
                  <Link href={`/ordering/${venue.slug}/count?last=1`} className="inline-flex min-h-[44px] items-center text-accent">
                    Edit Count
                  </Link>
                </p>
              </>
            ) : (
              <Notice tone="neutral">
                <p className="font-medium text-label">No finished count yet.</p>
                <p className="mt-0.5">Orders are built from a finished count. You can still send a top-up order.</p>
                <Link href={`/ordering/${venue.slug}/count`} className={`${btnPrimary} mt-3`}>
                  Go To Count
                </Link>
              </Notice>
            )}
            {data.openSession && session ? (
              <p className="mt-1 px-1 text-[13px] text-label-2">
                A count is in progress. Orders use a finished count, so it will not show here until it is finished. <Link href={`/ordering/${venue.slug}/count`} className="inline-flex min-h-[44px] items-center text-accent">Go To Count</Link>
              </p>
            ) : null}
          </section>

          {session && linesError ? <Banner>{linesError}</Banner> : null}
          {session && !countLines && !linesError ? <ListSkeleton rows={3} /> : null}

          {session && cards && data ? (
            <div className="mt-6 space-y-4">
              {cards.assigned.length === 0 && !cards.unassigned ? <Empty title="Nothing To Order" body="This venue has no products set up yet." /> : null}
              {cards.assigned.map((g) => {
                const supplier = g.supplier!;
                const suggestions = new Map<string, SuggestedLine>([...g.lines, ...g.zeroLines, ...g.uncountedLines].map((l) => [l.product.id, l]));
                const sent: SentEntry[] = sentOrdersFor(orders, session.id, supplier.id).map((order) => ({ order, lines: sentLines.get(order.id) ?? null }));
                return (
                  <OrderCard
                    key={`${session.id}:${supplier.id}`}
                    venue={venue}
                    supplier={supplier}
                    products={data.products}
                    suppliers={data.suppliers}
                    suggestions={suggestions}
                    initialLines={draftLinesFromGroup(g)}
                    notNeeded={g.zeroLines}
                    uncounted={g.uncountedLines}
                    kind="count"
                    sessionId={session.id}
                    scope="supplier"
                    sent={sent}
                    senderName={senderName}
                    userEmail={store.userEmail}
                    nameOf={nameOf}
                    onSaved={() => void reloadOrders()}
                  />
                );
              })}
              {cards.unassigned ? <UnassignedCard group={cards.unassigned} slug={venue.slug} /> : null}
            </div>
          ) : null}

          <PastOrders venueSlug={venue.slug} orders={orders} suppliers={data.suppliers} nameOf={nameOf} />
        </>
      ) : null}
    </div>
  );
}

/** Products with no supplier: they cannot be ordered until a supplier is set, so this is a warning and a list, never a send. */
function UnassignedCard({ group, slug }: { group: SupplierOrderGroup; slug: string }) {
  return (
    <section aria-label="Products with no supplier" className="overflow-hidden rounded-2xl bg-surface">
      <div className="px-4 pt-4">
        <h3 className="text-[20px] font-semibold text-label">Unassigned</h3>
        <Notice tone="warn" className="mt-3" role="status">
          <p className="font-medium">{plural(group.lines.length + group.uncountedLines.length, "product")} with no supplier.</p>
          <p className="mt-0.5 text-[14px] text-label-2">These are not on any order. Set a supplier on each product in the Ordering setup, then come back.</p>
          <Link href={`/ordering/${slug}`} className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-accent">
            <AlertTriangle aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            Open Ordering
          </Link>
        </Notice>
      </div>
      <ul className="mt-2 pb-2">
        {[...group.lines.map((l) => ({ l, note: `Suggested ${l.suggestion.orderQty}` })), ...group.uncountedLines.map((l) => ({ l, note: "Not counted" }))].map(({ l, note }) => (
          <li key={l.product.id} className="flex items-center gap-3 border-t border-[color:var(--separator)] px-4 py-2.5 first:border-t-0">
            <span className="min-w-0 flex-1 truncate text-[15px] text-label">{l.product.name}</span>
            <span className="shrink-0 text-[13px] text-label-2 tnum">
              {l.product.unit_name} · {note}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
