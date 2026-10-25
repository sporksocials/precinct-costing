"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileText, HelpCircle, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { money } from "@/lib/format";
import { applyLine } from "@/lib/invoice-apply";
import { productDiscountTargets } from "@/lib/invoice-discounts";
import { tidyLabel } from "@/lib/invoice-names";
import { skipLine, unskipLine, useInvoiceDetail } from "@/lib/invoice-data";
import {
  approveLabel,
  checkItems,
  dayLabel,
  decisionText,
  docStats,
  docTitle,
  numberLabel,
  splitLines,
  statsFor,
  statusView,
  totalsStrip, isUnread,
} from "@/lib/invoice-view";
import type { InvoiceLineRow, InvoicePriceChangeRow, LineClass } from "@/lib/invoice-types";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { VenueAccent, VENUE_SHORT } from "@/components/venue";
import { VenueTag } from "@/components/brand";
import { Banner, cx, Empty, ListSkeleton, useToast } from "@/components/ui";
import { TouchBack, TouchButton, TouchLink, TouchSheet } from "@/components/ordering/touch";
import { usePersonName } from "@/components/use-person-name";
import { InvoiceTabs } from "./inv-tabs";
import { StatusLabel } from "./inv-parts";
import { ChargeLine, InvLine } from "./inv-line";
import { UndoChangeSheet, UndoDocumentSheet } from "./inv-undo";

/** One invoice: the checks in words, its PDF, every line with what it matched and decided, and what a person can do about it. */
export function InvoiceDetail({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const nameOf = usePersonName();
  const detail = useInvoiceDetail(id);
  const d = detail.data;
  const [approving, setApproving] = useState<InvoiceLineRow | null>(null);
  const [undoing, setUndoing] = useState<InvoicePriceChangeRow | null>(null);
  const [undoAll, setUndoAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const ingById = useMemo(() => new Map(store.ingredients.map((i) => [i.id, i])), [store.ingredients]);
  const lineView = useMemo(() => splitLines(d?.lines ?? []), [d?.lines]);
  // negative lines that are a standing discount on a product: they come off that product's price and are not spread or counted as credits
  const discountTargets = useMemo(() => productDiscountTargets(d?.lines ?? []), [d?.lines]);
  const poolClasses = useMemo<LineClass[]>(() => lineView.charges.filter((c) => !discountTargets.has(c.id)).map((c) => c.line_class), [lineView.charges, discountTargets]);
  const changesByLine = useMemo(() => {
    const m = new Map<string, InvoicePriceChangeRow[]>();
    for (const c of d?.changes ?? []) m.set(c.line_id, [...(m.get(c.line_id) ?? []), c]);
    return m;
  }, [d?.changes]);
  const stats = useMemo(
    () => (d?.doc ? statsFor(docStats(d.changes, d.questions, d.lines.filter((l) => l.decision === "needs_approval" && l.state === "open")), d.doc.id) : null),
    [d],
  );

  if (detail.loading && !d) return <ListSkeleton rows={6} />;
  if (detail.error && !d) return <Banner action={<TouchButton onClick={() => void detail.reload()}>Try Again</TouchButton>}>{detail.error}</Banner>;
  if (!d) return null;
  const back = (
    <TouchBack path="/invoices" fallback="/invoices">
      Invoices
    </TouchBack>
  );
  if (d.missing || !d.doc || !stats)
    return (
      <div>
        {back}
        <Empty title={d.missing ? "Invoices Are Not Set Up Yet" : "Invoice Not Found"} body={d.missing ? "Once they are, every scanned invoice appears here." : "It may have been removed, or the link is old."} action={<TouchLink href="/invoices">Back To Invoices</TouchLink>} />
      </div>
    );

  const doc = d.doc;
  const venue = store.venueById.get(doc.venue_id);
  const venueName = venue ? (VENUE_SHORT[venue.slug] ?? venue.name) : null;
  const status = statusView(doc.status, stats, isUnread(doc));
  const checks = checkItems(doc);
  const totals = totalsStrip(doc);
  const title = docTitle(doc, d.supplierName);
  const applied = d.changes.filter((c) => c.status === "applied");
  const changeItemName = (c: InvoicePriceChangeRow) => {
    const line = d.lines.find((l) => l.id === c.line_id);
    return (c.target === "ingredient" ? ingById.get(c.target_id)?.name : d.products.get(c.target_id)?.name) ?? line?.description ?? "This item";
  };
  const changeCurrent = (c: InvoicePriceChangeRow) => (c.target === "ingredient" ? (ingById.get(c.target_id)?.pack_price ?? null) : (d.products.get(c.target_id)?.price ?? null));

  const after = async () => {
    await detail.reload();
  };
  const skip = async (l: InvoiceLineRow, undo: boolean) => {
    setBusyId(l.id);
    try {
      const r = await (undo ? unskipLine(getSupabaseBrowser(), l.id) : skipLine(getSupabaseBrowser(), l.id));
      toast.show({ message: r.message });
      await after();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <VenueAccent slug={venue?.slug} />
      {back}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:gap-8">
        <div className="min-w-0">
          <header className="pb-2 pt-1">
            <h1 className="display text-[36px] leading-tight text-label lg:text-[40px]">{title}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-label-2">
              <span>{numberLabel(doc.invoice_number)}</span>
              <span aria-hidden>·</span>
              <span>{dayLabel(doc.invoice_date) || dayLabel(doc.created_at)}</span>
              {venue ? (
                <>
                  <span aria-hidden>·</span>
                  <VenueTag slug={venue.slug} name={venueName ?? venue.name} size={16} />
                </>
              ) : null}
            </p>
            <p className="mt-2">
              <StatusLabel view={status} />
            </p>
          </header>

          <div className="mb-3 lg:hidden">
            {d.pdfUrl ? (
              <TouchLink href={d.pdfUrl} target="_blank" rel="noopener noreferrer" className="w-full">
                <FileText aria-hidden className="h-5 w-5" strokeWidth={2.25} />
                View Invoice PDF
              </TouchLink>
            ) : (
              <p className="text-[13px] text-label-2">The invoice PDF is not available yet.</p>
            )}
          </div>

          <section aria-labelledby="inv-checks" className="mt-4">
            <h2 id="inv-checks" className="px-1 pb-1.5 text-[13px] font-medium text-label-2">
              Checks
            </h2>
            <ul className="group-list">
              {checks.map((c) => (
                <li key={c.key} className="flex items-start gap-3 px-4 py-3">
                  {c.ok === true ? <Check aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-good" strokeWidth={3} /> : c.ok === false ? <X aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-danger" strokeWidth={3} /> : <HelpCircle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warn" strokeWidth={2.5} />}
                  <div className="min-w-0">
                    <p className={cx("text-[17px] font-medium leading-snug sm:text-[15px]", c.ok === true ? "text-good" : c.ok === false ? "text-danger" : "text-warn")}>{c.label}</p>
                    {c.detail ? <p className="mt-0.5 text-[15px] text-label-2 sm:text-[13px]">{c.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Totals" className="mt-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Subtotal Ex GST", totals.subtotalEx],
                ["GST", totals.gst],
                ["Total Inc GST", totals.totalInc],
                ["Delivery And Fees Spread", totals.feePool ?? "None"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-surface px-3 py-2.5">
                  <dt className="text-[13px] text-label-2">{k}</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold tnum">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {d.questions.length > 0 ? (
            <section aria-labelledby="inv-questions" className="mt-6">
              <h2 id="inv-questions" className="px-1 pb-1.5 text-[13px] font-medium text-label-2">
                {`Questions (${d.questions.length})`}
              </h2>
              <ul className="group-list">
                {d.questions.map((q) => (
                  <li key={q.id} className="flex items-start gap-3 px-4 py-3">
                    <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warn" strokeWidth={2.5} />
                    <p className="min-w-0 text-[17px] leading-snug sm:text-[15px]">{q.prompt}</p>
                  </li>
                ))}
                <li>
                  <Link href={`/invoices/questions?doc=${doc.id}`} className="flex min-h-[48px] items-center px-4 text-[17px] font-semibold text-accent sm:text-[15px]">
                    Match Lines And Answer Questions
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="inv-lines" className="mt-6">
            <h2 id="inv-lines" className="px-1 pb-1.5 text-[13px] font-medium text-label-2">
              {`Products (${lineView.products.length})`}
            </h2>
            {lineView.products.length === 0 ? (
              <p className="rounded-2xl bg-surface px-4 py-4 text-[15px] text-label-2">No product lines were read from this invoice.</p>
            ) : (
              <ul className="group-list">
                {lineView.products.map((l) => (
                  <InvLine
                    key={l.id}
                    line={l}
                    ingredient={l.ingredient_id ? (ingById.get(l.ingredient_id) ?? null) : null}
                    productName={l.product_id ? (d.products.get(l.product_id)?.name ?? null) : null}
                    venueSlug={venue?.slug ?? null}
                    poolClasses={poolClasses}
                    changes={changesByLine.get(l.id) ?? []}
                    nameOf={nameOf}
                    h={{
                      onApprove: setApproving,
                      onSkip: (x) => void skip(x, false),
                      onUnskip: (x) => void skip(x, true),
                      onUndo: setUndoing,
                      busyId,
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {lineView.charges.length > 0 ? (
            <section aria-labelledby="inv-charges" className="mt-6">
              <h2 id="inv-charges" className="px-1 pb-1.5 text-[13px] font-medium text-label-2">
                Charges And Credits
              </h2>
              <ul className="group-list">
                {lineView.charges.map((l) => (
                  <ChargeLine
                    key={l.id}
                    line={l}
                    doc={doc}
                    rules={d.chargeRules}
                    supplierId={doc.supplier_id}
                    takenOff={discountTargets.has(l.id) ? tidyLabel(d.lines.find((x) => x.id === discountTargets.get(l.id))?.description) : null}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {applied.length > 0 ? (
            <div className="mt-6">
              <TouchButton variant="danger" className="w-full sm:w-auto" onClick={() => setUndoAll(true)}>
                Undo Whole Invoice
              </TouchButton>
              <p className="mt-1.5 px-1 text-[13px] text-label-2">Puts back every price this invoice set.</p>
            </div>
          ) : null}
        </div>

        <aside className="hidden lg:block" aria-label="Invoice PDF">
          <div className="sticky top-6">
            {d.pdfUrl ? (
              <iframe title="Invoice PDF" src={d.pdfUrl} className="h-[calc(100vh-3rem)] w-full rounded-2xl bg-surface" />
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-6 text-[15px] text-label-2">The invoice PDF is not available yet.</p>
            )}
          </div>
        </aside>
      </div>

      <ApproveSheet
        line={approving}
        reconciled={doc.reconciled}
        itemName={approving ? (ingById.get(approving.ingredient_id ?? "")?.name ?? d.products.get(approving.product_id ?? "")?.name ?? approving.description) : ""}
        onClose={() => setApproving(null)}
        onDone={after}
      />
      <UndoChangeSheet change={undoing} itemName={undoing ? changeItemName(undoing) : ""} currentPrice={undoing ? changeCurrent(undoing) : null} onClose={() => setUndoing(null)} onDone={() => void after()} />
      <UndoDocumentSheet documentId={doc.id} open={undoAll} count={applied.length} onClose={() => setUndoAll(false)} onDone={() => void after()} />
    </div>
  );
}

/** Shows exactly what Approve will change, then calls applyLine in approved mode. Nothing here writes a price itself. */
function ApproveSheet({ line, reconciled, itemName, onClose, onDone }: { line: InvoiceLineRow | null; reconciled: boolean; itemName: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { userEmail, reload } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!line) return null;
  const confirmOnly = line.decision === "same";
  const rows: { label: string; now: number | null; next: number | null }[] = [];
  if (line.ingredient_id) rows.push({ label: "Ingredient price", now: line.old_pack_price, next: line.new_pack_price });
  if (line.product_id) rows.push({ label: "Ordering price (inc GST)", now: line.old_product_price, next: line.new_product_price });

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await applyLine(getSupabaseBrowser(), { lineId: line.id, actor: userEmail ?? "unknown", mode: "approved" });
      if (!r.ok) {
        setError(r.message || "That could not be applied.");
        return;
      }
      toast.show({ message: r.message || "Applied." });
      void reload();
      await onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be applied.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchSheet open onClose={onClose} title={approveLabel(line)} size="sm">
      <div className="space-y-4 pb-2">
        <h3 className="text-[20px] font-semibold leading-tight">{confirmOnly ? "Confirm This Price?" : "Approve This Price?"}</h3>
        <div className="space-y-2 rounded-2xl bg-surface-2 px-4 py-3">
          <p className="text-[17px] font-semibold">{itemName}</p>
          {rows.map((r) => (
            <p key={r.label} className="text-[15px] text-label-2">
              {r.label}: <span className="tnum text-label">{money(r.now)}</span>
              {confirmOnly ? <span> stays the same</span> : <> to <span className="tnum font-semibold text-label">{money(r.next)}</span></>}
            </p>
          ))}
        </div>
        {confirmOnly ? null : (
          <p className="text-[15px] text-label-2">
            <span className="font-semibold text-label">Why you are being asked: </span>
            {decisionText(line)}
          </p>
        )}
        {reconciled ? null : (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[15px] font-medium text-warn">
            <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span>This invoice does not add up. Check the invoice before you approve.</span>
          </p>
        )}
        <p className="text-[15px] text-label-2">{confirmOnly ? "Only the date the price was last checked changes. You can undo it." : "The price history will say which invoice set it. You can undo it from this page."}</p>
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-[15px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <TouchButton variant="primary" disabled={busy} onClick={() => void go()} className="sm:flex-1">
            {busy ? "Applying..." : approveLabel(line)}
          </TouchButton>
          <TouchButton onClick={onClose} className="sm:flex-1">
            Not Yet
          </TouchButton>
        </div>
      </div>
    </TouchSheet>
  );
}
