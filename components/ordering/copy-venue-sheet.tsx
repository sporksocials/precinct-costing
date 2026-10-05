"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadVenueOrdering } from "@/lib/ordering-data";
import { copyVenueSetup } from "@/lib/ordering-screens-data";
import { copyImpactLines, copyIsEmpty, planVenueCopy, type CopyPlan } from "@/lib/ordering-setup";
import { orderingVenueName } from "@/lib/ordering";
import { VENUE_SHORT } from "@/components/venue";
import { Banner, useToast } from "@/components/ui";
import { TouchButton, TouchChips, TouchSheet } from "./touch";
import type { Venue } from "@/lib/types";

/**
 * Copy Products From Another Venue: for a new venue, starts its list from another venue's. Shows the impact first (what is
 * added, what is left behind), then copies categories, suppliers and active products. Counts, orders, prices, Build To levels
 * and account numbers are never copied: after the copy the two venues are independent.
 */
export function CopyVenueSheet({ target, open, onClose, onDone }: { target: Venue; open: boolean; onClose: () => void; onDone: () => void }) {
  const { venues } = useStore();
  const toast = useToast();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const others = useMemo(() => venues.filter((v) => v.id !== target.id).sort((a, b) => a.sort - b.sort), [venues, target.id]);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [targetData, setTargetData] = useState<{ categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[] } | null>(null);
  const [busy, setBusy] = useState<"loading" | "copying" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetName = VENUE_SHORT[target.slug] ?? orderingVenueName(target);
  const source = others.find((v) => v.id === sourceId) ?? null;
  const sourceName = source ? VENUE_SHORT[source.slug] ?? orderingVenueName(source) : "";

  useEffect(() => {
    if (!open) {
      setSourceId(null);
      setPlan(null);
      setError(null);
      setBusy(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || sourceId == null) return;
    let live = true;
    setBusy("loading");
    setError(null);
    setPlan(null);
    Promise.all([loadVenueOrdering(sb, sourceId, 1), loadVenueOrdering(sb, target.id, 1)])
      .then(([src, tgt]) => {
        if (!live) return;
        setPlan(planVenueCopy(src, tgt));
        setTargetData({ categories: tgt.categories, suppliers: tgt.suppliers });
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [open, sourceId, sb, target.id]);

  async function run() {
    if (!plan || !targetData) return;
    setBusy("copying");
    setError(null);
    try {
      const r = await copyVenueSetup(sb, target.id, plan, targetData);
      toast.show({ message: `Copied ${r.products} product${r.products === 1 ? "" : "s"} from ${sourceName} to ${targetName}` });
      onDone();
      onClose();
    } catch (e) {
      setError(`${e instanceof Error ? e.message : String(e)} Some rows may have been added already. Run the copy again to add what is missing.`);
      setBusy(null);
    }
  }

  return (
    <TouchSheet open={open} onClose={() => (busy === "copying" ? undefined : onClose())} title="Copy Products" size="md">
      <div className="pb-2">
        <p className="text-[15px] text-label-2">Start {targetName} from another venue’s list. {targetName} then keeps its own list.</p>
        <p className="mb-2 mt-4 text-[13px] font-medium text-label-2">Copy From</p>
        <TouchChips ariaLabel="Venue to copy from" wrap value={String(sourceId ?? "")} onChange={(v) => setSourceId(Number(v))} options={others.map((v) => ({ value: String(v.id), label: VENUE_SHORT[v.slug] ?? v.name }))} />
        {busy === "loading" ? <p className="mt-4 text-[15px] text-label-2">Reading {sourceName}...</p> : null}
        {error ? <Banner>{error}</Banner> : null}
        {plan && source ? (
          <div className="mt-4">
            {copyIsEmpty(plan) ? (
              <p className="rounded-xl bg-fill px-4 py-3 text-[15px]">
                {sourceName} has nothing to add to {targetName}. Either {sourceName} has no products yet, or {targetName} already has them all.
              </p>
            ) : (
              <ul className="space-y-2 rounded-xl bg-fill px-4 py-3 text-[15px]" aria-label="What this copy does">
                {copyImpactLines(plan, sourceName, targetName).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            <TouchButton variant="primary" className="mt-4 w-full" disabled={copyIsEmpty(plan) || busy != null} onClick={() => void run()}>
              {busy === "copying" ? "Copying..." : `Copy From ${sourceName}`}
            </TouchButton>
          </div>
        ) : null}
      </div>
    </TouchSheet>
  );
}
