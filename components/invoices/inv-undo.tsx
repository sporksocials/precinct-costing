"use client";

import { useEffect, useState } from "react";
import { TouchButton, TouchSheet } from "@/components/ordering/touch";
import { useToast } from "@/components/ui";
import { undoChange, undoDocument } from "@/lib/invoice-apply";
import { FORCE_NOTE, undoBody, undoTitle } from "@/lib/invoice-view";
import type { InvoicePriceChangeRow } from "@/lib/invoice-types";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";

/**
 * Undo one price the invoice system wrote. Shows what is there now before anything happens ("Put $68.90 back?"). If the price was
 * changed by someone else since, the plain warning appears with a second button, "Set It Back Anyway" (undoChange refuses without
 * `force`). The sheet never changes a price itself: undoChange keeps the ledger and the price history.
 */
export function UndoChangeSheet({
  change,
  itemName,
  currentPrice,
  onClose,
  onDone,
}: {
  change: InvoicePriceChangeRow | null;
  itemName: string;
  /** the price the app holds now, when known */
  currentPrice: number | null;
  onClose: () => void;
  /** called after a successful undo, so the caller reloads */
  onDone: () => void;
}) {
  const { userEmail, reload } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(currentPrice);
  useEffect(() => {
    setBusy(false);
    setForce(null);
    setError(null);
    setNow(currentPrice);
  }, [change?.id, currentPrice]);
  if (!change) return null;

  const go = async (forced: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await undoChange(getSupabaseBrowser(), { changeId: change.id, actor: userEmail ?? "unknown", force: forced });
      if (r.needsForce) {
        setForce(r.message || FORCE_NOTE);
        if (r.currentPrice != null) setNow(r.currentPrice);
        return;
      }
      if (!r.ok) {
        setError(r.message || "That could not be put back.");
        return;
      }
      toast.show({ message: r.message || "Put back." });
      void reload();
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be put back.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchSheet open onClose={onClose} title="Undo" size="sm">
      <div className="space-y-4 pb-2">
        <h3 className="text-[20px] font-semibold leading-tight">{undoTitle(change.kind === "price_confirmed" ? null : change.old_price)}</h3>
        <p className="text-[15px] text-label-2">{undoBody(change, itemName, now)}</p>
        {force ? (
          <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2.5 text-[15px] text-warn">
            {force}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-[15px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          {force ? (
            <TouchButton variant="primary" disabled={busy} onClick={() => void go(true)} className="sm:flex-1">
              {busy ? "Setting Back..." : "Set It Back Anyway"}
            </TouchButton>
          ) : (
            <TouchButton variant="primary" disabled={busy} onClick={() => void go(false)} className="sm:flex-1">
              {busy ? "Putting Back..." : change.kind === "price_confirmed" ? "Undo" : "Put It Back"}
            </TouchButton>
          )}
          <TouchButton onClick={onClose} className="sm:flex-1">
            Keep It
          </TouchButton>
        </div>
      </div>
    </TouchSheet>
  );
}

/**
 * Undo Whole Invoice: puts back every price this invoice set, newest first (undoDocument). If any price was changed by someone else
 * since, nothing of theirs is overwritten until a person says so with "Set Them Back Anyway".
 */
export function UndoDocumentSheet({ documentId, open, count, onClose, onDone }: { documentId: string; open: boolean; count: number; onClose: () => void; onDone: () => void }) {
  const { userEmail, reload } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setBusy(false);
      setForce(false);
      setError(null);
    }
  }, [open]);

  const go = async (forced: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const results = await undoDocument(getSupabaseBrowser(), { documentId, actor: userEmail ?? "unknown", force: forced });
      if (results.some((r) => r.needsForce)) {
        setForce(true);
        return;
      }
      const bad = results.filter((r) => !r.ok);
      if (bad.length) {
        setError(bad[0].message || "Some prices could not be put back.");
        return;
      }
      toast.show({ message: "Every price from this invoice is back as it was." });
      void reload();
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be put back.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchSheet open={open} onClose={onClose} title="Undo Invoice" size="sm">
      <div className="space-y-4 pb-2">
        <h3 className="text-[20px] font-semibold leading-tight">Undo The Whole Invoice?</h3>
        <p className="text-[15px] text-label-2">{`This puts ${count === 1 ? "the 1 price" : `all ${count} prices`} this invoice set back to what ${count === 1 ? "it was" : "they were"} before.`}</p>
        {force ? (
          <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2.5 text-[15px] text-warn">
            {FORCE_NOTE}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-[15px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <TouchButton variant="primary" disabled={busy} onClick={() => void go(force)} className="sm:flex-1">
            {busy ? "Putting Back..." : force ? "Set Them Back Anyway" : "Put Them All Back"}
          </TouchButton>
          <TouchButton onClick={onClose} className="sm:flex-1">
            Keep Them
          </TouchButton>
        </div>
      </div>
    </TouchSheet>
  );
}
