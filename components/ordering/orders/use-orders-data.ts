"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OrderingError, T, loadCountLines, loadOrderLines, loadOrders, loadVenueOrdering, type OrderingVenueData } from "@/lib/ordering-data";
import type { OrderingCountLine, OrderingOrder, OrderingOrderLine } from "@/lib/ordering-types";
import { getSupabaseBrowser } from "@/lib/supabase/client";

const message = (e: unknown) => (e instanceof OrderingError || e instanceof Error ? e.message : "That could not be loaded.");

export interface VenueOrdersState {
  status: "loading" | "ready" | "error";
  error: string | null;
  data: OrderingVenueData | null;
  orders: OrderingOrder[];
}

/** One venue's ordering data and its orders (suppliers, categories, products, counts, orders). Reloads when the venue changes. */
export function useVenueOrders(venueId: number | null): VenueOrdersState & { reloadOrders: () => Promise<void> } {
  const [state, setState] = useState<VenueOrdersState>({ status: "loading", error: null, data: null, orders: [] });
  const current = useRef<number | null>(null);
  useEffect(() => {
    current.current = venueId;
    if (venueId == null) return;
    setState({ status: "loading", error: null, data: null, orders: [] });
    const sb = getSupabaseBrowser();
    Promise.all([loadVenueOrdering(sb, venueId), loadOrders(sb, venueId)])
      .then(([data, orders]) => {
        if (current.current === venueId) setState({ status: "ready", error: null, data, orders });
      })
      .catch((e) => {
        if (current.current === venueId) setState({ status: "error", error: message(e), data: null, orders: [] });
      });
  }, [venueId]);
  const reloadOrders = useCallback(async () => {
    if (venueId == null) return;
    try {
      const orders = await loadOrders(getSupabaseBrowser(), venueId);
      if (current.current === venueId) setState((s) => (s.status === "ready" ? { ...s, orders } : s));
    } catch {
      // the saved order is already confirmed on screen; a failed refresh only means the list is a little behind
    }
  }, [venueId]);
  return { ...state, reloadOrders };
}

/** The lines of one finished count (null while loading). */
export function useCountLines(sessionId: string | null): { lines: OrderingCountLine[] | null; error: string | null } {
  const [res, setRes] = useState<{ id: string | null; lines: OrderingCountLine[] | null; error: string | null }>({ id: null, lines: null, error: null });
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    loadCountLines(getSupabaseBrowser(), sessionId)
      .then((lines) => live && setRes({ id: sessionId, lines, error: null }))
      .catch((e) => live && setRes({ id: sessionId, lines: null, error: message(e) }));
    return () => {
      live = false;
    };
  }, [sessionId]);
  return res.id === sessionId ? { lines: res.lines, error: res.error } : { lines: null, error: null };
}

/** The lines of the sent orders on screen, by order id (each loaded once). */
export function useSentOrderLines(orders: readonly OrderingOrder[]): ReadonlyMap<string, OrderingOrderLine[]> {
  const [map, setMap] = useState<ReadonlyMap<string, OrderingOrderLine[]>>(new Map());
  const asked = useRef<Set<string>>(new Set());
  const ids = orders.filter((o) => o.status === "sent").map((o) => o.id).join(",");
  useEffect(() => {
    const need = ids.split(",").filter((id) => id && !asked.current.has(id));
    if (!need.length) return;
    need.forEach((id) => asked.current.add(id));
    const sb = getSupabaseBrowser();
    void Promise.all(need.map((id) => loadOrderLines(sb, id).then((lines) => [id, lines] as const, () => [id, [] as OrderingOrderLine[]] as const))).then((pairs) => {
      setMap((m) => new Map([...m, ...pairs]));
    });
  }, [ids]);
  return map;
}

/** One order and its lines for the detail page, read for this venue only (an order of another venue reads as not found). */
export async function fetchOrderDetail(venueId: number, orderId: string): Promise<{ order: OrderingOrder | null; lines: OrderingOrderLine[] }> {
  const sb = getSupabaseBrowser();
  const { data, error } = await sb.from(T.orders).select("*").eq("id", orderId).eq("venue_id", venueId);
  // an address that is not an order id at all (the database refuses it as a uuid) reads as not found
  if (error?.code === "22P02") return { order: null, lines: [] };
  if (error) throw new OrderingError(error.message || "That order could not be loaded.", error.code);
  const order = ((data ?? [])[0] as OrderingOrder | undefined) ?? null;
  if (!order) return { order: null, lines: [] };
  return { order, lines: await loadOrderLines(sb, order.id) };
}
