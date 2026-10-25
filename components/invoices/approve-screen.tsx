"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { INVOICES_UNAVAILABLE } from "@/lib/invoice-data-extra";
import { skipLine, unskipLine } from "@/lib/invoice-data";
import { limitText, tidyLabel } from "@/lib/invoice-names";
import {
  approveSequentially,
  approveSummary,
  defaultSelection,
  groupBySupplier,
  isStaleIngredient,
  lookCloselyText,
  outcomeText,
  pricesWord,
  settleBigChange,
  type ApproveFailure,
  type ApproveRow,
} from "@/lib/invoice-todo-approve";
import { Banner, cx, Empty, ListSkeleton, PageHeader, useToast } from "@/components/ui";
import { VenueFilter, useVenue } from "@/components/venue";
import { TouchBack, TouchButton, TouchLink } from "@/components/ordering/touch";
import { ApproveConfirm } from "./approve-confirm";
import { ApproveHeader, ApprovePriceRow } from "./approve-row";
import { useApprovePrices } from "./approve-use-data";

interface Result {
  text: string;
  ok: boolean;
  failures: ApproveFailure[];
}

/**
 * /invoices/approve: every price an invoice changed that is waiting for a person, in one list. Grouped by supplier; the small
 * changes are ticked already, the big ones (the auto-apply limit or more) are first, unticked and marked. Approving goes one
 * price at a time through applyLine, with a progress bar, and says plainly what it did and what it could not do.
 */
export function ApproveScreen() {
  const store = useStore();
  const toast = useToast();
  const { venue } = useVenue();
  const { data, error, loading, reload } = useApprovePrices(venue?.slug ?? null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ApproveRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const limit = data?.limit ?? 0.05;
  const ingById = useMemo(() => new Map(store.ingredients.map((i) => [i.id, i])), [store.ingredients]);
  const ingOf = (r: ApproveRow) => (r.line.ingredient_id ? (ingById.get(r.line.ingredient_id) ?? null) : null);
  const stale = (r: ApproveRow) => isStaleIngredient(r, ingOf(r)?.pack_price);
  const nameOf = (r: ApproveRow) => ingOf(r)?.name ?? tidyLabel(r.line.description);
  const groups = useMemo(() => groupBySupplier(rows), [rows]);

  // new rows start ticked (when they are ordinary), rows that left the list drop out, and what a person ticked or unticked stays
  useEffect(() => {
    if (!data) return;
    const fresh = rows.filter((r) => !seen.current.has(r.line.id));
    fresh.forEach((r) => seen.current.add(r.line.id));
    setSelected((cur) => {
      const live = new Set(rows.map((r) => r.line.id));
      const next = new Set([...cur].filter((id) => live.has(id)));
      for (const id of defaultSelection(fresh, (r) => isStaleIngredient(r, (r.line.ingredient_id ? ingById.get(r.line.ingredient_id) : undefined)?.pack_price))) next.add(id);
      return next;
    });
    // ingById is read for the stale test on first sight only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const picked = rows.filter((r) => selected.has(r.line.id) && !stale(r));
  const warning = lookCloselyText(rows, limit);
  const actor = store.userEmail ?? "unknown";

  const approve = async (list: ApproveRow[]) => {
    setProgress({ done: 0, total: list.length });
    const out = await approveSequentially(getSupabaseBrowser(), list, actor, { onProgress: (done, total) => setProgress({ done, total }) });
    setProgress(null);
    setConfirm(null);
    void store.reload();
    await reload();
    setResult({ text: outcomeText(out, Math.max(0, rows.length - out.done.length)), ok: out.done.length > 0, failures: out.failed });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const skip = async (r: ApproveRow) => {
    setBusyId(r.line.id);
    try {
      const sb = getSupabaseBrowser();
      const res = await skipLine(sb, r.line.id);
      if (res.ok) {
        await settleBigChange(sb, r.line.id, "reject_change", actor);
        toast.show({
          message: res.message,
          action: {
            label: "Undo",
            onClick: () => {
              void unskipLine(getSupabaseBrowser(), r.line.id).then(() => reload());
            },
          },
        });
      } else toast.show({ message: res.message });
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const running = progress !== null;
  const waiting = !loading && data !== null && !data.missing && rows.length > 0;

  return (
    <div className="max-w-6xl pb-8">
      <div className="pt-1 lg:pt-6">
        <TouchBack path="/invoices" fallback="/invoices">
          Invoices
        </TouchBack>
      </div>
      <PageHeader title="Approve Prices" subtitle={loading ? undefined : data?.missing ? undefined : rows.length ? `${pricesWord(rows.length)} waiting` : "All done"} className="!pt-0 lg:!pt-2" />

      <VenueFilter stats={false} compact />

      {error && !data ? <Banner action={<TouchButton onClick={() => void reload()}>Try Again</TouchButton>}>{error}</Banner> : null}
      {loading && !data && !error ? <ListSkeleton rows={5} /> : null}
      {data?.missing ? <Empty title="Invoices Are Not Set Up Yet" body={INVOICES_UNAVAILABLE} /> : null}

      {result ? (
        <section aria-label="What just happened" className="mt-4 rounded-2xl bg-surface px-4 py-3.5" aria-live="polite">
          <p className="flex items-start gap-2 text-[17px] font-medium leading-snug sm:text-[15px]">
            {result.ok ? <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-good" strokeWidth={2.25} /> : <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warn" strokeWidth={2.5} />}
            <span>{result.text}</span>
          </p>
          {result.failures.length > 0 ? (
            <ul className="mt-3 space-y-2" aria-label="Prices that could not be updated">
              {result.failures.map((f) => (
                <li key={f.row.line.id} className="rounded-xl bg-warn-soft px-3 py-2 text-[15px] text-warn">
                  <p className="flex items-start gap-1.5 font-semibold">
                    <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
                    <span>{nameOf(f.row)}</span>
                  </p>
                  <p className="mt-0.5 pl-[22px] font-medium">{f.message}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <TouchLink href="/invoices?tab=changes" variant="tinted">
              Open What Changed
            </TouchLink>
            <TouchButton variant="text" onClick={() => setResult(null)}>
              Dismiss
            </TouchButton>
          </div>
        </section>
      ) : null}

      {data && !data.missing && rows.length === 0 && !loading ? (
        <Empty
          title="Nothing To Approve. Nice work."
          body="When an invoice changes a price, it waits here for you."
          action={
            <TouchLink href="/invoices" variant="tinted">
              Back To Invoices
            </TouchLink>
          }
        />
      ) : null}

      {waiting ? (
        <>
          <p className="mt-4 text-[17px] leading-snug sm:text-[15px]">{approveSummary(rows, limit)}</p>
          {warning ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-4 py-3 text-[15px] font-medium leading-snug text-warn" role="note">
              <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} />
              <span>{warning}</span>
            </p>
          ) : null}

          <div className="mt-5 space-y-6">
            {groups.map((g) => {
              const easy = g.easy.filter((r) => !stale(r));
              return (
                <section key={g.key} aria-label={g.name}>
                  <div className="flex flex-col gap-2 px-1 pb-2 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="break-words text-[20px] font-bold leading-tight tracking-tight">{g.name}</h2>
                      <p className="text-[15px] text-label-2 sm:text-[13px]">
                        {pricesWord(g.rows.length)}
                        {g.flagged ? `, ${g.flagged} to look at closely` : ""}
                      </p>
                    </div>
                    {easy.length > 0 ? (
                      <TouchButton variant="tinted" disabled={running} className="w-full sm:w-auto" onClick={() => setConfirm(easy)}>
                        {`Approve All Under ${limitText(limit)}`}
                        <span className="font-normal opacity-80">{`(${easy.length})`}</span>
                      </TouchButton>
                    ) : null}
                  </div>
                  <div className="overflow-hidden rounded-2xl bg-surface">
                    <ApproveHeader />
                    <ul className="divide-y divide-separator" aria-label={`${g.name} prices`}>
                      {g.rows.map((r) => (
                        <ApprovePriceRow
                          key={r.line.id}
                          row={r}
                          ingredient={ingOf(r)}
                          selected={selected.has(r.line.id)}
                          stale={stale(r)}
                          disabled={running || busyId === r.line.id}
                          onToggle={() => toggle(r.line.id)}
                          onSkip={() => void skip(r)}
                        />
                      ))}
                    </ul>
                  </div>
                </section>
              );
            })}
          </div>

          {/* room for the bar below, so the last row is never hidden behind it */}
          <div aria-hidden className="h-[130px] sm:h-[96px]" />
          <div
            role="region"
            aria-label="Approve Selected"
            className="bar-blur fixed inset-x-0 bottom-[calc(50px+env(safe-area-inset-bottom))] z-[45] px-4 pb-3 pt-2.5 lg:bottom-0 lg:left-[248px]"
            style={{ boxShadow: "inset 0 0.5px 0 var(--separator)" }}
          >
            <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 lg:px-6">
              <p role="status" aria-live="polite" className={cx("basis-full text-[15px] text-label-2 sm:basis-0 sm:flex-1 sm:text-[13px]")}>
                {picked.length === 0 ? "Nothing ticked yet." : `${picked.length} of ${rows.length} ticked.`}
              </p>
              {selected.size > 0 ? (
                <TouchButton variant="text" disabled={running} onClick={() => setSelected(new Set())}>
                  Clear Ticks
                </TouchButton>
              ) : null}
              <TouchButton variant="primary" disabled={running || picked.length === 0} className="flex-1 sm:flex-none" onClick={() => setConfirm(picked)}>
                {`Approve Selected (${picked.length})`}
              </TouchButton>
            </div>
          </div>
        </>
      ) : null}

      <ApproveConfirm rows={confirm} limit={limit} nameOf={nameOf} progress={progress} onClose={() => setConfirm(null)} onConfirm={() => confirm && void approve(confirm)} />
    </div>
  );
}
