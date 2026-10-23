"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadProductsByIds, loadQuestionBundles } from "@/lib/invoice-data-extra";
import type { ProductLite, QuestionBundle } from "@/lib/invoice-questions-view";

export const ANSWERED_CAP = 100;

/**
 * The open and answered questions for the screen (one venue or all, optionally one invoice). The last copy stays on screen
 * while a fresh one loads, and it reloads when the tab comes back into view so two people answering do not see stale cards.
 */
export function useQuestions(venueId: number | null, docId: string | null) {
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [open, setOpen] = useState<QuestionBundle[] | null>(null);
  const [answered, setAnswered] = useState<QuestionBundle[] | null>(null);
  const [products, setProducts] = useState<Map<string, ProductLite>>(new Map());
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [o, a] = await Promise.all([
        loadQuestionBundles(sb, { status: "open", venueId, docId }),
        loadQuestionBundles(sb, { status: "answered", venueId, docId, limit: ANSWERED_CAP }),
      ]);
      if (mine !== seq.current) return;
      setOpen(o.bundles);
      setAnswered(a.bundles);
      setAvailable(o.available);
      setError(null);
      const ids = [...new Set(o.bundles.flatMap((b) => b.q.options.map((x) => x.product_id)).filter((x): x is string => !!x))];
      if (ids.length) {
        const rows = await loadProductsByIds(sb, ids);
        if (mine === seq.current) setProducts(new Map(rows.map((p) => [p.id, p])));
      }
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setOpen((x) => x ?? []);
      setAnswered((x) => x ?? []);
    }
  }, [sb, venueId, docId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);

  return { sb, open, answered, products, available, error, reload: load };
}
