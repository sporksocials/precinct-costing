"use client";

import Link from "next/link";
import { useCallback, useId, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Globe, Mail, Plus, Smartphone } from "lucide-react";
import { Sheet, cx, useToast } from "@/components/ui";
import { money } from "@/lib/format";
import { orderingVenueName } from "@/lib/ordering";
import { OrderingError, createOrder, markOrderSent } from "@/lib/ordering-data";
import {
  METHOD_LABEL,
  SEND_METHOD_LABEL,
  addLine,
  buildSupplierSend,
  cardMode,
  countSummary,
  defaultSendMethod,
  draftLineFromProduct,
  draftsToOrderLines,
  freeTextLine,
  linesSignature,
  notNeededNote,
  plural,
  removeLine,
  sendActions,
  sentLine,
  sentSummary,
  setLineQty,
  unitsText,
  type DraftLine,
  type SendActionId,
} from "@/lib/ordering-orders-ui";
import type { OrderKind, OrderingOrder, OrderingOrderLine, OrderingProduct, OrderingSupplier, SuggestedLine } from "@/lib/ordering-types";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Venue } from "@/lib/types";
import { AddProduct } from "./add-product";
import { LineEditor } from "./line-editor";
import { Notice, StatusPill, btnPlain, btnPrimary, btnText, btnTinted, useWide } from "./parts";
import { SendPanel } from "./send-panel";

/** A sent order shown on its card. `lines` is null while they are still being loaded. */
export interface SentEntry {
  order: OrderingOrder;
  lines: Pick<OrderingOrderLine, "ordered_qty" | "price_inc_gst" | "unit_name">[] | null;
}

export interface OrderCardProps {
  venue: Venue;
  supplier: OrderingSupplier;
  /** every product of this venue (the Add Product search narrows it) */
  products: readonly OrderingProduct[];
  suppliers: readonly OrderingSupplier[];
  /** the suggestion for every counted or skipped product of this supplier, by product id (empty for a top-up) */
  suggestions: ReadonlyMap<string, SuggestedLine>;
  /** the lines the count suggests (empty for a top-up) */
  initialLines: DraftLine[];
  notNeeded: SuggestedLine[];
  uncounted: SuggestedLine[];
  kind: OrderKind;
  sessionId: string | null;
  /** a count card searches only its own supplier's products, a top-up the whole venue */
  scope: "supplier" | "venue";
  /** orders already marked as sent for this count and supplier, newest first */
  sent: SentEntry[];
  /** the signed-in person's first name (greets nobody, signs the text) */
  senderName: string | null;
  userEmail: string | null;
  /** "Troy" for an email in history (usePersonName) */
  nameOf: (email: string | null | undefined) => string | null;
  /** open to edit straight away (otherwise only when there is something to order) */
  startOpen?: boolean;
  /** called after an order was saved, so the page can reload its order list */
  onSaved: () => void;
  /** top-up only: start another one */
  onAnother?: () => void;
}

/** Supplier method, with an icon and words. */
export function MethodBadge({ method }: { method: OrderingSupplier["method"] }) {
  const Icon = method === "email" ? Mail : method === "website" ? Globe : Smartphone;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fill px-2.5 py-1 text-[13px] font-medium text-label-2">
      <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />
      {METHOD_LABEL[method]}
    </span>
  );
}

/** Supplier name sits above this: ONE quiet line, the email address (email suppliers) or the login website. Shared by the card and the order detail page. */
export function SupplierFacts({ supplier }: { supplier: Pick<OrderingSupplier, "method" | "email_to" | "login_url"> }) {
  const where = supplier.method === "email" ? supplier.email_to : supplier.login_url ? supplier.login_url.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  return where ? <p className="mt-1.5 min-w-0 break-all text-[14px] text-label-2">{where}</p> : null;
}

export function OrderCard(p: OrderCardProps) {
  const { venue, supplier, kind } = p;
  const toast = useToast();
  const [cardRef, wide] = useWide<HTMLElement>(820);
  const venueName = orderingVenueName(venue);
  const titleId = useId();

  const [lines, setLines] = useState<DraftLine[]>(p.initialLines);
  /** prices follow the supplier's own setting (Setup > Suppliers), never a per-order switch */
  const showPrices = supplier.show_prices_on_order;
  const [open, setOpen] = useState(p.startOpen ?? p.initialLines.length > 0);
  const [adding, setAdding] = useState(false);
  const [notNeededOpen, setNotNeededOpen] = useState(false);
  const [uncountedOpen, setUncountedOpen] = useState(true);
  const [lastAction, setLastAction] = useState<SendActionId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendAgain, setSendAgain] = useState(false);
  /** the draft order already written to the database by a Mark As Sent that then failed, so a retry never makes a second one */
  const [savedDraft, setSavedDraft] = useState<{ id: string; sig: string } | null>(null);
  const [localSent, setLocalSent] = useState<SentEntry[]>([]);

  const sentAll = useMemo(() => {
    const seen = new Set<string>();
    const at = (e: SentEntry) => Date.parse(e.order.sent_at ?? e.order.created_at ?? "") || 0;
    return [...localSent, ...p.sent]
      .filter((e) => (seen.has(e.order.id) ? false : (seen.add(e.order.id), true)))
      .sort((a, b) => at(b) - at(a));
  }, [localSent, p.sent]);
  const mode = cardMode(sentAll.map((e) => e.order), sendAgain);

  const send = useMemo(
    () => buildSupplierSend({ venueName, supplier, lines, showPrices, senderName: p.senderName }),
    [venueName, supplier, lines, showPrices, p.senderName],
  );
  const actions = useMemo(() => sendActions(supplier, send), [supplier, send]);
  const sig = linesSignature(lines);

  const setQty = useCallback((key: string, qty: number) => setLines((ls) => setLineQty(ls, key, qty)), []);
  const remove = useCallback((key: string) => setLines((ls) => removeLine(ls, key)), []);
  const addProduct = useCallback((product: OrderingProduct, suggested: SuggestedLine | null) => setLines((ls) => addLine(ls, draftLineFromProduct(product, suggested))), []);
  const addTyped = useCallback((name: string) => {
    const line = freeTextLine(name, 1);
    if (line) setLines((ls) => addLine(ls, line));
  }, []);

  const startSendAgain = () => {
    setLines(p.initialLines);
    setSavedDraft(null);
    setLastAction(null);
    setError(null);
    setSendAgain(true);
    setOpen(true);
  };

  const confirmSent = async () => {
    // decided for the person: the last way used on this card, else the supplier's own way
    const method = defaultSendMethod(lastAction, supplier.method);
    setSaving(true);
    setError(null);
    try {
      const sb = getSupabaseBrowser();
      let orderId = savedDraft && savedDraft.sig === sig ? savedDraft.id : null;
      if (!orderId) {
        const made = await createOrder(sb, venue.id, { supplierId: supplier.id, sessionId: p.sessionId, kind, showPrices, lines: draftsToOrderLines(lines) });
        orderId = made.order.id;
        setSavedDraft({ id: orderId, sig });
      }
      const order = await markOrderSent(sb, orderId, { by: p.userEmail, method, subject: send.subject, bodyText: send.body, warningText: send.warning, showPrices });
      const saved = draftsToOrderLines(lines).map((l) => ({ ordered_qty: l.ordered_qty, price_inc_gst: l.price_inc_gst, unit_name: l.unit_name }));
      setLocalSent((s) => [{ order, lines: saved }, ...s]);
      setConfirming(false);
      setSendAgain(false);
      setSavedDraft(null);
      toast.show({ message: `Order to ${supplier.name} marked as sent.` });
      p.onSaved();
    } catch (e) {
      setError(e instanceof OrderingError || e instanceof Error ? e.message : "That did not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const hasLines = send.lineCount > 0;
  const latest = sentAll[0] ?? null;
  const earlier = sentAll.slice(1);
  const summary = latest?.lines ? sentSummary(latest.lines) : null;
  const hasPrice = send.totals.pricedLines > 0;

  return (
    <section ref={cardRef} aria-labelledby={titleId} className="overflow-hidden rounded-2xl bg-surface">
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="text-[20px] font-semibold leading-tight text-label">
              {kind === "top_up" ? `Top-Up: ${supplier.name}` : supplier.name}
            </h3>
            <MethodBadge method={supplier.method} />
            {mode === "sent" ? <StatusPill sent /> : null}
          </div>
          <SupplierFacts supplier={supplier} />
        </div>
        {mode === "edit" && !open ? (
          <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={cx(btnText, "shrink-0")}>
            {hasLines ? `Open (${plural(send.lineCount, "line")})` : "Open"}
            <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          </button>
        ) : null}
      </div>

      {mode === "sent" && latest ? (
        <div className="px-4 pb-4 pt-2">
          <p className="flex flex-wrap items-center gap-x-2 text-[16px] font-medium text-label">
            <Check aria-hidden className="h-[18px] w-[18px] text-good" strokeWidth={3} />
            <span>{sentLine(latest.order, p.nameOf)}</span>
            {latest.order.method ? <span className="text-[14px] font-normal text-label-2">via {SEND_METHOD_LABEL[latest.order.method]}</span> : null}
          </p>
          <p className="mt-1 text-[14px] text-label-2 tnum">
            {summary ? (
              <>
                {plural(summary.products, "product")}, {unitsText(latest.lines ?? [])}
                {summary.totals.pricedLines > 0 ? ` · ${money(summary.totals.inc)} inc GST (${money(summary.totals.ex)} ex GST)` : ""}
              </>
            ) : (
              "Loading the order lines"
            )}
          </p>
          {latest.order.warning_text ? <p className="mt-1 text-[13px] text-label-2">{latest.order.warning_text}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/ordering/${venue.slug}/orders/${latest.order.id}`} className={btnPlain}>
              View Order
            </Link>
            {kind === "top_up" ? (
              p.onAnother ? (
                <button type="button" onClick={p.onAnother} className={btnPlain}>
                  Start Another Top-Up
                </button>
              ) : null
            ) : (
              <button type="button" onClick={startSendAgain} className={btnPlain}>
                Send Again
              </button>
            )}
          </div>
          {kind !== "top_up" ? <p className="mt-2 text-[13px] text-label-2">Send Again makes a new order from this count. The one above stays saved as it was.</p> : null}
          {earlier.length ? (
            <ul className="mt-2 text-[13px] text-label-2">
              {earlier.map((e) => (
                <li key={e.order.id} className="flex flex-wrap items-center gap-x-3">
                  <span>Earlier: {sentLine(e.order, p.nameOf)}</span>
                  <Link href={`/ordering/${venue.slug}/orders/${e.order.id}`} className={btnText}>
                    View Order
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {mode === "edit" && !open ? (
        <p className="px-4 pb-4 pt-2 text-[14px] text-label-2">
          {hasLines ? `${plural(send.lineCount, "product")} to order.` : kind === "top_up" ? "" : "Nothing to order from this count."}
          {p.uncounted.length ? ` ${plural(p.uncounted.length, "product")} not counted.` : ""}
          {sendAgain ? " A new order will be saved separately from the one already sent." : ""}
        </p>
      ) : null}

      {mode === "edit" && open ? (
        <div className="mt-3">
          {sendAgain ? (
            <div className="px-4 pb-3">
              <Notice tone="neutral">This is a new order. The one already sent stays saved as it was.</Notice>
            </div>
          ) : null}
          {supplier.notes && !send.warning ? <p className="px-4 pb-2 text-[14px] text-label-2">Supplier note: {supplier.notes}</p> : null}
          <div className="border-t border-[color:var(--separator)]">
            <LineEditor lines={lines} showPrices={showPrices} wide={wide} onQty={setQty} onRemove={remove} />
          </div>

          <div className="border-t border-[color:var(--separator)] px-4 py-3">
            <button type="button" aria-expanded={adding} onClick={() => setAdding((a) => !a)} className={btnTinted}>
              <Plus aria-hidden className="h-4 w-4" strokeWidth={3} />
              Add Product
            </button>
          </div>
          {adding ? (
            <AddProduct products={p.products} supplierId={supplier.id} scope={p.scope} onOrder={lines} suggestions={p.suggestions} suppliers={p.suppliers} onAddProduct={addProduct} onAddTyped={addTyped} onClose={() => setAdding(false)} />
          ) : null}

          {p.uncounted.length ? (
            <div className="border-t border-[color:var(--separator)]">
              <button type="button" aria-expanded={uncountedOpen} onClick={() => setUncountedOpen((o) => !o)} className="flex min-h-[48px] w-full items-center gap-2 bg-warn-soft px-4 py-2 text-left">
                <AlertTriangle aria-hidden className="h-[18px] w-[18px] shrink-0 text-warn" strokeWidth={2.5} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-label">Not Counted ({p.uncounted.length})</span>
                  <span className="block text-[13px] text-label-2">Skipped in the count, so nothing is suggested. Check the shelf before you send.</span>
                </span>
                <ChevronRight aria-hidden className={cx("h-4 w-4 shrink-0 text-label-2 transition-transform motion-reduce:transition-none", uncountedOpen && "rotate-90")} strokeWidth={2.5} />
              </button>
              {uncountedOpen ? <ReviewList items={p.uncounted} onOrder={lines} onAdd={(s) => addProduct(s.product, s)} note={() => "Not counted"} /> : null}
            </div>
          ) : null}

          {p.notNeeded.length ? (
            <div className="border-t border-[color:var(--separator)]">
              <button type="button" aria-expanded={notNeededOpen} onClick={() => setNotNeededOpen((o) => !o)} className="flex min-h-[48px] w-full items-center gap-2 px-4 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-label">Not Needed ({p.notNeeded.length})</span>
                  <span className="block text-[13px] text-label-2">Counted at or over Build To, so nothing is suggested.</span>
                </span>
                <ChevronRight aria-hidden className={cx("h-4 w-4 shrink-0 text-label-2 transition-transform motion-reduce:transition-none", notNeededOpen && "rotate-90")} strokeWidth={2.5} />
              </button>
              {notNeededOpen ? <ReviewList items={p.notNeeded} onOrder={lines} onAdd={(s) => addProduct(s.product, s)} note={notNeededNote} /> : null}
            </div>
          ) : null}

          <div className="border-t border-[color:var(--separator)] px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="text-[15px] text-label-2 tnum">
                {hasLines ? `${plural(send.lineCount, "product")}, ${unitsText(send.textLines)}` : "No quantities yet"}
              </p>
              {hasPrice ? (
                <p className="text-right tnum">
                  <span className="block text-[17px] font-semibold text-label">{money(send.totals.inc)} <span className="text-[13px] font-normal text-label-2">inc GST</span></span>
                  <span className="block text-[14px] text-label-2">{money(send.totals.ex)} ex GST</span>
                </p>
              ) : (
                <p className="text-[13px] text-label-2">No prices saved for these products.</p>
              )}
            </div>
            {send.totals.unpricedLines > 0 && hasPrice ? (
              <p className="mt-1 text-[13px] text-label-2">{plural(send.totals.unpricedLines, "line")} with no price {send.totals.unpricedLines === 1 ? "is" : "are"} not in the total.</p>
            ) : null}
            {send.warning ? (
              <Notice tone="warn" className="mt-3" role="status">
                <p className="font-medium">{send.warning}.</p>
                <p className="mt-0.5 text-[14px] text-label-2">This is a warning only. You can still send the order.</p>
                {supplier.notes ? <p className="mt-0.5 text-[14px] text-label-2">Supplier note: {supplier.notes}</p> : null}
              </Notice>
            ) : null}
          </div>

          <SendPanel supplier={supplier} send={send} actions={actions} onUsed={setLastAction} onMarkSent={() => { setError(null); setConfirming(true); }} markDisabled={!hasLines} />
        </div>
      ) : null}

      <Sheet open={confirming} onClose={() => (saving ? undefined : setConfirming(false))} hideHeader size="sm" labelledBy={`${titleId}-confirm`}>
        <h2 id={`${titleId}-confirm`} className="pt-4 text-[20px] font-semibold text-label">
          Mark This Order As Sent?
        </h2>
        <p className="mt-1 text-[15px] text-label-2">
          {send.subject} to {supplier.name}: {plural(send.lineCount, "product")}, {unitsText(send.textLines)}.
        </p>
        <p className="mt-2 text-[15px] text-label-2">Only mark it once it has gone. Opening an email draft does not send it. The order is saved with who sent it and when.</p>
        {error ? (
          <Notice tone="danger" className="mt-3" role="alert">
            <p className="font-medium">Not saved.</p>
            <p className="text-[14px]">{error}</p>
          </Notice>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void confirmSent()} disabled={saving} className={btnPrimary}>
            {saving ? "Saving" : error ? "Try Again" : "Mark As Sent"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={saving} className={btnPlain}>
            Not Yet
          </button>
        </div>
      </Sheet>
    </section>
  );
}

function ReviewList({ items, onOrder, onAdd, note }: { items: SuggestedLine[]; onOrder: readonly DraftLine[]; onAdd: (s: SuggestedLine) => void; note: (s: SuggestedLine) => string }) {
  const on = new Set(onOrder.map((l) => l.key));
  return (
    <ul className="pb-1">
      {items.map((s) => (
        <li key={s.product.id} className="flex items-center gap-3 border-t border-[color:var(--separator)] px-4 py-1.5 first:border-t-0">
          <div className="min-w-0 flex-1 py-1">
            <p className="truncate text-[15px] text-label">{s.product.name}</p>
            <p className="truncate text-[13px] text-label-2 tnum">
              {s.product.unit_name} · {countSummary(s)} · {note(s)}
            </p>
          </div>
          {on.has(s.product.id) ? (
            <span className="inline-flex min-h-[44px] items-center gap-1 px-2 text-[14px] font-medium text-label-2">
              <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
              On Order
            </span>
          ) : (
            <button type="button" onClick={() => onAdd(s)} aria-label={`Add ${s.product.name} to the order`} className={btnText}>
              <Plus aria-hidden className="h-4 w-4" strokeWidth={3} />
              Add To Order
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
