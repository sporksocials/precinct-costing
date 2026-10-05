"use client";

import Link from "next/link";
import { ClipboardCheck, WifiOff } from "lucide-react";
import { progressText, whenText } from "@/lib/ordering-count-ui";
import type { OrderingCountSession } from "@/lib/ordering-types";

/**
 * The start of the Count screen: Start Count, or Resume Count when one is in progress (only one per venue), and a way back
 * into the last finalised count. Starting needs a connection (it writes the new count to the database); resuming a count that
 * this device already holds does not.
 */
export function StartPanel({
  slug,
  venueName,
  productCount,
  categoryCount,
  open,
  last,
  counted,
  total,
  online,
  starting,
  error,
  nameOf,
  onStart,
  onViewLast,
}: {
  slug: string;
  venueName: string;
  productCount: number;
  categoryCount: number;
  open: OrderingCountSession | null;
  last: OrderingCountSession | null;
  counted: number;
  total: number;
  online: boolean;
  starting: boolean;
  error: string | null;
  nameOf: (email: string | null | undefined) => string | null;
  onStart: () => void;
  onViewLast: () => void;
}) {
  const cannotStart = !open && !online;
  return (
    <div className="mt-2 space-y-3">
      <section className="rounded-2xl bg-surface p-4">
        <h2 className="flex items-center gap-2 text-[20px] font-semibold">
          <ClipboardCheck className="h-5 w-5 text-accent" aria-hidden />
          {open ? "Count In Progress" : "Ready To Count"}
        </h2>
        {open ? (
          <p className="mt-1.5 text-[15px] text-label-2">
            Started by {nameOf(open.started_by) ?? "someone"} on {whenText(open.started_at)}. <span className="tnum">{progressText(counted, total)}.</span> Anyone at {venueName} can pick it up.
          </p>
        ) : (
          <p className="mt-1.5 text-[15px] text-label-2">
            <span className="tnum">{productCount}</span> products in <span className="tnum">{categoryCount}</span> {categoryCount === 1 ? "category" : "categories"}. Every number you enter is saved on this device first, so patchy wifi is fine.
          </p>
        )}
        {cannotStart ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[14px] text-warn">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            You are offline. Starting a new count needs a connection. Once it has started you can count with no signal.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn-primary !min-h-[44px] mt-4 w-full" disabled={starting || productCount === 0 || cannotStart} onClick={onStart}>
          {starting ? "Opening..." : open ? "Resume Count" : "Start Count"}
        </button>
        {productCount === 0 ? <p className="mt-2 text-[13px] text-label-2">There are no active products at {venueName} yet. Add them in Ordering setup first.</p> : null}
      </section>

      {last ? (
        <section className="rounded-2xl bg-surface p-4">
          <h2 className="text-[17px] font-semibold">Last Count</h2>
          <p className="mt-1 text-[15px] text-label-2">
            Finalised {whenText(last.finalised_at ?? last.started_at)}
            {last.finalised_by ? ` by ${nameOf(last.finalised_by) ?? "someone"}` : ""}. You can still correct a number: every edit is logged with the old value.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-plain !min-h-[44px]" disabled={starting} onClick={onViewLast}>
              View Last Count
            </button>
            <Link href={`/ordering/${slug}/orders`} className="btn-plain !min-h-[44px]">
              Go To Orders
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
