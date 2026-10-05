"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadVenueOrdering, OrderingError, type OrderingVenueData } from "@/lib/ordering-data";

/** The last load per venue, so going Back to a list shows it straight away while a fresh copy loads behind it. */
const cache = new Map<number, OrderingVenueData>();

export type VenueDataStatus = "loading" | "ready" | "error";

/**
 * One venue's suppliers, categories and products (never another venue's). Shows the last copy at once when there is one and
 * refreshes in the background. `apply` changes the copy on screen (and the shared copy) after a successful write, so the
 * screens never wait for a reload to show a save.
 */
export function useVenueData(venueId: number) {
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [data, setData] = useState<OrderingVenueData | null>(() => cache.get(venueId) ?? null);
  const [status, setStatus] = useState<VenueDataStatus>(() => (cache.has(venueId) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await loadVenueOrdering(sb, venueId, 3);
      if (!alive.current || mine !== seq.current) return;
      cache.set(venueId, d);
      setData(d);
      setStatus("ready");
      setError(null);
    } catch (e) {
      if (!alive.current || mine !== seq.current) return;
      setError(e instanceof OrderingError || e instanceof Error ? e.message : String(e));
      setStatus((s) => (cache.has(venueId) ? s : "error"));
    }
  }, [sb, venueId]);

  useEffect(() => {
    const cached = cache.get(venueId) ?? null;
    setData(cached);
    setStatus(cached ? "ready" : "loading");
    setError(null);
    void reload();
  }, [venueId, reload]);

  const apply = useCallback(
    (fn: (d: OrderingVenueData) => OrderingVenueData) => {
      setData((cur) => {
        if (!cur) return cur;
        const next = fn(cur);
        cache.set(venueId, next);
        return next;
      });
    },
    [venueId],
  );

  return { sb, data, status, error, reload, apply };
}

/** Replaces the row with the same id, or adds it at the end. */
export function upsertById<T extends { id: string }>(rows: readonly T[], row: T): T[] {
  return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];
}
