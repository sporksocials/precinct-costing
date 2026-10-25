"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadApprovePrices, type ApproveLoad } from "@/lib/invoice-todo-approve";
import { loadCheckTasks, type CheckLoad } from "@/lib/invoice-todo-checks";

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** the first load is in flight (a reload keeps showing the last copy) */
  loading: boolean;
  reload: () => Promise<void>;
}

/** The venue slug as an id. `undefined` while the store has not loaded the venues (nothing is read yet). */
function useVenueId(slug: string | null): number | null | undefined {
  const { venues } = useStore();
  if (slug === null) return null;
  return venues.find((v) => v.slug === slug)?.id;
}

/** Reads once, again when asked, and again when the tab comes back into view (so two people approving do not see stale rows). */
function useReader<T>(load: (() => Promise<T>) | null, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const ready = load !== null;
  const run = useCallback(async () => {
    const fn = loadRef.current;
    if (!fn) return;
    const mine = ++seq.current;
    try {
      const d = await fn();
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load invoices.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    void run();
    const onShow = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      seq.current++;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [run, key, ready]);
  return { data, error, loading, reload: run };
}

export function useApprovePrices(venueSlug: string | null): Loaded<ApproveLoad> {
  const venueId = useVenueId(venueSlug);
  return useReader<ApproveLoad>(venueId === undefined ? null : () => loadApprovePrices(getSupabaseBrowser(), venueId), `approve:${venueId}`);
}

export function useCheckTasks(venueSlug: string | null): Loaded<CheckLoad> {
  const venueId = useVenueId(venueSlug);
  return useReader<CheckLoad>(venueId === undefined ? null : () => loadCheckTasks(getSupabaseBrowser(), venueId), `check:${venueId}`);
}
