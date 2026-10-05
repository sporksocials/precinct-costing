"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadCountLines } from "@/lib/ordering-data";
import { loadSession, loadSessionsPage } from "@/lib/ordering-screens-data";
import {
  changeSummary,
  countAsText,
  countDetailGroups,
  countHeadline,
  countWho,
  dayLabel,
  dayLabelFull,
  timeLabel,
  withChanges,
  type CountDetailGroup,
  type CountDetailRow,
} from "@/lib/ordering-history-view";
import { qtyText } from "@/lib/ordering";
import type { OrderingCountLine, OrderingCountSession } from "@/lib/ordering-types";
import { Banner, cx, Empty, PageHeader, useToast } from "@/components/ui";
import { usePersonName } from "@/components/use-person-name";
import { useUrlFlag } from "@/components/use-url-state";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { useVenueData } from "@/components/ordering/use-venue-data";
import { copyText } from "@/components/ordering/clipboard";
import { SwitchRow, Tag, TouchBack, TouchButton, TouchLink } from "@/components/ordering/touch";

function orderWords(r: CountDetailRow): string {
  if (r.state === "Not Counted") return "Not counted";
  if (r.suggested > 0) return `Order ${qtyText(r.suggested)}`;
  if (r.over > 0) return `Over by ${qtyText(r.over)}`;
  return "Nothing to order";
}

function StateTag({ r }: { r: CountDetailRow }) {
  return <Tag tone={r.state === "Below Build To" ? "warn" : r.state === "Over Build To" ? "accent" : "neutral"}>{r.state}</Tag>;
}

/** The change since the previous count in words with an arrow (the arrow is decoration, the words carry the meaning). */
function ChangeText({ r }: { r: CountDetailRow }) {
  const c = r.change;
  if (!c || c.kind === "none") return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {c.arrow ? (
        <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded bg-fill text-[13px] font-semibold">
          {c.arrow}
        </span>
      ) : null}
      <span>
        {c.word}
        {c.kind === "up" || c.kind === "down" || c.kind === "same" ? <span className="text-label-2"> (was {qtyText(c.prev ?? 0)})</span> : null}
      </span>
    </span>
  );
}

export default function OrderingCountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { venue, name, base } = useOrderingVenue();
  const nameOf = usePersonName();
  const toast = useToast();
  const { sb, data } = useVenueData(venue.id);
  const [compare, setCompare] = useUrlFlag("compare");

  const [session, setSession] = useState<OrderingCountSession | null | undefined>(undefined);
  const [lines, setLines] = useState<OrderingCountLine[] | null>(null);
  const [prev, setPrev] = useState<OrderingCountSession | null | undefined>(undefined);
  const [prevLines, setPrevLines] = useState<OrderingCountLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSession(undefined);
    setLines(null);
    setPrev(undefined);
    setPrevLines(null);
    (async () => {
      try {
        const s = await loadSession(sb, venue.id, id);
        if (!live) return;
        setSession(s);
        if (!s) return;
        const [l, older] = await Promise.all([loadCountLines(sb, id), loadSessionsPage(sb, venue.id, { before: s.started_at, limit: 1 })]);
        if (!live) return;
        setLines(l);
        setPrev(older[0] ?? null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [sb, venue.id, id]);

  useEffect(() => {
    if (!compare || !prev || prevLines) return;
    let live = true;
    loadCountLines(sb, prev.id)
      .then((l) => live && setPrevLines(l))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [compare, prev, prevLines, sb]);

  const base0 = useMemo<CountDetailGroup[] | null>(() => (data && lines ? countDetailGroups({ products: data.products, categories: data.categories, lines }) : null), [data, lines]);
  const comparing = !!compare && !!prev && !!prevLines;
  const groups = useMemo(() => (base0 && comparing && prevLines ? withChanges(base0, prevLines) : base0), [base0, comparing, prevLines]);
  const head = useMemo(() => (groups ? countHeadline(groups) : null), [groups]);
  const changes = useMemo(() => (groups && comparing ? changeSummary(groups) : null), [groups, comparing]);

  const backHref = `${base}/history`;
  const back = (
    <TouchBack path={backHref} fallback={backHref}>
      History
    </TouchBack>
  );

  if (session === null || (session === undefined && error)) {
    return (
      <div className="max-w-4xl lg:pt-6">
        {back}
        {error ? <Banner>{error}</Banner> : <Empty title="Count Not Found" body={`It may belong to another venue.`} action={<TouchLink href={backHref} variant="primary">Back To History</TouchLink>} />}
      </div>
    );
  }
  if (!session) {
    return (
      <div className="max-w-4xl lg:pt-6">
        {back}
        <p className="mt-6 text-[15px] text-label-2">Loading count...</p>
      </div>
    );
  }

  const who = countWho(session, nameOf);
  const statusLabel = session.status === "finalised" ? "Finalised" : "In progress";

  async function copy() {
    if (!groups || !session) return;
    const text = countAsText({
      venueName: name,
      dateLabel: dayLabelFull(session.started_at),
      who,
      status: statusLabel,
      groups,
      compare: comparing,
      previousLabel: prev ? dayLabelFull(prev.started_at) : null,
    });
    const ok = await copyText(text);
    toast.show({ message: ok ? "Count copied as text" : "Could not copy. Select the text and copy it by hand." });
  }

  return (
    <div className="max-w-5xl lg:pt-6">
      {back}
      <PageHeader title={dayLabel(session.started_at)} subtitle={`${timeLabel(session.started_at)} · ${who} · ${statusLabel}`} className="lg:!pt-2" />
      {error ? <Banner>{error}</Banner> : null}
      <p className="text-[13px] text-label-2">A read-only record. Build To is the level it was set to on the day of the count.</p>
      <TouchButton className="mt-3 w-full sm:w-auto" onClick={() => void copy()} disabled={!groups}>
        Copy As Text
      </TouchButton>

      {head ? (
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Counted", head.counted],
            ["Not Counted", head.uncounted],
            ["Below Build To", head.below],
            ["Over Build To", head.over],
          ].map(([label, n]) => (
            <div key={label as string} className="rounded-2xl bg-surface px-4 py-3">
              <dt className="text-[13px] text-label-2">{label}</dt>
              <dd className="text-[24px] font-semibold tnum">{n}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-2xl bg-surface">
        <SwitchRow
          checked={!!compare && !!prev}
          onChange={(v) => setCompare(v)}
          disabled={prev === null}
          label="Compare To Previous Count"
          sub={prev === undefined ? "Looking for an earlier count..." : prev === null ? "There is no earlier count to compare to." : `Compared with the count on ${dayLabel(prev.started_at)}.`}
        />
      </div>
      {changes ? (
        <p className="mt-2 text-[15px]" role="status">
          Since {prev ? dayLabel(prev.started_at) : "the last count"}: {changes.up} up, {changes.down} down, {changes.same} the same.
        </p>
      ) : null}

      {!groups ? <p className="mt-6 text-[15px] text-label-2">Loading products...</p> : null}
      {groups && groups.length === 0 ? <Empty title="Nothing was counted" body="This count has no products." /> : null}

      {groups?.map((g) => (
        <section key={g.categoryId} className="mt-6" aria-label={g.name}>
          <h2 className="px-4 pb-1.5 text-[13px] font-medium text-label-2">
            {g.name} · {g.rows.length}
          </h2>

          <ul className="group-list xl:hidden">
            {g.rows.map((r) => (
              <li key={r.productId} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`${base}/history/products/${r.productId}`} className="-my-1 flex min-h-[44px] min-w-0 flex-1 items-center text-[17px]">
                    <span className="truncate">{r.name}</span>
                  </Link>
                  <StateTag r={r} />
                </div>
                {r.state === "Not Counted" ? null : (
                  <p className="mt-0.5 text-[15px] text-label-2 tnum">
                    Store {qtyText(r.store ?? 0)}
                    {g.secondLabel ? ` · ${g.secondLabel} ${qtyText(r.second ?? 0)}` : ""} · Total {qtyText(r.total ?? 0)} {r.unit}
                  </p>
                )}
                <p className="mt-0.5 text-[15px] tnum">
                  Build To {r.par == null ? "not set" : qtyText(r.par)} · {orderWords(r)}
                </p>
                {r.change && r.change.kind !== "none" ? (
                  <p className="mt-0.5 text-[15px]">
                    <ChangeText r={r} />
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-2xl bg-surface xl:block">
            <table className="w-full table-fixed text-left text-[15px]">
              <caption className="sr-only">{g.name}</caption>
              <colgroup>
                <col />
                <col className="w-[88px]" />
                <col className="w-[110px]" />
                <col className="w-[88px]" />
                <col className="w-[100px]" />
                <col className="w-[140px]" />
                {comparing ? <col className="w-[210px]" /> : null}
              </colgroup>
              <thead>
                <tr className="text-[13px] text-label-2">
                  <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Store</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{g.secondLabel ?? "Second Place"}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Build To</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Suggested</th>
                  {comparing ? <th scope="col" className="px-4 py-2.5 font-medium">Change</th> : null}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.productId} className="border-t border-[color:var(--separator)]">
                    <th scope="row" className="px-4 font-normal">
                      <Link href={`${base}/history/products/${r.productId}`} className="flex min-h-[48px] items-center hover:underline">
                        {r.name}
                        <span className="ml-2 text-[13px] text-label-2">{r.unit}</span>
                      </Link>
                    </th>
                    <td className="px-3 text-right tnum">{r.store == null ? "" : qtyText(r.store)}</td>
                    <td className="px-3 text-right tnum">{g.secondLabel && r.second != null ? qtyText(r.second) : ""}</td>
                    <td className="px-3 text-right tnum font-medium">{r.total == null ? "" : qtyText(r.total)}</td>
                    <td className="px-3 text-right tnum text-label-2">{r.par == null ? "" : qtyText(r.par)}</td>
                    <td className="px-3">
                      <span className={cx(r.suggested > 0 && "font-medium")}>{orderWords(r)}</span>
                    </td>
                    {comparing ? (
                      <td className="px-4">
                        <ChangeText r={r} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
