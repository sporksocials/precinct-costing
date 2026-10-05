"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { newId } from "@/lib/store";
import {
  countLinesWithQueue,
  dropSyncedEdits,
  cancelCountSession,
  finaliseCountSession,
  loadCountLines,
  loadVenueOrdering,
  readCountQueue,
  startCountSession,
  syncCountEdits,
  updateProduct,
  writeCountQueue,
} from "@/lib/ordering-data";
import { cacheUsable, coalesceEdit, finaliseBlock, openOrLast, queueSessions, retryDelayMs, syncStatus, type CountCache, type RowQty, type SyncStatus } from "@/lib/ordering-count-ui";
import { clearCountCache, createQueueStorage, isOnline, nowIso, readCountCache, writeCountCache, type DeviceQueueStorage } from "@/lib/ordering-count-device";
import type { CountEdit, OrderingCategory, OrderingCountLine, OrderingCountSession, OrderingProduct } from "@/lib/ordering-types";

export type CountPhase = "loading" | "ready" | "unavailable" | "offline-empty";

interface VenueView {
  categories: OrderingCategory[];
  products: OrderingProduct[];
  sessions: OrderingCountSession[];
}

export interface CountController {
  phase: CountPhase;
  /** plain-English reason when phase is "unavailable" (Ordering not set up, a failed first load) */
  problem: string | null;
  /** what is on screen came from the copy saved on this device and has not been checked against the database yet */
  fromCache: boolean;
  categories: OrderingCategory[];
  products: OrderingProduct[];
  openSession: OrderingCountSession | null;
  lastSession: OrderingCountSession | null;
  /** the count being counted or viewed (null on the start screen) */
  session: OrderingCountSession | null;
  /** product id to the places counted, with the device's waiting taps applied */
  qty: ReadonlyMap<string, RowQty>;
  /** how many products the open count has lines for (for the start screen), taps included */
  pending: number;
  online: boolean;
  status: SyncStatus;
  /** the device refused to keep the queue (storage blocked or full): taps are only safe while this page stays open */
  memoryOnly: boolean;
  /** Start Count, or Resume Count when one is open. Resolves with a message when it could not. */
  enter: (which: "open" | "last") => Promise<string | null>;
  leave: () => void;
  setQty: (product: OrderingProduct, place: "store" | "second", value: number | null) => void;
  finalise: () => Promise<{ ok: boolean; message: string | null }>;
  /** cancel the count in progress (set aside, never deleted). Needs a connection. Resolves with a message when it could not. */
  cancel: () => Promise<string | null>;
  /** change a product's Build To (needs a connection; the screen shows it at once and puts it back if the save fails). Resolves with a message when it could not. */
  setPar: (product: OrderingProduct, par: number) => Promise<string | null>;
  /** try a sync now (Retry) */
  syncNow: () => void;
  reload: () => void;
}

const REFRESH_EVERY_MS = 60_000;

/**
 * The count screen's brain: loads one venue (database online, the device copy offline), keeps every tap on the device first,
 * and syncs in the background. See lib/ordering-count-ui.ts and lib/ordering-count-device.ts for the pieces.
 *
 * Order of events for a tap: (1) the queue is written to the device, synchronously; (2) the screen updates; (3) a sync is
 * scheduled (700 ms later, so a burst of taps goes out together). The screen never waits on the network.
 */
export function useCountSession(venueId: number | null, email: string | null): CountController {
  const [view, setView] = useState<VenueView | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [lines, setLines] = useState<{ sessionId: string | null; rows: OrderingCountLine[] }>({ sessionId: null, rows: [] });
  const [queue, setQueue] = useState<CountEdit[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<CountPhase>("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [memoryOnly, setMemoryOnly] = useState(false);

  const sbRef = useRef<SupabaseClient | null>(null);
  const storageRef = useRef<DeviceQueueStorage | null>(null);
  const viewRef = useRef<VenueView | null>(null);
  const viewIdRef = useRef<string | null>(null);
  const linesRef = useRef(lines);
  const inFlight = useRef<Set<string>>(new Set());
  const syncingRef = useRef(false);
  const againRef = useRef(false);
  const attempt = useRef(0);
  const syncTimer = useRef<number>();
  const lastRefresh = useRef(0);
  /** counts finished syncs: a read of the lines that started before one finished is older than what the screen holds, so it is not applied */
  const syncGen = useRef(0);
  const ids = useRef({ venueId, email });
  ids.current = { venueId, email };
  viewRef.current = view;
  viewIdRef.current = viewId;
  linesRef.current = lines;

  const sb = () => (sbRef.current ??= getSupabaseBrowser());
  const storage = () => (storageRef.current ??= createQueueStorage());

  const readQueue = useCallback(() => {
    const v = ids.current.venueId;
    const q = v == null ? [] : readCountQueue(storage(), v);
    setQueue(q);
    return q;
  }, []);

  /** Saves what is on screen to this device's IndexedDB so the screen opens with no signal. */
  const persist = useCallback(() => {
    const { venueId: v, email: e } = ids.current;
    const data = viewRef.current;
    if (v == null || !e || !data) return;
    const sessionId = viewIdRef.current ?? openOrLast(data.sessions).open?.id ?? null;
    const cache: CountCache = {
      v: 1,
      email: e,
      venueId: v,
      savedAt: nowIso(),
      categories: data.categories,
      products: data.products,
      sessions: data.sessions,
      sessionId,
      lines: linesRef.current.sessionId === sessionId ? linesRef.current.rows : [],
    };
    void writeCountCache(cache);
  }, []);

  /* ---- sync ---- */

  const sync = useCallback(async (): Promise<void> => {
    const { venueId: v } = ids.current;
    if (v == null) return;
    if (syncingRef.current) {
      againRef.current = true;
      return;
    }
    if (!isOnline()) return;
    const waiting = readCountQueue(storage(), v);
    if (!waiting.length) return;
    syncingRef.current = true;
    setSyncing(true);
    let ok = true;
    try {
      for (const sessionId of queueSessions(waiting)) {
        const sent = waiting.filter((e) => e.session_id === sessionId);
        sent.forEach((e) => inFlight.current.add(e.client_uuid));
        try {
          const res = await syncCountEdits(sb(), sessionId, sent);
          // takes the sent edits off the device queue, keeping any tapped while the sync ran
          dropSyncedEdits(storage(), v, sent);
          syncGen.current += 1;
          if (sessionId === (viewIdRef.current ?? openOrLast(viewRef.current?.sessions ?? []).open?.id)) {
            setLines({ sessionId, rows: res.lines });
            linesRef.current = { sessionId, rows: res.lines };
          }
        } finally {
          sent.forEach((e) => inFlight.current.delete(e.client_uuid));
        }
      }
      attempt.current = 0;
      setFailed(false);
    } catch {
      ok = false;
      setFailed(true);
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void sync(), retryDelayMs(attempt.current++));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      const left = readQueue();
      if (ok) persist();
      if (ok && (againRef.current || left.length)) {
        againRef.current = false;
        window.clearTimeout(syncTimer.current);
        syncTimer.current = window.setTimeout(() => void sync(), 300);
      }
    }
  }, [persist, readQueue]);

  const scheduleSync = useCallback(
    (ms: number) => {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void sync(), ms);
    },
    [sync],
  );

  /* ---- loading ---- */

  const apply = useCallback((data: VenueView, sessionId: string | null, rows: OrderingCountLine[]) => {
    setView(data);
    viewRef.current = data;
    setLines({ sessionId, rows });
    linesRef.current = { sessionId, rows };
  }, []);

  /** Reads the venue from the database. Keeps the device copy on screen when it cannot (offline, or a failed read). */
  const refresh = useCallback(async (): Promise<boolean> => {
    const { venueId: v } = ids.current;
    if (v == null || !isOnline()) return false;
    try {
      const gen = syncGen.current;
      const d = await loadVenueOrdering(sb(), v, 12);
      // a count started on this screen while this read was out may not be in what the database returned yet: keep it
      const local = viewIdRef.current ? viewRef.current?.sessions.find((s) => s.id === viewIdRef.current && s.status === "in_progress" && Date.now() - Date.parse(s.started_at) < 120_000) : undefined;
      const sessions = local && !d.sessions.some((s) => s.id === local.id) ? [local, ...d.sessions] : d.sessions;
      const data: VenueView = { categories: d.categories, products: d.products, sessions };
      const keep = viewIdRef.current && sessions.some((s) => s.id === viewIdRef.current) ? viewIdRef.current : null;
      const want = keep ?? d.openSession?.id ?? null;
      let rows: OrderingCountLine[] = linesRef.current.sessionId === want ? linesRef.current.rows : [];
      if (want) {
        const fresh = await loadCountLines(sb(), want);
        // a sync finished (or is running) while this read was out: the screen already holds newer lines, keep them
        if (syncGen.current === gen && !syncingRef.current) rows = fresh;
      }
      if (!keep && viewIdRef.current) setViewId(null);
      apply(data, want, rows);
      lastRefresh.current = Date.now();
      setFromCache(false);
      setProblem(null);
      setPhase("ready");
      persist();
      return true;
    } catch (e) {
      // a failed read with a device copy on screen is fine (patchy wifi); without one it is the screen's problem to explain
      if (!viewRef.current) {
        const msg = e instanceof Error ? e.message : "";
        setProblem(/fetch|network|offline/i.test(msg) || !msg ? "The count could not be loaded. Check the connection and try again." : msg);
        setPhase("unavailable");
      }
      return false;
    }
  }, [apply, persist]);

  useEffect(() => {
    if (venueId == null || !email) return;
    let cancelled = false;
    setPhase("loading");
    setView(null);
    setViewId(null);
    setFromCache(false);
    setProblem(null);
    setOnline(isOnline());
    lastRefresh.current = Date.now(); // the first read is on its way: the page-show event must not start a second one
    readQueue();
    void (async () => {
      const cached = await readCountCache(venueId);
      if (cancelled) return;
      let usable = false;
      if (cacheUsable(cached, email, venueId)) {
        usable = true;
        apply({ categories: cached.categories, products: cached.products, sessions: cached.sessions }, cached.sessionId, cached.lines);
        setFromCache(true);
        setPhase("ready");
      } else if (cached) {
        void clearCountCache(venueId); // another person's copy (or an old format): never shown, removed
      }
      const loaded = await refresh();
      if (cancelled) return;
      if (!loaded && !usable && !viewRef.current && isOnline() === false) setPhase("offline-empty");
      void sync();
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(syncTimer.current);
    };
  }, [venueId, email, apply, refresh, sync, readQueue]);

  /* ---- coming back online, coming back to the page ---- */

  useEffect(() => {
    const retry = (full: boolean) => {
      setOnline(isOnline());
      if (!isOnline()) return;
      attempt.current = 0;
      void sync();
      if (full && Date.now() - lastRefresh.current > REFRESH_EVERY_MS) void refresh();
    };
    const onOnline = () => retry(true);
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") retry(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync, refresh]);

  /* ---- actions ---- */

  const setPar = useCallback(async (product: OrderingProduct, par: number): Promise<string | null> => {
    const data = viewRef.current;
    if (!data) return "The count is still loading.";
    if (!Number.isInteger(par) || par < 0) return "Build To must be a whole number, 0 or more.";
    if (!isOnline()) return "Changing Build To needs a connection. Your counts are still saved on this device.";
    const old = data.products.find((p) => p.id === product.id)?.par ?? product.par;
    const put = (value: number) => {
      const cur = viewRef.current;
      if (!cur) return;
      const next: VenueView = { ...cur, products: cur.products.map((p) => (p.id === product.id ? { ...p, par: value } : p)) };
      viewRef.current = next;
      setView(next);
    };
    put(par);
    try {
      await updateProduct(sb(), product.id, { par });
      persist();
      return null;
    } catch (err) {
      put(old);
      return err instanceof Error ? err.message : "Build To could not be saved.";
    }
  }, [persist]);

  const enter = useCallback(
    async (which: "open" | "last"): Promise<string | null> => {
      const { venueId: v, email: e } = ids.current;
      const data = viewRef.current;
      if (v == null || !data) return "The count is still loading.";
      const { open, last } = openOrLast(data.sessions);
      let target = which === "open" ? open : last;
      if (!target && which === "open") {
        if (!isOnline()) return "Starting a count needs a connection. Connect once, then you can count with no signal.";
        try {
          const res = await startCountSession(sb(), v, e, newId());
          target = res.session;
          const next: VenueView = { ...data, sessions: [res.session, ...data.sessions.filter((s) => s.id !== res.session.id)] };
          setView(next);
          viewRef.current = next;
        } catch (err) {
          return err instanceof Error ? err.message : "The count could not be started.";
        }
      }
      if (!target) return "There is no count to open yet.";
      setViewId(target.id);
      viewIdRef.current = target.id;
      let rows: OrderingCountLine[] = linesRef.current.sessionId === target.id ? linesRef.current.rows : [];
      if (isOnline()) {
        try {
          const gen = syncGen.current;
          const fresh = await loadCountLines(sb(), target.id);
          if (syncGen.current === gen && !syncingRef.current) rows = fresh;
        } catch {
          // keep what the device holds
        }
      }
      setLines({ sessionId: target.id, rows });
      linesRef.current = { sessionId: target.id, rows };
      persist();
      void sync();
      return null;
    },
    [persist, sync],
  );

  const leave = useCallback(() => {
    setViewId(null);
    viewIdRef.current = null;
  }, []);

  const setQty = useCallback(
    (product: OrderingProduct, place: "store" | "second", value: number | null) => {
      const { venueId: v, email: e } = ids.current;
      const sessionId = viewIdRef.current;
      if (v == null || !sessionId) return;
      const edit: CountEdit = {
        client_uuid: newId(),
        session_id: sessionId,
        venue_id: v,
        product_id: product.id,
        ...(place === "store" ? { store_qty: value } : { second_qty: value }),
        at: nowIso(),
        by: e,
        product_name: product.name,
        par_at_count: product.par,
        unit_name: product.unit_name,
      };
      const st = storage();
      const next = coalesceEdit(readCountQueue(st, v), edit, inFlight.current, newId);
      writeCountQueue(st, v, next); // on the device first ...
      setMemoryOnly(st.degraded());
      setQueue(next); // ... then on screen
      scheduleSync(700);
    },
    [scheduleSync],
  );

  const finalise = useCallback(async (): Promise<{ ok: boolean; message: string | null }> => {
    const { email: e } = ids.current;
    const id = viewIdRef.current;
    const data = viewRef.current;
    if (!id || !data) return { ok: false, message: "There is no count open." };
    const block = finaliseBlock({ online: isOnline(), pending: readQueue().length, syncing: syncingRef.current });
    if (block) {
      void sync();
      return { ok: false, message: block };
    }
    try {
      const s = await finaliseCountSession(sb(), id, e);
      const next: VenueView = { ...data, sessions: data.sessions.map((x) => (x.id === s.id ? s : x)) };
      setView(next);
      viewRef.current = next;
      persist();
      return { ok: true, message: null };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "The count could not be finalised." };
    }
  }, [persist, readQueue, sync]);

  const cancel = useCallback(async (): Promise<string | null> => {
    const { venueId: v } = ids.current;
    const data = viewRef.current;
    if (v == null || !data) return "The count is still loading.";
    const open = viewIdRef.current ? data.sessions.find((s) => s.id === viewIdRef.current && s.status === "in_progress") : openOrLast(data.sessions).open;
    if (!open) return "There is no count in progress.";
    if (!isOnline()) return "Cancelling a count needs a connection.";
    try {
      await cancelCountSession(sb(), open.id);
    } catch (err) {
      return err instanceof Error ? err.message : "The count could not be cancelled.";
    }
    // forget the device's waiting taps for it, and take it off screen
    const st = storage();
    const rest = readCountQueue(st, v).filter((e) => e.session_id !== open.id);
    writeCountQueue(st, v, rest);
    setQueue(rest);
    const next: VenueView = { ...data, sessions: data.sessions.filter((s) => s.id !== open.id) };
    viewRef.current = next;
    setView(next);
    setViewId(null);
    viewIdRef.current = null;
    setLines({ sessionId: null, rows: [] });
    linesRef.current = { sessionId: null, rows: [] };
    persist();
    return null;
  }, [persist]);

  /* ---- what the screen reads ---- */

  const sessions = view?.sessions ?? [];
  const { open, last } = useMemo(() => openOrLast(sessions), [sessions]);
  const session = useMemo(() => (viewId ? sessions.find((s) => s.id === viewId) ?? null : null), [sessions, viewId]);
  // the lines belong to the session in view, or (on the start screen) to the open one
  const lineSession = viewId ?? open?.id ?? null;
  const qty = useMemo(() => {
    const map = new Map<string, RowQty>();
    if (!lineSession) return map;
    const serverRows = lines.sessionId === lineSession ? lines.rows : [];
    const merged = countLinesWithQueue(serverRows, queue.filter((e) => e.session_id === lineSession));
    for (const l of merged) if (l.session_id === lineSession) map.set(l.product_id, { store: l.store_qty, second: l.second_qty });
    return map;
  }, [lineSession, lines, queue]);

  const status = useMemo(() => syncStatus({ online, pending: queue.length, syncing, failed }), [online, queue.length, syncing, failed]);

  return {
    phase,
    problem,
    fromCache,
    categories: view?.categories ?? [],
    products: view?.products ?? [],
    openSession: open,
    lastSession: last,
    session,
    qty,
    pending: queue.length,
    online,
    status,
    memoryOnly,
    enter,
    leave,
    setQty,
    finalise,
    cancel,
    setPar,
    syncNow: () => {
      attempt.current = 0;
      void sync();
    },
    reload: () => void refresh(),
  };
}
