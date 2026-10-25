"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Target } from "lucide-react";
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
  detailSentence,
  docTitle,
  feeShareText,
  landedText,
  LANDED_EXPLAIN,
  lineStatus,
  numberLabel,
  splitLines,
  totalsStrip,
} from "@/lib/invoice-view";
import type { InvoiceLineRow, InvoicePriceChangeRow, LineClass } from "@/lib/invoice-types";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useVenue, venueQuery, VenueAccent, VENUE_SHORT } from "@/components/venue";
import { VenueTag } from "@/components/brand";
import { Banner, Disclosure, Empty, ListSkeleton, useToast } from "@/components/ui";
import { TouchBack, TouchButton, TouchLink, TouchSheet } from "@/components/ordering/touch";
import { usePersonName } from "@/components/use-person-name";
import { ChargeLine, InvLine } from "./inv-line";
import { UndoChangeSheet, UndoDocumentSheet } from "./inv-undo";

/**
 * One invoice, for a person who just wants to know what happened: who it is from, one sentence about its prices, the PDF, and a line
 * by line list with one plain status each. The technical checks, landed cost and reasons sit under one collapsed Details section.
 */
export function InvoiceDetail({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const nameOf = usePersonName();
  const { venue: filterVenue } = useVenue();
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

  const listPath = `/invoices${venueQuery(filterVenue)}`;
  const back = (
    <TouchBack path="/invoices" fallback={listPath}>
      Invoices
    </TouchBack>
  );
  if (detail.loading && !d) return <ListSkeleton rows={6} />;
  if (detail.error && !d) return <Banner action={<TouchButton onClick={() => void detail.reload()}>Try Again</TouchButton>}>{detail.error}</Banner>;
  if (!d) return null;
  if (d.missing || !d.doc)
    return (
      <div>
        {back}
        <Empty title={d.missing ? "Invoices Are Not Set Up Yet" : "Invoice Not Found"} body={d.missing ? "Once they are, every scanned invoice appears here." : "It may have been removed, or the link is old."} action={<TouchLink href={listPath}>Back To Invoices</TouchLink>} />
      </div>
    );

  const doc = d.doc;
  const venue = store.venueById.get(doc.venue_id);
  const venueName = venue ? (VENUE_SHORT[venue.slug] ?? venue.name) : null;
  const checks = checkItems(doc);
  const totals = totalsStrip(doc);
  const title = docTitle(doc, d.supplierName);
  const applied = d.changes.filter((c) => c.status === "applied");
  const sentence = detailSentence(lineView.products);
  const needMatching = lineView.products.filter((l) => lineStatus(l).kind === "needs_matching").length;
  const waitingLines = lineView.products.filter((l) => lineStatus(l).kind === "waiting");
  const oddQuestions = d.questions.filter((q) => q.kind !== "unmatched_line" && q.kind !== "ambiguous_match");
  const matchHref = doc.supplier_id ? `/invoices/match/${doc.supplier_id}${venueQuery(filterVenue)}` : null;
  const when = dayLabel(doc.invoice_date) || dayLabel(doc.created_at);
  const changeItemName = (c: InvoicePriceChangeRow) => {
    const line = d.lines.find((l) => l.id === c.line_id);
    return (c.target === "ingredient" ? ingById.get(c.target_id)?.name : d.products.get(c.target_id)?.name) ?? line?.description ?? "This item";
  };
  const changeCurrent = (c: InvoicePriceChangeRow) => (c.target === "ingredient" ? (ingById.get(c.target_id)?.pack_price ?? null) : (d.products.get(c.target_id)?.price ?? null));
  const lineName = (l: InvoiceLineRow) => ingById.get(l.ingredient_id ?? "")?.name ?? d.products.get(l.product_id ?? "")?.name ?? l.description;

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
              <span>{when}</span>
              {venue ? (
                <>
                  <span aria-hidden>·</span>
                  <VenueTag slug={venue.slug} name={venueName ?? venue.name} size={16} />
                </>
              ) : null}
              {doc.total_inc != null ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-medium text-label tnum">{`${totals.totalInc} inc GST`}</span>
                </>
              ) : null}
            </p>
            <p className="mt-3 text-[17px] leading-snug">{sentence}</p>
          </header>

          {needMatching > 0 && matchHref ? (
            <Link href={matchHref} className="mt-2 flex min-h-[56px] items-center gap-3 rounded-2xl bg-warn-soft px-4 text-[17px] font-semibold text-warn sm:text-[15px]">
              <Target aria-hidden className="h-5 w-5 shrink-0" strokeWidth={2.5} />
              <span className="flex-1">{`Match ${needMatching} ${needMatching === 1 ? "Item" : "Items"}`}</span>
            </Link>
          ) : null}

          <div className="my-3 lg:hidden">
            {d.pdfUrl ? (
              <TouchLink href={d.pdfUrl} target="_blank" rel="noopener noreferrer" className="w-full">
                <FileText aria-hidden className="h-5 w-5" strokeWidth={2.25} />
                View Invoice PDF
              </TouchLink>
            ) : (
              <p className="text-[13px] text-label-2">The invoice PDF is not available yet.</p>
            )}
          </div>

          {oddQuestions.length > 0 ? (
            <section aria-labelledby="inv-questions" className="mt-4">
              <h2 id="inv-questions" className="px-1 pb-1.5 text-[13px] font-medium text-label-2">
                Check These
              </h2>
              <ul className="group-list">
                {oddQuestions.map((q) => (
                  <li key={q.id} className="flex items-start gap-3 px-4 py-3">
                    <Target aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warn" strokeWidth={2.5} />
                    <p className="min-w-0 text-[17px] leading-snug sm:text-[15px]">{q.prompt}</p>
                  </li>
                ))}
                <li>
                  <Link href={`/invoices/check${venueQuery(filterVenue)}`} className="flex min-h-[48px] items-center px-4 text-[17px] font-semibold text-accent sm:text-[15px]">
                    Check These
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="inv-lines" className="mt-6">
            <h2 id="inv-lines" className="px-1 pb-1.5 text-[13px] font-medium text-label-2">
              {`Items (${lineView.products.length})`}
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
                    matchHref={matchHref}
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

          <Disclosure title="Details" hint="Checks, totals, landed cost and the reasons">
            <div className="space-y-5 rounded-b-2xl bg-surface px-4 py-4">
              <section aria-label="Checks">
                <h3 className="pb-1.5 text-[13px] font-medium text-label-2">Checks</h3>
                <ul className="space-y-2">
                  {checks.map((c) => (
                    <li key={c.key} className="text-[15px]">
                      <span className={c.ok === false ? "font-medium text-danger" : "font-medium"}>{c.label}</span>
                      {c.detail ? <span className="block text-[13px] text-label-2">{c.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label="Totals">
                <h3 className="pb-1.5 text-[13px] font-medium text-label-2">Totals</h3>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Subtotal Ex GST", totals.subtotalEx],
                    ["GST", totals.gst],
                    ["Total Inc GST", totals.totalInc],
                    ["Delivery And Fees Spread", totals.feePool ?? "None"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
                      <dt className="text-[13px] text-label-2">{k}</dt>
                      <dd className="mt-0.5 text-[15px] font-semibold tnum">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {lineView.products.some((l) => landedText(l)) ? (
                <section aria-label="Landed cost">
                  <h3 className="pb-1 text-[13px] font-medium text-label-2">Landed Cost</h3>
                  <p className="pb-2 text-[13px] text-label-2">{LANDED_EXPLAIN}</p>
                  <ul className="space-y-2">
                    {lineView.products.filter((l) => landedText(l)).map((l) => (
                      <li key={l.id} className="text-[15px]">
                        <span className="font-medium">{l.description}</span>
                        <span className="block text-[13px] text-label-2">{[landedText(l), feeShareText(l, poolClasses)].filter(Boolean).join(". ")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {waitingLines.length > 0 ? (
                <section aria-label="Why some prices wait">
                  <h3 className="pb-1.5 text-[13px] font-medium text-label-2">Why Some Prices Wait</h3>
                  <ul className="space-y-2">
                    {waitingLines.map((l) => (
                      <li key={l.id} className="text-[15px]">
                        <span className="font-medium">{lineName(l)}</span>
                        <span className="block text-[13px] text-label-2">{decisionText(l)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {lineView.charges.length > 0 ? (
                <section aria-label="Charges and credits">
                  <h3 className="pb-1.5 text-[13px] font-medium text-label-2">Charges And Credits</h3>
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
            </div>
          </Disclosure>

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
        itemName={approving ? lineName(approving) : ""}
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
