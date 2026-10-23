"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { dateShort } from "@/lib/format";
import { undoChange } from "@/lib/invoice-apply";
import { loadLedgerForIngredient } from "@/lib/invoice-data-extra";
import { FORCE_BODY, isInvoiceSource, isUndoSource, ledgerByLogId, logIdFromKey, undoModel, undoSourceText, type LedgerLite } from "@/lib/invoice-ingredient-view";
import type { TimelineEntry } from "@/lib/ingredient-history";
import type { PriceLog } from "@/lib/types";
import { useToast } from "@/components/ui";
import { TouchButton, TouchSheet } from "@/components/ordering/touch";

/**
 * Price History rows written by the invoice system. Their source reads "Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026";
 * here it becomes a link to that invoice, with an Undo button while the change is still in force and the word "Undone" after.
 * Rows that record an undo read plainly ("Undone: Invoice 51329 ..."). Everything else about the history is unchanged, and when
 * the Invoices tables are not there the ledger is empty, so rows just show their source text.
 */
export function useInvoiceHistory({
  ingredientId,
  logs,
  version,
  nameOf,
}: {
  ingredientId: string;
  logs: PriceLog[] | null;
  /** changes whenever the ingredient is saved */
  version: string;
  nameOf: (email: string | null | undefined) => string | null;
}) {
  const store = useStore();
  const toast = useToast();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [ledger, setLedger] = useState<Map<number, LedgerLite>>(new Map());
  const [bump, setBump] = useState(0);
  const [asking, setAsking] = useState<LedgerLite | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [force, setForce] = useState<string | null>(null);

  const logById = useMemo(() => new Map((logs ?? []).map((l) => [l.id, l])), [logs]);
  const hasInvoiceRows = useMemo(() => (logs ?? []).some((l) => isInvoiceSource(l.source) || isUndoSource(l.source)), [logs]);

  useEffect(() => {
    if (!hasInvoiceRows) {
      setLedger(new Map());
      return;
    }
    let live = true;
    void loadLedgerForIngredient(sb, ingredientId).then((rows) => live && setLedger(ledgerByLogId(rows)));
    return () => {
      live = false;
    };
  }, [sb, ingredientId, version, hasInvoiceRows, bump, logs]);

  function close() {
    setAsking(null);
    setProblem(null);
    setForce(null);
  }

  async function run(forced: boolean) {
    if (!asking) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await undoChange(sb, { changeId: asking.id, actor: store.userEmail ?? "unknown", force: forced });
      if (res.ok) {
        toast.show({ message: res.message || "Undone." });
        close();
        setBump((n) => n + 1);
        void store.reload();
      } else if (res.needsForce && !forced) {
        setForce(res.message || FORCE_BODY);
      } else {
        setProblem(res.message || "That could not be undone.");
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That could not be undone.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The sub line for one history entry. `wrap` is true when the line holds a link and a button and needs room;
   * otherwise `node` is just the ordinary text line.
   */
  function row(e: TimelineEntry, plain: string): { node: React.ReactNode; wrap: boolean } {
    const id = logIdFromKey(e.key);
    const source = id == null ? null : logById.get(id)?.source ?? null;
    if (isUndoSource(source)) {
      return { node: [e.title, dateShort(e.at), undoSourceText(source!), nameOf(e.by)].filter(Boolean).join(" · "), wrap: true };
    }
    if (!id || !isInvoiceSource(source)) return { node: plain, wrap: false };
    const change = ledger.get(id);
    const meta = [e.title, dateShort(e.at), nameOf(e.by)].filter(Boolean).join(" · ");
    return {
      wrap: true,
      node: (
        <>
          <span className="block">{meta}</span>
          <span className="flex flex-wrap items-center gap-x-3">
            {change ? (
              <Link href={`/invoices/${change.document_id}`} className="inline-flex min-h-[44px] items-center font-medium text-accent underline-offset-2 hover:underline">
                {source}
              </Link>
            ) : (
              <span className="inline-flex min-h-[44px] items-center">{source}</span>
            )}
            {change?.status === "applied" ? (
              <button
                type="button"
                onClick={() => setAsking(change)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl bg-fill px-4 text-[15px] font-semibold text-label transition active:opacity-70"
              >
                <Undo2 className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                Undo
              </button>
            ) : change?.status === "reverted" ? (
              <span className="inline-flex min-h-[44px] items-center gap-1.5 text-label-2">
                <Undo2 className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                Undone
              </span>
            ) : null}
          </span>
        </>
      ),
    };
  }

  const model = asking ? undoModel(asking) : null;
  const sheet = (
    <TouchSheet open={!!asking} onClose={busy ? () => undefined : close} title={model?.title ?? "Undo"} size="sm">
      <p className="px-1 pb-3 text-[17px] leading-snug">{model?.body}</p>
      {force ? (
        <p role="alert" className="mb-3 rounded-xl bg-warn-soft px-3 py-2.5 text-[15px] text-warn">
          {force}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[15px] text-danger">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 pb-2">
        {force ? (
          <TouchButton variant="danger" className="w-full" disabled={busy} onClick={() => void run(true)}>
            {busy ? "Putting It Back..." : "Put It Back Anyway"}
          </TouchButton>
        ) : (
          <TouchButton variant="primary" className="w-full" disabled={busy} onClick={() => void run(false)}>
            {busy ? "Working..." : model?.confirm ?? "Undo"}
          </TouchButton>
        )}
        <TouchButton variant="plain" className="w-full" disabled={busy} onClick={close}>
          Keep It As It Is
        </TouchButton>
      </div>
    </TouchSheet>
  );

  return { row, sheet };
}
