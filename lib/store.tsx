"use client";

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
  type Ingredient,
  type MenuItem,
  type PortalPrice,
  type Prep,
  type PriceLog,
  type RecipeLine,
  type Setting,
  type Special,
  type Supplier,
  type Target,
  type Venue,
} from "./types";

const PAGE = 1000;
const LOG_WINDOW_DAYS = 90;
const CACHE_KEY = "precinct-cache-v1";

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

async function fetchAll<T>(sb: SupabaseClient, table: string, order: string, since?: SinceFilter): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = sb.from(table).select("*").order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (since) q = q.gte(since.column, since.gte);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
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
  signOut: () => Promise<void>;
  // derived
  index: CostingIndex;
  itemCosts: Map<string, ItemCost>;
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
  insertIngredient: (ing: Omit<Ingredient, "id" | "updated_at">) => Promise<string>;
  updateSetting: (key: keyof CostingSettings, value: number) => Promise<void>;
  upsertTarget: (venueId: number, category: string, targetGp: number) => Promise<void>;
  insertSpecial: (s: Omit<Special, "id">) => Promise<void>;
  updateSpecial: (id: number, patch: Partial<Special>) => Promise<void>;
  deleteSpecial: (id: number) => Promise<void>;
  addAllowedUser: (email: string) => Promise<void>;
  removeAllowedUser: (email: string) => Promise<void>;
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
};

const StoreContext = createContext<StoreValue | null>(null);

function settingsFromRows(rows: Setting[]): CostingSettings {
  const get = (k: keyof CostingSettings) => {
    const r = rows.find((s) => s.key === k);
    return r && r.value != null ? Number(r.value) : DEFAULT_SETTINGS[k];
  };
  return { gst_rate: get("gst_rate"), round_to: get("round_to"), alert_pct: get("alert_pct") };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // created in the browser only (it is used from effects/callbacks), so server prerendering never needs Supabase env vars
  const sb = useMemo(() => (typeof window === "undefined" ? (null as unknown as SupabaseClient) : getSupabaseBrowser()), []);
  const [data, setData] = useState<StoreData>(empty);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [portalPrices, setPortalPrices] = useState<PortalPrice[] | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const portalLoading = useRef(false);
  const loadedOnce = useRef(false);
  const serverLoaded = useRef(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await sb.auth.getUser();
      setUserEmail(user?.email ?? null);
      const since = new Date(Date.now() - LOG_WINDOW_DAYS * 86_400_000).toISOString();
      const [venues, rawSettings, targets, suppliers, ingredients, preps, items, lines, priceLogs, specials, allowedUsers] =
        await Promise.all([
          fetchAll<Venue>(sb, "cost_venues", "sort"),
          fetchAll<Setting>(sb, "cost_settings", "key"),
          fetchAll<Target>(sb, "cost_targets", "venue_id"),
          fetchAll<Supplier>(sb, "cost_suppliers", "name"),
          fetchAll<Ingredient>(sb, "cost_ingredients", "name"),
          fetchAll<Prep>(sb, "cost_preps", "name"),
          fetchAll<MenuItem>(sb, "cost_menu_items", "name"),
          fetchAll<RecipeLine>(sb, "cost_recipe_lines", "sort"),
          fetchAll<PriceLog>(sb, "cost_price_log", "changed_at", { column: "changed_at", gte: since }),
          fetchAll<Special>(sb, "cost_specials", "id"),
          fetchAll<AllowedUser>(sb, "cost_allowed_users", "email"),
        ]);
      setData({
        venues,
        rawSettings,
        settings: settingsFromRows(rawSettings),
        targets,
        suppliers,
        ingredients,
        preps,
        items,
        lines,
        priceLogs,
        specials,
        allowedUsers,
      });
      serverLoaded.current = true;
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [sb]);

  // stale-while-revalidate: paint from the local cache instantly, then refresh from Supabase
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    const cached = readCache();
    if (cached) {
      setData(cached.data);
      setUserEmail(cached.userEmail);
      setReady(true);
    }
    void reload();
  }, [reload]);

  // persist the latest full dataset (debounced) once it has come from the server at least once
  useEffect(() => {
    if (!serverLoaded.current) return;
    const t = window.setTimeout(() => writeCache({ savedAt: new Date().toISOString(), userEmail, data }), 1200);
    return () => window.clearTimeout(t);
  }, [data, userEmail]);

  const loadPortalPrices = useCallback(() => {
    if (portalLoading.current) return;
    portalLoading.current = true;
    setPortalError(null);
    (async () => {
      try {
        const all = await fetchAll<PortalPrice>(sb, "cost_portal_prices", "id");
        // latest batch per supplier = the batch of the most recently captured row for that supplier
        const latestBatch = new Map<string, { batch: string | null; at: number }>();
        for (const r of all) {
          const at = r.captured_at ? new Date(r.captured_at).getTime() : 0;
          const cur = latestBatch.get(r.supplier);
          if (!cur || at > cur.at) latestBatch.set(r.supplier, { batch: r.batch, at });
        }
        setPortalPrices(all.filter((r) => latestBatch.get(r.supplier)?.batch === r.batch));
      } catch (e) {
        setPortalError(e instanceof Error ? e.message : String(e));
        portalLoading.current = false;
      }
    })();
  }, [sb]);

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
  const index = useMemo(() => buildIndex(data.ingredients, data.preps, data.lines), [data.ingredients, data.preps, data.lines]);
  const prepCosts = useMemo(() => {
    const cache = new Map<string, PrepCost>();
    const out = new Map<string, PrepCost>();
    for (const p of data.preps) out.set(p.id, costPrep(p, index, data.settings.gst_rate, [], cache));
    return out;
  }, [data.preps, index, data.settings.gst_rate]);
  const itemCosts = useMemo(() => {
    const cache = new Map<string, PrepCost>();
    const out = new Map<string, ItemCost>();
    for (const it of data.items) out.set(it.id, costItem(it, index, data.settings, data.targets, cache));
    return out;
  }, [data.items, index, data.settings, data.targets]);
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
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
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
  const updateItem = useCallback(
    async (id: string, patch: Partial<MenuItem>) => {
      const { error } = await sb.from("cost_menu_items").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    },
    [sb],
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
        if (e2) throw new Error(e2.message);
      }
      setData((d) => ({ ...d, items: [...d.items, row], lines: [...d.lines, ...newLines] }));
      return id;
    },
    [sb],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const { error: e1 } = await sb.from("cost_recipe_lines").delete().eq("parent_type", "item").eq("parent_id", id);
      if (e1) throw new Error(e1.message);
      const { error } = await sb.from("cost_menu_items").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setData((d) => ({
        ...d,
        items: d.items.filter((i) => i.id !== id),
        lines: d.lines.filter((l) => !(l.parent_type === "item" && l.parent_id === id)),
      }));
    },
    [sb],
  );

  const updatePrep = useCallback(
    async (id: string, patch: Partial<Prep>) => {
      const { error } = await sb.from("cost_preps").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, preps: d.preps.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },
    [sb],
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
    [sb],
  );

  const deletePrep = useCallback(
    async (id: string) => {
      const { error: e1 } = await sb.from("cost_recipe_lines").delete().eq("parent_type", "prep").eq("parent_id", id);
      if (e1) throw new Error(e1.message);
      const { error } = await sb.from("cost_preps").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setData((d) => ({
        ...d,
        preps: d.preps.filter((p) => p.id !== id),
        lines: d.lines.filter((l) => !(l.parent_type === "prep" && l.parent_id === id)),
      }));
    },
    [sb],
  );

  const saveLines = useCallback(
    async (parentType: "item" | "prep", parentId: string, next: RecipeLine[]) => {
      const key = parentKey(parentType, parentId);
      const existing = index.linesByParent.get(key) ?? [];
      const nextIds = new Set(next.map((l) => l.id));
      const removed = existing.filter((l) => !nextIds.has(l.id)).map((l) => l.id);
      const normalised = next.map((l, i) => ({ ...l, parent_type: parentType, parent_id: parentId, sort: i + 1, qty: Number(l.qty) || 0 }));
      if (removed.length) {
        const { error } = await sb.from("cost_recipe_lines").delete().in("id", removed);
        if (error) throw new Error(error.message);
      }
      if (normalised.length) {
        const { error } = await sb.from("cost_recipe_lines").upsert(normalised, { onConflict: "id" });
        if (error) throw new Error(error.message);
      }
      setData((d) => ({
        ...d,
        lines: [...d.lines.filter((l) => !(l.parent_type === parentType && l.parent_id === parentId)), ...normalised],
      }));
    },
    [sb, index.linesByParent],
  );

  const updateIngredient = useCallback(
    async (id: string, patch: Partial<Ingredient>) => {
      // The DB trigger maintains previous_price / last_price_update / cost_price_log when pack_price changes.
      const { data: rows, error } = await sb.from("cost_ingredients").update(patch).eq("id", id).select("*");
      if (error) throw new Error(error.message);
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
    [sb],
  );

  const insertIngredient = useCallback(
    async (ing: Omit<Ingredient, "id" | "updated_at">) => {
      const id = newId();
      const row = { ...ing, id };
      const { data: rows, error } = await sb.from("cost_ingredients").insert(row).select("*");
      if (error) throw new Error(error.message);
      const fresh = (rows?.[0] as Ingredient | undefined) ?? ({ ...row, updated_at: new Date().toISOString() } as Ingredient);
      setData((d) => ({ ...d, ingredients: [...d.ingredients, fresh].sort((a, b) => a.name.localeCompare(b.name)) }));
      return id;
    },
    [sb],
  );

  const updateSetting = useCallback(
    async (key: keyof CostingSettings, value: number) => {
      const { error } = await sb.from("cost_settings").upsert({ key, value }, { onConflict: "key" });
      if (error) throw new Error(error.message);
      setData((d) => {
        const rawSettings = d.rawSettings.some((s) => s.key === key)
          ? d.rawSettings.map((s) => (s.key === key ? { ...s, value } : s))
          : [...d.rawSettings, { key, value }];
        return { ...d, rawSettings, settings: settingsFromRows(rawSettings) };
      });
    },
    [sb],
  );

  const upsertTarget = useCallback(
    async (venueId: number, category: string, targetGp: number) => {
      const { error } = await sb.from("cost_targets").upsert({ venue_id: venueId, category, target_gp: targetGp }, { onConflict: "venue_id,category" });
      if (error) throw new Error(error.message);
      setData((d) => {
        const exists = d.targets.some((t) => t.venue_id === venueId && t.category === category);
        const targets = exists
          ? d.targets.map((t) => (t.venue_id === venueId && t.category === category ? { ...t, target_gp: targetGp } : t))
          : [...d.targets, { venue_id: venueId, category, target_gp: targetGp }];
        return { ...d, targets };
      });
    },
    [sb],
  );

  const insertSpecial = useCallback(
    async (s: Omit<Special, "id">) => {
      const { data: rows, error } = await sb.from("cost_specials").insert(s).select("*");
      if (error) throw new Error(error.message);
      const row = rows?.[0] as Special | undefined;
      if (row) setData((d) => ({ ...d, specials: [...d.specials, row] }));
    },
    [sb],
  );

  const updateSpecial = useCallback(
    async (id: number, patch: Partial<Special>) => {
      const { error } = await sb.from("cost_specials").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, specials: d.specials.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    },
    [sb],
  );

  const deleteSpecial = useCallback(
    async (id: number) => {
      const { error } = await sb.from("cost_specials").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, specials: d.specials.filter((s) => s.id !== id) }));
    },
    [sb],
  );

  const addAllowedUser = useCallback(
    async (email: string) => {
      const clean = email.trim().toLowerCase();
      const { error } = await sb.from("cost_allowed_users").insert({ email: clean });
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, allowedUsers: [...d.allowedUsers, { email: clean }].sort((a, b) => a.email.localeCompare(b.email)) }));
    },
    [sb],
  );

  const removeAllowedUser = useCallback(
    async (email: string) => {
      const { error } = await sb.from("cost_allowed_users").delete().eq("email", email);
      if (error) throw new Error(error.message);
      setData((d) => ({ ...d, allowedUsers: d.allowedUsers.filter((u) => u.email !== email) }));
    },
    [sb],
  );

  const value: StoreValue = {
    ...data,
    loading,
    refreshing,
    ready,
    error,
    portalPrices,
    portalError,
    loadPortalPrices,
    userEmail,
    accessDenied,
    reload,
    signOut,
    index,
    itemCosts,
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
    insertIngredient,
    updateSetting,
    upsertTarget,
    insertSpecial,
    updateSpecial,
    deleteSpecial,
    addAllowedUser,
    removeAllowedUser,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

export { newId };
