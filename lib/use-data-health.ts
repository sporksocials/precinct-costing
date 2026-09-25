"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { countLinesByParent, raiseBaseline, readLineBaseline, summarise, validate, writeLineBaseline, type HealthSummary, type Issue, type IntegrityData } from "./integrity";

export interface HealthResult {
  issues: Issue[];
  summary: HealthSummary;
  checkedAt: Date;
  counts: { ingredients: number; preps: number; items: number; lines: number };
}

/** One result shared by every caller (Home, Settings, the Data Health page) until the data changes. */
let cache: { key: unknown[]; result: HealthResult } | null = null;

function sameKey(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function whenIdle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(fn, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(h);
  }
  const h = window.setTimeout(fn, 50);
  return () => window.clearTimeout(h);
}

function compute(data: IntegrityData, key: unknown[], today: string): HealthResult {
  const baseline = readLineBaseline();
  const issues = validate(data, { lineCountBaseline: baseline, today });
  // raise the baseline AFTER checking against it; it never goes down, so a bad load cannot hide itself
  const counts = countLinesByParent(data.lines);
  const raised = raiseBaseline(baseline, counts);
  if (Object.keys(raised).length !== Object.keys(baseline).length || Object.entries(raised).some(([k, v]) => baseline[k] !== v)) writeLineBaseline(raised);
  const result: HealthResult = {
    issues,
    summary: summarise(issues),
    checkedAt: new Date(),
    counts: { ingredients: data.ingredients.length, preps: data.preps.length, items: data.items.length, lines: data.lines.length },
  };
  cache = { key, result };
  return result;
}

/**
 * Data Health for the loaded data. Runs after first paint (idle callback), only once the store has data, and is
 * memoised: callers share one result until the data changes. `result` is null until the first check has run.
 * `recheck` forces a fresh run (after "Accept Current Line Counts", for example).
 */
export function useDataHealth(): { result: HealthResult | null; recheck: () => void; acceptLineCounts: () => void } {
  const s = useStore();
  const [tick, setTick] = useState(0);
  const ready = s.ready && !s.loading && !s.error;
  const replaced = useMemo(() => new Set<string>([...s.gelato.replacedItemIds, ...s.beer.replacedItemIds]), [s.gelato, s.beer]);
  const key = useMemo<unknown[]>(
    () => [s.ingredients, s.preps, s.items, s.allLines, s.settings, s.targets, s.venues, s.beers, s.offers, s.offerLines, s.deals, s.itemCosts, replaced, s.today, tick],
    [s.ingredients, s.preps, s.items, s.allLines, s.settings, s.targets, s.venues, s.beers, s.offers, s.offerLines, s.deals, s.itemCosts, replaced, s.today, tick],
  );
  const [result, setResult] = useState<HealthResult | null>(() => (cache && sameKey(cache.key, key) ? cache.result : null));

  useEffect(() => {
    if (!ready) return;
    if (cache && sameKey(cache.key, key)) {
      setResult(cache.result);
      return;
    }
    return whenIdle(() => {
      const data: IntegrityData = {
        ingredients: s.ingredients,
        preps: s.preps,
        items: s.items,
        lines: s.allLines,
        settings: s.settings,
        targets: s.targets,
        venues: s.venues,
        beers: s.beers,
        offers: s.offers,
        offerLines: s.offerLines,
        deals: s.deals,
        replacedItemIds: replaced,
        itemCosts: s.itemCosts,
      };
      setResult(compute(data, key, s.today));
    });
    // key already covers every store field read above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  const recheck = useCallback(() => {
    cache = null;
    setTick((t) => t + 1);
  }, []);

  /** Treat today's line counts as the new normal for recipes that lost lines on purpose. */
  const acceptLineCounts = useCallback(() => {
    const now = countLinesByParent(s.allLines);
    const b = readLineBaseline();
    for (const k of Object.keys(now)) b[k] = now[k];
    for (const k of Object.keys(b)) if (!(k in now)) b[k] = 0;
    writeLineBaseline(b);
    cache = null;
    setTick((t) => t + 1);
  }, [s.allLines]);

  return { result, recheck, acceptLineCounts };
}

/** Counts only, for a badge: `{ errors, warnings, attention, ready }`. `ready` is false until the first check has run. */
export function useDataHealthSummary(): HealthSummary & { ready: boolean } {
  const { result } = useDataHealth();
  return useMemo(() => ({ ...(result?.summary ?? { errors: 0, warnings: 0, info: 0, attention: 0 }), ready: !!result }), [result]);
}
