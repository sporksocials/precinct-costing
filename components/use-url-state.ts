"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/**
 * A filter that lives in the address bar (?cat=Cocktail), so the browser's Back button brings the list back exactly as it
 * was left: the category chip, the search words, the sort and Show Inactive. The venue tiles already work this way
 * (components/venue.tsx). Writing uses history.replaceState, which Next.js keeps in step with useSearchParams without a
 * server round trip or a new history entry, so typing in a search box stays instant. A value equal to its default is
 * left out of the address to keep links short.
 */
export function useUrlState(key: string, def = ""): [string, (next: string) => void] {
  const params = useSearchParams();
  const value = params.get(key) ?? def;
  const set = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(window.location.search);
      if (next === def || next === "") sp.delete(key);
      else sp.set(key, next);
      const qs = sp.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    },
    [key, def],
  );
  return [value, set];
}

/** A yes/no filter in the address bar (?inactive=1). */
export function useUrlFlag(key: string): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, set] = useUrlState(key, "");
  const on = value === "1";
  return [on, useCallback((next) => set((typeof next === "function" ? next(on) : next) ? "1" : ""), [set, on])];
}
