"use client";

import { rebaselineParent } from "@/lib/integrity";
import { latestPortalRows } from "@/lib/insights";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "./supabase/client";
import {
  buildIndex,
  costItem,
  costPrep,
  parentKey,
  type CostingIndex,
  type ItemCost,
  type PrepCost,
} from "./costing";
import {
  DEFAULT_SETTINGS,
  type AllowedUser,
  type CostingSettings,
  type GelatoServe,
  type GelatoServeLine,
  type Beer,
  type BeerPrice,
  type BeerServe,
  type Ingredient,
  type MenuItem,
  type IngredientDeal,
  type Offer,
  type OfferLine,
  type PortalPrice,
  type Prep,
  type PriceLog,
  type SellPriceLog,
  type RecipeLine,
  type Setting,
  type Special,
  type Supplier,
  type Target,
  type Venue,
} from "./types";
import { buildGelato, type GelatoModel } from "./gelato";
import { buildBeer, type BeerModel } from "./beer";
import { brisbaneToday, groupDeals } from "./deals";
import { dealPriceChanges, rolloverDelayMs, rolloverMessage, ROLLOVER_TICK_MS } from "./rollover";
import { DEMO } from "./supabase/client";
import { costOffer, groupOfferLines, type OfferCost } from "./offers";
import {
  FetchError,
  MSG_BLOCKED,
  MSG_DEGRADED,
  MSG_UNVERIFIED,
  PERIODIC_STALE_MS,
  FOCUS_STALE_MS,
  TABLES,
  changedTables,
  compareFingerprint,
  initialHealth,
  isBlocked,
  isSchemaMissingError,
  parseFingerprint,
  reconcile,
  shouldRevalidate,
  tableLabel,
  writeCheckDelay,
  type Health,
  type RemoteFingerprint,
  type TableMismatch,
  type TableSpec,
} from "./health";

const PAGE = 1000;
const LOG_WINDOW_DAYS = 90;
// v2: caches written before the paging fix (commit 72e2d9d) could hold an incomplete load, so they are ignored
const CACHE_KEY = "precinct-cache-v2";

interface CacheEnvelope {
  savedAt: string;
  userEmail: string | null;
  data: StoreData;
}

function readCache(): CacheEnvelope | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    return env && env.data && Array.isArray(env.data.items) ? env : null;
  } catch {
    return null;
  }
}

function writeCache(env: CacheEnvelope) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(env));
  } catch {
    // quota exceeded or storage blocked — the cache is only an optimisation
  }
}

function clearCache() {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

type SinceFilter = { column: string; gte: string };

/**
 * Paging with .range() is only safe over a TOTAL order. Sorting by a column with repeated values
 * (recipe line `sort`, menu item `name` across venues, ...) lets Postgres return tied rows in a different
 * order on each page, so rows get skipped and repeated. Every table therefore gets a unique tie-breaker.
 */
const TIE_BREAK: Record<string, string> = {
  cost_settings: "key", // key is already unique
  cost_allowed_users: "email", // email is already unique
  cost_targets: "category", // (venue_id, category) is the primary key
};

export function pageOrder(table: string, order: string): string[] {
  const tie = TIE_BREAK[table] ?? "id";
  return tie === order ? [order] : [order, tie];
}

export async function fetchAll<T>(sb: SupabaseClient, table: string, order: string, since?: SinceFilter): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const cols = pageOrder(table, order);
  for (;;) {
    let q = sb.from(table).select("*");
    for (const c of cols) q = q.order(c, { ascending: true });
    q = q.range(from, from + PAGE - 1);
    if (since) q = q.gte(since.column, since.gte);
    const { data, error } = await q;
    if (error) throw new FetchError(table, error.message, (error as { code?: string }).code);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export interface SellPriceLogFilter {
  kind: SellPriceLog["kind"];
  /** menu item id (kind "item") */
  itemId?: string;
  /** beer id (kind "beer_serve") */
  beerId?: string;
  /** beer serve id or gelato serve id */
  serveId?: string;
  limit?: number;
}

/**
 * Loads sell price history on demand (never at startup). Newest first.
 * Returns [] if the table doesn't exist yet or the request fails, so screens never crash before the migration is applied.
 */
export async function fetchSellPriceLog(sb: SupabaseClient, f: SellPriceLogFilter): Promise<SellPriceLog[]> {
  try {
    let q = sb.from("cost_sell_price_log").select("*").eq("kind", f.kind);
    if (f.itemId) q = q.eq("item_id", f.itemId);
    if (f.beerId) q = q.eq("beer_id", f.beerId);
    if (f.serveId) q = q.eq("serve_id", f.serveId);
    const { data, error } = await q.order("changed_at", { ascending: false }).limit(f.limit ?? 50);
    if (error) return [];
    return (data ?? []) as SellPriceLog[];
  } catch {
    return [];
  }
}

export interface StoreData {
  venues: Venue[];
  settings: CostingSettings;
  rawSettings: Setting[];
  targets: Target[];
  suppliers: Supplier[];
  ingredients: Ingredient[];
  preps: Prep[];
  items: MenuItem[];
  lines: RecipeLine[];
  priceLogs: PriceLog[];
  specials: Special[];
  allowedUsers: AllowedUser[];
  gelatoServes: GelatoServe[];
  gelatoServeLines: GelatoServeLine[];
  beerServes: BeerServe[];
  beers: Beer[];
  beerPrices: BeerPrice[];
  /** specials & combos (cost_offers); [] until the offers migration is applied */
  offers: Offer[];
  offerLines: OfferLine[];
  /** supplier deals (cost_ingredient_deals); [] until the deals migration is applied */
  deals: IngredientDeal[];
}

export interface UsedIn {
  items: MenuItem[];
  preps: Prep[];
}

export interface StoreValue extends StoreData {
  /** true only while there is nothing to show yet (first ever load, no cache) */
  loading: boolean;
  /** background refresh in flight */
  refreshing: boolean;
  /** true once any data (cache or network) is available */
  ready: boolean;
  error: string | null;
  /** supplier catalogue (latest batch per supplier), lazy-loaded */
  portalPrices: PortalPrice[] | null;
  portalError: string | null;
  loadPortalPrices: () => void;
  userEmail: string | null;
  accessDenied: boolean;
  reload: () => Promise<void>;
  /** data integrity: was everything loaded, and does it still match the database? */
  health: Health;
  /** run the full load + verify again (the banner's Retry) */
  recheck: () => Promise<void>;
  /** increases each time another person's change was merged in, so the UI can say so once */
  externalUpdates: number;
  signOut: () => Promise<void>;
  // derived
  /** menu items as stored (items = these, minus the old gelato recipes, plus the virtual gelato flavour × serve items) */
  storedItems: MenuItem[];
  /** stored recipe lines plus the virtual gelato lines (for costing and insights) */
  allLines: RecipeLine[];
  gelato: GelatoModel;
  beer: BeerModel;
  /** today in Brisbane (yyyy-mm-dd). Held in state and moved at Brisbane midnight, so deal costing follows the date in a tab left open. */
  today: string;
  /** set each time a date rollover changed a deal price while the app was open (the shell shows one toast per id) */
  dealRollover: { id: number; message: string } | null;
  index: CostingIndex;
  itemCosts: Map<string, ItemCost>;
  /** costing of every offer (id -> OfferCost), from the same itemCosts as the menu */
  offerCosts: Map<string, OfferCost>;
  /** true when saving offer assumptions failed because cost_offers.assumptions is not there yet; they live in this session only */
  assumptionsUnsaved: boolean;
  /** supplier deals grouped by ingredient id */
  dealsByIngredient: Map<string, IngredientDeal[]>;
  prepCosts: Map<string, PrepCost>;
  venueById: Map<number, Venue>;
  supplierById: Map<number, Supplier>;
  usedIn: (componentType: "ingredient" | "prep", componentId: string) => UsedIn;
  // mutations
  updateItem: (id: string, patch: Partial<MenuItem>) => Promise<void>;
  insertItem: (item: Omit<MenuItem, "id">, lines: Omit<RecipeLine, "id" | "parent_id" | "parent_type">[]) => Promise<string>;
  deleteItem: (id: string) => Promise<void>;
  updatePrep: (id: string, patch: Partial<Prep>) => Promise<void>;
  insertPrep: (prep: Omit<Prep, "id">) => Promise<string>;
  deletePrep: (id: string) => Promise<void>;
  saveLines: (parentType: "item" | "prep", parentId: string, lines: RecipeLine[]) => Promise<void>;
  updateIngredient: (id: string, patch: Partial<Ingredient>) => Promise<void>;
  /** Mark the current pack price as checked today (Brisbane) without changing it. Returns what is needed to undo. */
  confirmIngredientPrice: (id: string) => Promise<ConfirmReceipt>;
  undoConfirmIngredientPrice: (id: string, receipt: ConfirmReceipt) => Promise<void>;
  insertIngredient: (ing: Omit<Ingredient, "id" | "updated_at">) => Promise<string>;
  updateSetting: (key: keyof CostingSettings, value: number) => Promise<void>;
  upsertTarget: (venueId: number, category: string, targetGp: number) => Promise<void>;
  insertSpecial: (s: Omit<Special, "id">) => Promise<void>;
  updateSpecial: (id: number, patch: Partial<Special>) => Promise<void>;
  deleteSpecial: (id: number) => Promise<void>;
  addAllowedUser: (email: string) => Promise<void>;
  removeAllowedUser: (email: string) => Promise<void>;
  insertServe: (s: Omit<GelatoServe, "id">) => Promise<string>;
  updateServe: (id: string, patch: Partial<GelatoServe>) => Promise<void>;
  deleteServe: (id: string) => Promise<void>;
  saveServeLines: (serveId: string, lines: GelatoServeLine[]) => Promise<void>;
  insertBeer: (b: Omit<Beer, "id">, prices: { serve_id: string; sell_price_inc: number | null }[]) => Promise<string>;
  updateBeer: (id: string, patch: Partial<Beer>) => Promise<void>;
  deleteBeer: (id: string) => Promise<void>;
  setBeerPrice: (beerId: string, serveId: string, patch: { sell_price_inc?: number | null; hh_price_inc?: number | null }) => Promise<void>;
  updateBeerServe: (id: string, patch: Partial<BeerServe>) => Promise<void>;
  createOffer: (o: Omit<Offer, "id" | "created_at" | "updated_at">, lines: Omit<OfferLine, "id" | "offer_id">[]) => Promise<string>;
  updateOffer: (id: string, patch: Partial<Offer>) => Promise<void>;
  deleteOffer: (id: string) => Promise<void>;
  /** replace an offer's components */
  setOfferLines: (offerId: string, lines: Omit<OfferLine, "id" | "offer_id">[]) => Promise<void>;
  duplicateOffer: (id: string) => Promise<string>;
  setOfferStatus: (id: string, status: Offer["status"]) => Promise<void>;
  addDeal: (deal: Omit<IngredientDeal, "id">) => Promise<string>;
  updateDeal: (id: string, patch: Partial<IngredientDeal>) => Promise<void>;
  deleteDeal: (id: string) => Promise<void>;
}

/** PostgREST / Postgres error text when cost_offers.assumptions has not been added yet. */
function isMissingAssumptionsColumn(message: string): boolean {
  return /assumptions/i.test(message);
}

const empty: StoreData = {
  venues: [],
  settings: DEFAULT_SETTINGS,
  rawSettings: [],
  targets: [],
  suppliers: [],
  ingredients: [],
  preps: [],
  items: [],
  lines: [],
  priceLogs: [],
  specials: [],
  allowedUsers: [],
  gelatoServes: [],
  gelatoServeLines: [],
  beerServes: [],
  beers: [],
  beerPrices: [],
  offers: [],
  offerLines: [],
  deals: [],
};

const StoreContext = createContext<StoreValue | null>(null);

function settingsFromRows(rows: Setting[]): CostingSettings {
  const get = (k: keyof CostingSettings) => {
    const r = rows.find((s) => s.key === k);
    return r && r.value != null ? Number(r.value) : DEFAULT_SETTINGS[k];
  };
  return { gst_rate: get("gst_rate"), round_to: get("round_to"), alert_pct: get("alert_pct"), gelato_wastage: get("gelato_wastage") };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------- integrity: fingerprint, snapshot, merge

export interface FingerprintResult {
  fp: RemoteFingerprint | null;
  /** rpc = cost_data_fingerprint(); counts = per-table head counts (older database, or the RPC failed); none = could not check */
  source: "rpc" | "counts" | "none";
  error?: string;
}

/**
 * One extra parallel call: what the database says every table holds. Falls back to lightweight per-table
 * counts (in parallel, no rows transferred) if the function is missing or errors. Never throws.
 */
export async function fetchFingerprint(sb: SupabaseClient, sinceIso: string): Promise<FingerprintResult> {
  try {
    const { data, error } = await sb.rpc("cost_data_fingerprint", { p_since: sinceIso });
    if (!error) {
      const fp = parseFingerprint(data);
      if (fp) return { fp, source: "rpc" };
    }
  } catch {
    /* fall through to counts */
  }
  try {
    const tables: RemoteFingerprint["tables"] = {};
    const results = await Promise.all(
      TABLES.map(async (spec) => {
        let q = sb.from(spec.table).select(spec.pk[0], { count: "exact", head: true });
        if (spec.windowed) q = q.gte(spec.order, sinceIso);
        const { count, error } = await q;
        return { spec, count, error };
      }),
    );
    for (const { spec, count, error } of results) {
      if (error) {
        if (spec.optional && isSchemaMissingError(error)) tables[spec.table] = { count: 0 };
        else return { fp: null, source: "none", error: `${spec.table}: ${error.message}` };
      } else if (count == null) {
        return { fp: null, source: "none", error: `${spec.table}: no count returned` };
      } else tables[spec.table] = { count };
    }
    return { fp: { tables }, source: "counts" };
  } catch (e) {
    return { fp: null, source: "none", error: e instanceof Error ? e.message : String(e) };
  }
}

function specFor(table: string): TableSpec {
  const s = TABLES.find((t) => t.table === table);
  if (!s) throw new Error(`Unknown table ${table}`);
  return s;
}

function fetchSpec(sb: SupabaseClient, spec: TableSpec, sinceIso: string): Promise<unknown[]> {
  return fetchAll<unknown>(sb, spec.table, spec.order, spec.windowed ? { column: spec.order, gte: sinceIso } : undefined);
}

export function rowsFromData(d: StoreData): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const spec of TABLES) out[spec.table] = (d as unknown as Record<string, unknown[]>)[spec.key] ?? [];
  return out;
}

/** Puts freshly loaded rows (by table name) into the store data; tables not in `rows` are left alone. */
export function mergeRows(prev: StoreData, rows: Record<string, unknown[]>): StoreData {
  const next = { ...prev } as unknown as Record<string, unknown>;
  for (const spec of TABLES) if (rows[spec.table]) next[spec.key] = rows[spec.table];
  const out = next as unknown as StoreData;
  return rows.cost_settings ? { ...out, settings: settingsFromRows(out.rawSettings) } : out;
}

export interface Snapshot {
  rows: Record<string, unknown[]>;
  remote: RemoteFingerprint | null;
  source: FingerprintResult["source"];
  /** still wrong after healing */
  mismatches: TableMismatch[];
  /** tables that had to be refetched to become consistent */
  healed: string[];
  /** the check itself could not run */
  unverified: boolean;
  /** every table is empty: no access (or the session ended) */
  blocked: boolean;
}

/**
 * The whole load: every table plus the fingerprint, all in parallel; then verify and, if a table is short or
 * has duplicates, refetch just that table (sequentially) and re-verify, up to twice.
 *
 * - A required table that fails throws (the caller shows "Couldn't load").
 * - An optional table is tolerated ONLY when it does not exist yet (42P01, 42703, PGRST205...). Any other error
 *   (network, RLS, timeout) is retried by the heal step and, if it persists, reported by name as a mismatch.
 */
export async function loadSnapshot(
  sb: SupabaseClient,
  sinceIso: string,
  prev?: Record<string, unknown[]>,
  hooks?: { onHealing?: (m: TableMismatch[]) => void },
): Promise<Snapshot> {
  const fpPromise = fetchFingerprint(sb, sinceIso);
  const settled = await Promise.all(
    TABLES.map(async (spec) => {
      try {
        return { spec, rows: await fetchSpec(sb, spec, sinceIso), error: null as unknown };
      } catch (error) {
        return { spec, rows: null as unknown[] | null, error };
      }
    }),
  );
  const fpRes = await fpPromise;
  const rows: Record<string, unknown[]> = {};
  const force: string[] = [];
  for (const { spec, rows: r, error } of settled) {
    if (r) rows[spec.table] = r;
    else if (spec.optional && isSchemaMissingError(error)) rows[spec.table] = [];
    else if (spec.optional) {
      rows[spec.table] = prev?.[spec.table] ?? [];
      force.push(spec.table);
    } else throw error instanceof Error ? error : new Error(String(error));
  }
  const res = await reconcile({
    rows,
    remote: fpRes.fp,
    force,
    refetch: (t) => fetchSpec(sb, specFor(t), sinceIso),
    remeasure: async () => (await fetchFingerprint(sb, sinceIso)).fp,
    onHealing: hooks?.onHealing,
  });
  return {
    rows: res.rows,
    remote: res.remote,
    source: fpRes.source,
    mismatches: res.mismatches,
    healed: res.refetched,
    unverified: res.unverified,
    blocked: isBlocked(res.remote) && Object.values(res.rows).every((r) => r.length === 0),
  };
}

/** What confirming a price changed, so it can be put back. */
export interface ConfirmReceipt {
  previousDate: string | null;
  logId: number | null;
}

// ---------------------------------------------------------------- write safety

const NOT_SAVED = "That change didn’t save. It may have been removed by someone else, or you may not have access. Refresh and try again.";

/** A write that reports success but touched fewer rows than expected (row level security can do this silently) is a failure. */
function assertSaved(rows: unknown[] | null, expected = 1) {
  if (!rows || rows.length < expected) throw new Error(NOT_SAVED);
}

async function updateOne(sb: SupabaseClient, table: string, col: string, val: string | number, patch: object) {
  const { data: rows, error } = await sb.from(table).update(patch).eq(col, val).select(col);
  if (error) throw new Error(error.message);
  assertSaved(rows);
}

/** Deletes one row and proves it is gone (0 rows deleted is fine only if the row no longer exists). */
async function deleteOne(sb: SupabaseClient, table: string, col: string, val: string | number) {
  const { data: rows, error } = await sb.from(table).delete().eq(col, val).select(col);
  if (error) throw new Error(error.message);
  if (rows && rows.length > 0) return;
  const { count, error: e2 } = await sb.from(table).select(col, { count: "exact", head: true }).eq(col, val);
  if (e2 || count == null || count > 0) throw new Error(NOT_SAVED);
}

async function upsertAll(sb: SupabaseClient, table: string, rows: object[], onConflict: string, col: string) {
  const { data, error } = await sb.from(table).upsert(rows, { onConflict }).select(col);
  if (error) throw new Error(error.message);
  assertSaved(data, rows.length);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // created in the browser only (it is used from effects/callbacks), so server prerendering never needs Supabase env vars
  const sb = useMemo(() => (typeof window === "undefined" ? (null as unknown as SupabaseClient) : getSupabaseBrowser()), []);
  const [data, setDataRaw] = useState<StoreData>(empty);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [portalPrices, setPortalPrices] = useState<PortalPrice[] | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [assumptionsUnsaved, setAssumptionsUnsaved] = useState(false);
  const [today, setTodayState] = useState<string>(() => brisbaneToday());
  const todayRef = useRef(today);
  todayRef.current = today;
  const [dealRollover, setDealRollover] = useState<{ id: number; message: string } | null>(null);
  const dateOverride = useRef(false);
  const [health, setHealth] = useState<Health>(initialHealth);
  const [externalUpdates, setExternalUpdates] = useState(0);
  const portalLoading = useRef(false);
  const loadedOnce = useRef(false);
  const serverLoaded = useRef(false);
  // integrity bookkeeping (refs: none of it should re-render anything by itself)
  const baseline = useRef<{ fp: RemoteFingerprint | null; at: number }>({ fp: null, at: 0 });
  const sinceRef = useRef("");
  const lastCheckRef = useRef<number | null>(null);
  const lastWriteRef = useRef<number | null>(null);
  const revalidating = useRef(false);
  const reloading = useRef(false);
  const warnedRepair = useRef(false);
  const writeTimer = useRef<number>();
  const revalidateRef = useRef<() => Promise<void>>(async () => {});

  /** every local change to the data goes through here: it remembers "the user wrote at T" so a check follows the write */
  const noteWrite = useCallback(() => {
    lastWriteRef.current = Date.now();
    if (typeof window === "undefined") return;
    window.clearTimeout(writeTimer.current);
    const d = writeCheckDelay(lastCheckRef.current, lastWriteRef.current, Date.now());
    if (d != null) writeTimer.current = window.setTimeout(() => void revalidateRef.current(), d);
  }, []);
  const setData = useCallback(
    (u: React.SetStateAction<StoreData>) => {
      noteWrite();
      setDataRaw(u);
    },
    [noteWrite],
  );

  const markVerified = useCallback(() => {
    setHealth((h) => ({ state: h.state === "repaired" ? "repaired" : "ok", mismatches: [], lastVerifiedAt: new Date().toISOString(), message: null }));
  }, []);

  const reload = useCallback(async () => {
    if (reloading.current) return;
    reloading.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await sb.auth.getUser();
      setUserEmail(user?.email ?? null);
      const since = new Date(Date.now() - LOG_WINDOW_DAYS * 86_400_000).toISOString();
      sinceRef.current = since;
      // every table AND the fingerprint load in parallel; verification and any healing happen before the data is shown
      const snap = await loadSnapshot(sb, since, rowsFromData(dataRef.current), {
        onHealing: (m) => setHealth((h) => ({ ...h, state: "healing", mismatches: m, message: null })),
      });
      const now = Date.now();
      lastCheckRef.current = now;
      baseline.current = { fp: snap.remote, at: now };
      if (snap.blocked) {
        // nothing readable for this session: never keep showing an old cached copy
        clearCache();
        setDataRaw(mergeRows(empty, snap.rows));
        setHealth({ state: "blocked", mismatches: [], lastVerifiedAt: null, message: MSG_BLOCKED });
      } else {
        setDataRaw((prev) => mergeRows(prev, snap.rows));
        if (snap.mismatches.length) {
          setHealth({ state: "degraded", mismatches: snap.mismatches, lastVerifiedAt: null, message: MSG_DEGRADED });
        } else if (snap.unverified) {
          setHealth({ state: "degraded", mismatches: [], lastVerifiedAt: null, message: MSG_UNVERIFIED, unverified: true });
        } else {
          const repaired = snap.healed.length > 0;
          if (repaired && !warnedRepair.current) {
            warnedRepair.current = true;
            console.warn(`[data-health] Load was incomplete and was repaired by refetching: ${snap.healed.map(tableLabel).join(", ")}`);
          }
          setHealth({ state: repaired ? "repaired" : "ok", mismatches: [], lastVerifiedAt: new Date().toISOString(), message: null });
        }
      }
      serverLoaded.current = true;
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // whatever is on screen (a saved copy) could not be checked against the database
      setHealth((h) => ({ ...h, state: "degraded", message: MSG_UNVERIFIED, unverified: true, lastVerifiedAt: null }));
    } finally {
      reloading.current = false;
      setRefreshing(false);
    }
  }, [sb]);

  /**
   * Background check: does what we hold still match the database? Someone else's edit shows as a changed table
   * hash; a write of ours that never landed (or a dropped row) shows as a count mismatch. Only the affected tables
   * are refetched and swapped in; no loader, no remount, editor state untouched.
   */
  const revalidate = useCallback(async () => {
    if (!serverLoaded.current || revalidating.current || reloading.current) return;
    revalidating.current = true;
    const startedAt = Date.now();
    try {
      const { fp } = await fetchFingerprint(sb, sinceRef.current);
      lastCheckRef.current = Date.now();
      if (!fp) return; // could not check right now: keep the current state, try again on the next trigger
      const local = rowsFromData(dataRef.current);
      const prev = baseline.current;
      const changed = prev.fp ? changedTables(prev.fp, fp) : [];
      const wrong = compareFingerprint(local, fp).mismatches;
      if (isBlocked(fp)) {
        clearCache();
        setDataRaw((d) => mergeRows(d, Object.fromEntries(TABLES.map((t) => [t.table, []]))));
        setHealth({ state: "blocked", mismatches: [], lastVerifiedAt: null, message: MSG_BLOCKED });
        return;
      }
      if (!changed.length && !wrong.length) {
        baseline.current = { fp, at: Date.now() };
        markVerified();
        return;
      }
      const res = await reconcile({
        rows: local,
        remote: fp,
        force: changed,
        refetch: (t) => fetchSpec(sb, specFor(t), sinceRef.current),
        remeasure: async () => (await fetchFingerprint(sb, sinceRef.current)).fp,
      });
      // the user edited while we were checking: their change is newer than what we fetched, so do not overwrite it.
      // (noteWrite already scheduled the next check.)
      if (lastWriteRef.current != null && lastWriteRef.current > startedAt) return;
      const fresh = Object.fromEntries(res.refetched.map((t) => [t, res.rows[t]]));
      if (res.refetched.length) setDataRaw((d) => mergeRows(d, fresh));
      baseline.current = { fp: res.remote ?? fp, at: Date.now() };
      if (res.mismatches.length) setHealth({ state: "degraded", mismatches: res.mismatches, lastVerifiedAt: null, message: MSG_DEGRADED });
      else markVerified();
      // say so only when the change came from someone else (an own write since the last sync explains the difference)
      const ownWrite = lastWriteRef.current != null && lastWriteRef.current > prev.at;
      if (changed.length && !ownWrite) setExternalUpdates((n) => n + 1);
    } catch (e) {
      console.warn("[data-health] background check failed", e);
    } finally {
      revalidating.current = false;
    }
  }, [sb, markVerified]);
  revalidateRef.current = revalidate;

  /** after a multi-step write fails part way, put the affected tables back to what the database really holds */
  const resync = useCallback(
    async (tables: string[]) => {
      const rows: Record<string, unknown[]> = {};
      for (const t of tables) {
        try {
          rows[t] = await fetchSpec(sb, specFor(t), sinceRef.current);
        } catch {
          /* the next background check will reconcile it */
        }
      }
      if (Object.keys(rows).length) setDataRaw((d) => mergeRows(d, rows));
      noteWrite();
    },
    [sb, noteWrite],
  );

  // stale-while-revalidate: paint from the local cache instantly, then refresh from Supabase
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    const cached = readCache();
    if (cached) {
      setDataRaw({ ...empty, ...cached.data, settings: { ...DEFAULT_SETTINGS, ...cached.data.settings } });
      setUserEmail(cached.userEmail);
      setReady(true);
    }
    void reload();
  }, [reload]);

  // check again when the tab comes back, and every 3 minutes while it is visible
  useEffect(() => {
    const due = (staleMs: number) => shouldRevalidate(lastCheckRef.current, lastWriteRef.current, Date.now(), document.hidden, staleMs);
    const onVisible = () => {
      if (due(FOCUS_STALE_MS)) void revalidateRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const tick = window.setInterval(() => {
      if (due(PERIODIC_STALE_MS)) void revalidateRef.current();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(tick);
      window.clearTimeout(writeTimer.current);
    };
  }, []);

  // persist the latest full dataset (debounced), but only data that has been verified: never cache a partial load
  useEffect(() => {
    if (!serverLoaded.current) return;
    if (health.state !== "ok" && health.state !== "repaired") return;
    const t = window.setTimeout(() => writeCache({ savedAt: new Date().toISOString(), userEmail, data }), 1200);
    return () => window.clearTimeout(t);
  }, [data, userEmail, health.state]);

  const loadPortalPrices = useCallback(() => {
    if (portalLoading.current) return;
    portalLoading.current = true;
    setPortalError(null);
    (async () => {
      try {
        const all = await fetchAll<PortalPrice>(sb, "cost_portal_prices", "id");
        // latest batch per supplier; every batch tied on the newest capture time is kept (see latestPortalRows)
        setPortalPrices(latestPortalRows(all));
      } catch (e) {
        setPortalError(e instanceof Error ? e.message : String(e));
        portalLoading.current = false;
      }
    })();
  }, [sb]);

  // Deals follow the date: move `today` at Brisbane midnight (timer), on tab focus / visibility, and by a 60s safety tick.
  // Everything costed from the index depends on `today`, so a change recomputes costs in place (no remount, editors keep state).
  const applyToday = useCallback((next: string) => {
    const prev = todayRef.current;
    if (next === prev) return;
    const d = dataRef.current;
    const message = rolloverMessage(dealPriceChanges(d.ingredients, d.deals, prev, next));
    todayRef.current = next;
    setTodayState(next);
    if (message) setDealRollover({ id: Date.now(), message });
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      if (!dateOverride.current) applyToday(brisbaneToday());
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        check();
        schedule();
      }, rolloverDelayMs(Date.now()));
    };
    const onVisible = () => {
      if (!document.hidden) {
        check();
        schedule();
      }
    };
    schedule();
    const tick = window.setInterval(check, ROLLOVER_TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    // local QA only: simulate a date rollover from the console (never present outside demo mode)
    const w = window as Window & { __setToday?: (d: string) => void };
    if (DEMO) {
      w.__setToday = (d: string) => {
        dateOverride.current = true;
        applyToday(d);
      };
    }
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (DEMO) delete w.__setToday;
    };
  }, [applyToday]);

  const signOut = useCallback(async () => {
    clearCache();
    await sb.auth.signOut();
    window.location.href = "/login";
  }, [sb]);

  const loading = !ready;

  const accessDenied = useMemo(() => {
    if (loading || refreshing || !serverLoaded.current) return false;
    if (!userEmail) return false;
    return !data.allowedUsers.some((u) => u.email.toLowerCase() === userEmail.toLowerCase());
  }, [loading, refreshing, userEmail, data.allowedUsers]);

  // ---- derived ----
  const gelato = useMemo(
    () =>
      buildGelato({
        venues: data.venues,
        preps: data.preps,
        items: data.items,
        serves: data.gelatoServes,
        serveLines: data.gelatoServeLines,
        wastage: data.settings.gelato_wastage,
        targets: data.targets,
      }),
    [data.venues, data.preps, data.items, data.gelatoServes, data.gelatoServeLines, data.settings.gelato_wastage, data.targets],
  );
  const beer = useMemo(() => buildBeer({ beers: data.beers, serves: data.beerServes, prices: data.beerPrices }), [data.beers, data.beerServes, data.beerPrices]);
  const items = useMemo(
    () =>
      gelato.items.length || gelato.replacedItemIds.size || beer.items.length
        ? [...data.items.filter((i) => !gelato.replacedItemIds.has(i.id) && !beer.replacedItemIds.has(i.id)), ...gelato.items, ...beer.items]
        : data.items,
    [data.items, gelato, beer],
  );
  const allLines = useMemo(() => (gelato.lines.length || beer.lines.length ? [...data.lines, ...gelato.lines, ...beer.lines] : data.lines), [data.lines, gelato.lines, beer.lines]);
  // deals are applied by date: `today` is an explicit dependency, so the index (and every cost built on it) recomputes at rollover
  const index = useMemo(() => buildIndex(data.ingredients, data.preps, allLines, data.deals, today), [data.ingredients, data.preps, allLines, data.deals, today]);
  const dealsByIngredient = useMemo(() => groupDeals(data.deals), [data.deals]);
  const prepCosts = useMemo(() => {
    const cache = new Map<string, PrepCost>();
    const out = new Map<string, PrepCost>();
    for (const p of data.preps) out.set(p.id, costPrep(p, index, data.settings.gst_rate, [], cache));
    return out;
  }, [data.preps, index, data.settings.gst_rate]);
  const itemCosts = useMemo(() => {
    const cache = new Map<string, PrepCost>();
    const out = new Map<string, ItemCost>();
    for (const it of items) out.set(it.id, costItem(it, index, data.settings, data.targets, cache));
    return out;
  }, [items, index, data.settings, data.targets]);
  const offerCosts = useMemo(() => {
    const byOffer = groupOfferLines(data.offerLines);
    const out = new Map<string, OfferCost>();
    for (const o of data.offers) out.set(o.id, costOffer(o, byOffer.get(o.id) ?? [], { itemCosts, settings: data.settings }));
    return out;
  }, [data.offers, data.offerLines, itemCosts, data.settings]);
  const venueById = useMemo(() => new Map(data.venues.map((v) => [v.id, v])), [data.venues]);
  const supplierById = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s])), [data.suppliers]);
  const usedInIndex = useMemo(() => {
    const m = new Map<string, { items: Set<string>; preps: Set<string> }>();
    for (const l of data.lines) {
      const k = `${l.component_type}:${l.component_id}`;
      let e = m.get(k);
      if (!e) {
        e = { items: new Set(), preps: new Set() };
        m.set(k, e);
      }
      if (l.parent_type === "item") e.items.add(l.parent_id);
      else e.preps.add(l.parent_id);
    }
    return m;
  }, [data.lines]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const usedIn = useCallback(
    (componentType: "ingredient" | "prep", componentId: string): UsedIn => {
      const e = usedInIndex.get(`${componentType}:${componentId}`);
      if (!e) return { items: [], preps: [] };
      return {
        items: [...e.items].map((id) => itemById.get(id)).filter((x): x is MenuItem => !!x),
        preps: [...e.preps].map((id) => index.preps.get(id)).filter((x): x is Prep => !!x),
      };
    },
    [usedInIndex, itemById, index.preps],
  );

  // ---- mutations ----
  // Rules for every action below (Troy: the app must never show an unsaved change as saved):
  //  1. the local copy changes only AFTER the database confirmed the write, unless the action is optimistic (deals),
  //     in which case a failure rolls the change back;
  //  2. `error` is always checked, and updates / deletes / upserts must also report the rows they touched
  //     (row level security can turn a write into a silent no-op);
  //  3. a multi-step write that fails part way is compensated or the affected tables are refetched;
  //  4. ids for uuid tables are generated here (the column accepts them); serial ids (cost_specials) are read back from the insert.
  const updateItem = useCallback(
    async (id: string, patch: Partial<MenuItem>) => {
      await updateOne(sb, "cost_menu_items", "id", id, patch);
      setData((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    },
    [sb, setData],
  );

  const insertItem = useCallback(
    async (item: Omit<MenuItem, "id">, lines: Omit<RecipeLine, "id" | "parent_id" | "parent_type">[]) => {
      const id = newId();
      const row: MenuItem = { ...item, id };
      const { error } = await sb.from("cost_menu_items").insert(row);
      if (error) throw new Error(error.message);
      const newLines: RecipeLine[] = lines.map((l) => ({ ...l, id: newId(), parent_type: "item", parent_id: id }));
      if (newLines.length) {
        const { error: e2 } = await sb.from("cost_recipe_lines").insert(newLines);
        if (e2) {
          // don't leave a dish with no recipe behind
          const { error: e3 } = await sb.from("cost_menu_items").delete().eq("id", id);
          if (e3) await resync(["cost_menu_items"]);
          throw new Error(e2.message);
        }
      }
      setData((d) => ({ ...d, items: [...d.items, row], lines: [...d.lines, ...newLines] }));
      return id;
    },
    [sb, setData, resync],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const { error: e1 } = await sb.from("cost_recipe_lines").delete().eq("parent_type", "item").eq("parent_id", id);
      if (e1) throw new Error(e1.message);
      try {
        await deleteOne(sb, "cost_menu_items", "id", id);
      } catch (e) {
        await resync(["cost_recipe_lines"]); // the recipe lines are already gone from the database: show that
        throw e;
      }
      rebaselineParent("item", id, null);
      setData((d) => ({
        ...d,
        items: d.items.filter((i) => i.id !== id),
        lines: d.lines.filter((l) => !(l.parent_type === "item" && l.parent_id === id)),
      }));
    },
    [sb, setData, resync],
  );

  const updatePrep = useCallback(
    async (id: string, patch: Partial<Prep>) => {
      await updateOne(sb, "cost_preps", "id", id, patch);
      setData((d) => ({ ...d, preps: d.preps.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },
    [sb, setData],
  );

  const insertPrep = useCallback(
    async (prep: Omit<Prep, "id">) => {
      const id = newId();
      const row: Prep = { ...prep, id };
      const { error } = await sb.from("cost_preps").insert(row);
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, preps: [...d.preps, row] }));
      return id;
    },
    [sb, setData],
  );

  const deletePrep = useCallback(
    async (id: string) => {
      const { error: e1 } = await sb.from("cost_recipe_lines").delete().eq("parent_type", "prep").eq("parent_id", id);
      if (e1) throw new Error(e1.message);
      try {
        await deleteOne(sb, "cost_preps", "id", id);
      } catch (e) {
        await resync(["cost_recipe_lines"]);
        throw e;
      }
      rebaselineParent("prep", id, null);
      setData((d) => ({
        ...d,
        preps: d.preps.filter((p) => p.id !== id),
        lines: d.lines.filter((l) => !(l.parent_type === "prep" && l.parent_id === id)),
      }));
    },
    [sb, setData, resync],
  );

  const saveLines = useCallback(
    async (parentType: "item" | "prep", parentId: string, next: RecipeLine[]) => {
      const key = parentKey(parentType, parentId);
      const existing = index.linesByParent.get(key) ?? [];
      const nextIds = new Set(next.map((l) => l.id));
      const removed = existing.filter((l) => !nextIds.has(l.id)).map((l) => l.id);
      const normalised = next.map((l, i) => ({ ...l, parent_type: parentType, parent_id: parentId, sort: i + 1, qty: Number(l.qty) || 0 }));
      try {
        if (removed.length) {
          const { error } = await sb.from("cost_recipe_lines").delete().in("id", removed);
          if (error) throw new Error(error.message);
        }
        if (normalised.length) await upsertAll(sb, "cost_recipe_lines", normalised, "id", "id");
      } catch (e) {
        await resync(["cost_recipe_lines"]); // part of the save may have landed: show the database's version
        throw e;
      }
      rebaselineParent(parentType, parentId, normalised.length);
      setData((d) => ({
        ...d,
        lines: [...d.lines.filter((l) => !(l.parent_type === parentType && l.parent_id === parentId)), ...normalised],
      }));
    },
    [sb, setData, resync, index.linesByParent],
  );

  const confirmIngredientPrice = useCallback(
    async (id: string): Promise<ConfirmReceipt> => {
      const ing = data.ingredients.find((i) => i.id === id);
      if (!ing) throw new Error(NOT_SAVED);
      const previousDate = ing.last_price_update;
      // only last_price_update is written: the price, and every cost built on it, stays exactly as it is
      const { data: rows, error } = await sb.from("cost_ingredients").update({ last_price_update: brisbaneToday() }).eq("id", id).select("*");
      if (error) throw new Error(error.message);
      assertSaved(rows);
      const fresh = rows?.[0] as Ingredient | undefined;
      setData((d) => ({ ...d, ingredients: d.ingredients.map((i) => (i.id === id ? (fresh ?? { ...i, last_price_update: brisbaneToday() }) : i)) }));
      // history entry (same price on both sides); the confirmation itself is already saved if this fails
      let logId: number | null = null;
      const { data: logRows } = await sb
        .from("cost_price_log")
        .insert({ ingredient_id: id, changed_at: new Date().toISOString(), old_price: ing.pack_price, new_price: ing.pack_price, source: "Price confirmed", entered_by: userEmail })
        .select("*");
      const log = logRows?.[0] as PriceLog | undefined;
      if (log) {
        logId = log.id;
        setData((d) => ({ ...d, priceLogs: d.priceLogs.some((l) => l.id === log.id) ? d.priceLogs : [...d.priceLogs, log] }));
      }
      return { previousDate, logId };
    },
    [sb, setData, data.ingredients, userEmail],
  );

  const undoConfirmIngredientPrice = useCallback(
    async (id: string, receipt: ConfirmReceipt) => {
      const { data: rows, error } = await sb.from("cost_ingredients").update({ last_price_update: receipt.previousDate }).eq("id", id).select("*");
      if (error) throw new Error(error.message);
      assertSaved(rows);
      const fresh = rows?.[0] as Ingredient | undefined;
      setData((d) => ({
        ...d,
        ingredients: d.ingredients.map((i) => (i.id === id ? (fresh ?? { ...i, last_price_update: receipt.previousDate }) : i)),
        priceLogs: receipt.logId == null ? d.priceLogs : d.priceLogs.filter((l) => l.id !== receipt.logId),
      }));
      // remove only the row the confirmation itself wrote
      if (receipt.logId != null) await sb.from("cost_price_log").delete().eq("id", receipt.logId);
    },
    [sb, setData],
  );

  const updateIngredient = useCallback(
    async (id: string, patch: Partial<Ingredient>) => {
      // The DB trigger maintains previous_price / last_price_update / cost_price_log when pack_price changes.
      const { data: rows, error } = await sb.from("cost_ingredients").update(patch).eq("id", id).select("*");
      if (error) throw new Error(error.message);
      assertSaved(rows);
      const fresh = (rows?.[0] as Ingredient | undefined) ?? null;
      setData((d) => ({
        ...d,
        ingredients: d.ingredients.map((i) => (i.id === id ? (fresh ? fresh : { ...i, ...patch }) : i)),
      }));
      if (patch.pack_price !== undefined) {
        // pull the trigger-written log rows for this ingredient so alerts refresh without a full reload
        const { data: logs } = await sb.from("cost_price_log").select("*").eq("ingredient_id", id).order("changed_at", { ascending: false }).limit(5);
        if (logs && logs.length) {
          setData((d) => {
            const known = new Set(d.priceLogs.map((l) => l.id));
            const add = (logs as PriceLog[]).filter((l) => !known.has(l.id));
            return add.length ? { ...d, priceLogs: [...d.priceLogs, ...add] } : d;
          });
        }
      }
    },
    [sb, setData],
  );

  const insertIngredient = useCallback(
    async (ing: Omit<Ingredient, "id" | "updated_at">) => {
      const id = newId();
      const row = { ...ing, id };
      const { data: rows, error } = await sb.from("cost_ingredients").insert(row).select("*");
      if (error) throw new Error(error.message);
      const fresh = rows?.[0] as Ingredient | undefined;
      if (!fresh) throw new Error(NOT_SAVED);
      setData((d) => ({ ...d, ingredients: [...d.ingredients, fresh].sort((a, b) => a.name.localeCompare(b.name)) }));
      return id;
    },
    [sb, setData],
  );

  const updateSetting = useCallback(
    async (key: keyof CostingSettings, value: number) => {
      await upsertAll(sb, "cost_settings", [{ key, value }], "key", "key");
      setData((d) => {
        const rawSettings = d.rawSettings.some((s) => s.key === key)
          ? d.rawSettings.map((s) => (s.key === key ? { ...s, value } : s))
          : [...d.rawSettings, { key, value }];
        return { ...d, rawSettings, settings: settingsFromRows(rawSettings) };
      });
    },
    [sb, setData],
  );

  const upsertTarget = useCallback(
    async (venueId: number, category: string, targetGp: number) => {
      await upsertAll(sb, "cost_targets", [{ venue_id: venueId, category, target_gp: targetGp }], "venue_id,category", "category");
      setData((d) => {
        const exists = d.targets.some((t) => t.venue_id === venueId && t.category === category);
        const targets = exists
          ? d.targets.map((t) => (t.venue_id === venueId && t.category === category ? { ...t, target_gp: targetGp } : t))
          : [...d.targets, { venue_id: venueId, category, target_gp: targetGp }];
        return { ...d, targets };
      });
    },
    [sb, setData],
  );

  const insertSpecial = useCallback(
    async (s: Omit<Special, "id">) => {
      // cost_specials.id is a serial: the database assigns it, so the row is read back from the insert
      const { data: rows, error } = await sb.from("cost_specials").insert(s).select("*");
      if (error) throw new Error(error.message);
      const row = rows?.[0] as Special | undefined;
      if (!row) throw new Error(NOT_SAVED);
      setData((d) => ({ ...d, specials: [...d.specials, row] }));
    },
    [sb, setData],
  );

  const updateSpecial = useCallback(
    async (id: number, patch: Partial<Special>) => {
      await updateOne(sb, "cost_specials", "id", id, patch);
      setData((d) => ({ ...d, specials: d.specials.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    },
    [sb, setData],
  );

  const deleteSpecial = useCallback(
    async (id: number) => {
      await deleteOne(sb, "cost_specials", "id", id);
      setData((d) => ({ ...d, specials: d.specials.filter((s) => s.id !== id) }));
    },
    [sb, setData],
  );

  const addAllowedUser = useCallback(
    async (email: string) => {
      const clean = email.trim().toLowerCase();
      const { error } = await sb.from("cost_allowed_users").insert({ email: clean });
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, allowedUsers: [...d.allowedUsers, { email: clean }].sort((a, b) => a.email.localeCompare(b.email)) }));
    },
    [sb, setData],
  );

  const removeAllowedUser = useCallback(
    async (email: string) => {
      await deleteOne(sb, "cost_allowed_users", "email", email);
      setData((d) => ({ ...d, allowedUsers: d.allowedUsers.filter((u) => u.email !== email) }));
    },
    [sb, setData],
  );

  const insertServe = useCallback(
    async (s: Omit<GelatoServe, "id">) => {
      const id = newId();
      const row: GelatoServe = { ...s, id };
      const { error } = await sb.from("cost_gelato_serves").insert(row);
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, gelatoServes: [...d.gelatoServes, row] }));
      return id;
    },
    [sb, setData],
  );

  const updateServe = useCallback(
    async (id: string, patch: Partial<GelatoServe>) => {
      await updateOne(sb, "cost_gelato_serves", "id", id, patch);
      setData((d) => ({ ...d, gelatoServes: d.gelatoServes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    },
    [sb, setData],
  );

  const deleteServe = useCallback(
    async (id: string) => {
      await deleteOne(sb, "cost_gelato_serves", "id", id);
      setData((d) => ({ ...d, gelatoServes: d.gelatoServes.filter((s) => s.id !== id), gelatoServeLines: d.gelatoServeLines.filter((l) => l.serve_id !== id) }));
    },
    [sb, setData],
  );

  const saveServeLines = useCallback(
    async (serveId: string, next: GelatoServeLine[]) => {
      const existing = dataRef.current.gelatoServeLines.filter((l) => l.serve_id === serveId);
      const nextIds = new Set(next.map((l) => l.id));
      const removed = existing.filter((l) => !nextIds.has(l.id)).map((l) => l.id);
      const normalised = next.map((l, i) => ({ ...l, serve_id: serveId, sort: i + 1, qty: Number(l.qty) || 0 }));
      try {
        if (removed.length) {
          const { error } = await sb.from("cost_gelato_serve_lines").delete().in("id", removed);
          if (error) throw new Error(error.message);
        }
        if (normalised.length) await upsertAll(sb, "cost_gelato_serve_lines", normalised, "id", "id");
      } catch (e) {
        await resync(["cost_gelato_serve_lines"]);
        throw e;
      }
      setData((d) => ({ ...d, gelatoServeLines: [...d.gelatoServeLines.filter((l) => l.serve_id !== serveId), ...normalised] }));
    },
    [sb, setData, resync],
  );

  const insertBeer = useCallback(
    async (b: Omit<Beer, "id">, prices: { serve_id: string; sell_price_inc: number | null }[]) => {
      const id = newId();
      const row: Beer = { ...b, id };
      const { error } = await sb.from("cost_beers").insert(row);
      if (error) throw new Error(error.message);
      const priceRows: BeerPrice[] = prices.map((p) => ({ id: newId(), beer_id: id, serve_id: p.serve_id, sell_price_inc: p.sell_price_inc, hh_price_inc: null }));
      if (priceRows.length) {
        const { error: e2 } = await sb.from("cost_beer_prices").insert(priceRows);
        if (e2) {
          // don't leave a beer with no prices behind (its price rows cascade)
          const { error: e3 } = await sb.from("cost_beers").delete().eq("id", id);
          if (e3) await resync(["cost_beers", "cost_beer_prices"]);
          throw new Error(e2.message);
        }
      }
      setData((d) => ({ ...d, beers: [...d.beers, row], beerPrices: [...d.beerPrices, ...priceRows] }));
      return id;
    },
    [sb, setData, resync],
  );

  const updateBeer = useCallback(
    async (id: string, patch: Partial<Beer>) => {
      await updateOne(sb, "cost_beers", "id", id, patch);
      setData((d) => ({ ...d, beers: d.beers.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    },
    [sb, setData],
  );

  const deleteBeer = useCallback(
    async (id: string) => {
      await deleteOne(sb, "cost_beers", "id", id);
      setData((d) => ({ ...d, beers: d.beers.filter((b) => b.id !== id), beerPrices: d.beerPrices.filter((p) => p.beer_id !== id) }));
    },
    [sb, setData],
  );

  const setBeerPrice = useCallback(
    async (beerId: string, serveId: string, patch: { sell_price_inc?: number | null; hh_price_inc?: number | null }) => {
      const cur = dataRef.current.beerPrices.find((p) => p.beer_id === beerId && p.serve_id === serveId);
      const row: BeerPrice = { id: cur?.id ?? newId(), beer_id: beerId, serve_id: serveId, sell_price_inc: cur?.sell_price_inc ?? null, hh_price_inc: cur?.hh_price_inc ?? null, legacy_item_id: cur?.legacy_item_id ?? null, ...patch };
      await upsertAll(sb, "cost_beer_prices", [row], "beer_id,serve_id", "id");
      setData((d) => ({ ...d, beerPrices: [...d.beerPrices.filter((p) => !(p.beer_id === beerId && p.serve_id === serveId)), row] }));
    },
    [sb, setData],
  );

  const updateBeerServe = useCallback(
    async (id: string, patch: Partial<BeerServe>) => {
      await updateOne(sb, "cost_beer_serves", "id", id, patch);
      setData((d) => ({ ...d, beerServes: d.beerServes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    },
    [sb, setData],
  );

  // ---- offers (specials & combos) ----
  const createOffer = useCallback(
    async (o: Omit<Offer, "id" | "created_at" | "updated_at">, lines: Omit<OfferLine, "id" | "offer_id">[]) => {
      const id = newId();
      const row: Offer = { ...o, id };
      let { error } = await sb.from("cost_offers").insert(row);
      if (error && isMissingAssumptionsColumn(error.message)) {
        // the assumptions column is not there yet: save the offer without it and keep the assumptions in local state
        const { assumptions: _a, ...bare } = row;
        setAssumptionsUnsaved(true);
        ({ error } = await sb.from("cost_offers").insert(bare));
      }
      if (error) throw new Error(error.message);
      const newLines: OfferLine[] = lines.map((l, i) => ({ ...l, id: newId(), offer_id: id, sort: i + 1, qty: Number(l.qty) || 1 }));
      if (newLines.length) {
        const { error: e2 } = await sb.from("cost_offer_lines").insert(newLines);
        if (e2) {
          const { error: e3 } = await sb.from("cost_offers").delete().eq("id", id); // don't leave an offer with no lines behind
          if (e3) await resync(["cost_offers", "cost_offer_lines"]);
          throw new Error(e2.message);
        }
      }
      setData((d) => ({ ...d, offers: [...d.offers, row], offerLines: [...d.offerLines, ...newLines] }));
      return id;
    },
    [sb, setData, resync],
  );

  const updateOffer = useCallback(
    async (id: string, patch: Partial<Offer>) => {
      let { data: rows, error } = await sb.from("cost_offers").update(patch).eq("id", id).select("id");
      if (error && "assumptions" in patch && isMissingAssumptionsColumn(error.message)) {
        // keep the rest of the save, hold the assumptions in local state, and say so
        const { assumptions: _a, ...bare } = patch;
        setAssumptionsUnsaved(true);
        ({ data: rows, error } = await sb.from("cost_offers").update(bare).eq("id", id).select("id"));
      }
      if (error) throw new Error(error.message);
      assertSaved(rows);
      setData((d) => ({ ...d, offers: d.offers.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
    },
    [sb, setData],
  );

  const deleteOffer = useCallback(
    async (id: string) => {
      await deleteOne(sb, "cost_offers", "id", id); // lines go with it (on delete cascade)
      setData((d) => ({ ...d, offers: d.offers.filter((o) => o.id !== id), offerLines: d.offerLines.filter((l) => l.offer_id !== id) }));
    },
    [sb, setData],
  );

  const setOfferLines = useCallback(
    async (offerId: string, lines: Omit<OfferLine, "id" | "offer_id">[]) => {
      const next: OfferLine[] = lines.map((l, i) => ({ ...l, id: newId(), offer_id: offerId, sort: i + 1, qty: Number(l.qty) || 1 }));
      const oldIds = dataRef.current.offerLines.filter((l) => l.offer_id === offerId).map((l) => l.id);
      // add the new lines first, then remove the old ones: a failure part way never leaves the offer without lines
      if (next.length) {
        const { error } = await sb.from("cost_offer_lines").insert(next);
        if (error) throw new Error(error.message);
      }
      if (oldIds.length) {
        const { error } = await sb.from("cost_offer_lines").delete().in("id", oldIds);
        if (error) {
          if (next.length) await sb.from("cost_offer_lines").delete().in("id", next.map((l) => l.id)); // undo, so lines are not doubled
          await resync(["cost_offer_lines"]);
          throw new Error(error.message);
        }
      }
      setData((d) => ({ ...d, offerLines: [...d.offerLines.filter((l) => l.offer_id !== offerId), ...next] }));
    },
    [sb, setData, resync],
  );

  const duplicateOffer = useCallback(
    async (id: string) => {
      const src = dataRef.current.offers.find((o) => o.id === id);
      if (!src) throw new Error("Offer not found");
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = src;
      const lines = dataRef.current.offerLines
        .filter((l) => l.offer_id === id)
        .sort((a, b) => a.sort - b.sort)
        .map(({ id: _l, offer_id: _o, ...l }) => l);
      return createOffer({ ...rest, name: `${src.name} (Copy)`, status: "draft" }, lines);
    },
    [createOffer],
  );

  const setOfferStatus = useCallback((id: string, status: Offer["status"]) => updateOffer(id, { status }), [updateOffer]);

  // ---- supplier deals (optimistic; rolled back if the save fails) ----
  const addDeal = useCallback(
    async (deal: Omit<IngredientDeal, "id">) => {
      const row: IngredientDeal = { ...deal, id: newId() };
      setData((d) => ({ ...d, deals: [...d.deals, row] }));
      const { error } = await sb.from("cost_ingredient_deals").insert(row);
      if (error) {
        setData((d) => ({ ...d, deals: d.deals.filter((x) => x.id !== row.id) }));
        throw new Error(error.message);
      }
      return row.id;
    },
    [sb, setData],
  );

  const updateDeal = useCallback(
    async (id: string, patch: Partial<IngredientDeal>) => {
      const before = dataRef.current.deals.find((x) => x.id === id); // read now, not inside a state updater that runs later
      setData((d) => ({ ...d, deals: d.deals.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      try {
        await updateOne(sb, "cost_ingredient_deals", "id", id, patch);
      } catch (e) {
        if (before) setData((d) => ({ ...d, deals: d.deals.map((x) => (x.id === id ? before : x)) }));
        throw e;
      }
    },
    [sb, setData],
  );

  const deleteDeal = useCallback(
    async (id: string) => {
      const before = dataRef.current.deals.find((x) => x.id === id);
      setData((d) => ({ ...d, deals: d.deals.filter((x) => x.id !== id) }));
      try {
        await deleteOne(sb, "cost_ingredient_deals", "id", id);
      } catch (e) {
        if (before) setData((d) => ({ ...d, deals: [...d.deals, before] }));
        throw e;
      }
    },
    [sb, setData],
  );

  const value: StoreValue = {
    ...data,
    today,
    dealRollover,
    loading,
    refreshing,
    ready,
    error,
    portalPrices,
    portalError,
    assumptionsUnsaved,
    loadPortalPrices,
    userEmail,
    accessDenied,
    reload,
    health,
    recheck: reload,
    externalUpdates,
    signOut,
    items,
    storedItems: data.items,
    allLines,
    gelato,
    beer,
    index,
    itemCosts,
    offerCosts,
    dealsByIngredient,
    prepCosts,
    venueById,
    supplierById,
    usedIn,
    updateItem,
    insertItem,
    deleteItem,
    updatePrep,
    insertPrep,
    deletePrep,
    saveLines,
    updateIngredient,
    confirmIngredientPrice,
    undoConfirmIngredientPrice,
    insertIngredient,
    updateSetting,
    upsertTarget,
    insertSpecial,
    updateSpecial,
    deleteSpecial,
    addAllowedUser,
    removeAllowedUser,
    insertServe,
    updateServe,
    deleteServe,
    saveServeLines,
    insertBeer,
    updateBeer,
    deleteBeer,
    setBeerPrice,
    updateBeerServe,
    createOffer,
    updateOffer,
    deleteOffer,
    setOfferLines,
    duplicateOffer,
    setOfferStatus,
    addDeal,
    updateDeal,
    deleteDeal,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

export { newId };
