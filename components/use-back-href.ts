"use client";

import { useEffect, useState } from "react";
import { backTarget, type BackRules } from "@/lib/list-memory";

/**
 * The address for a record page's back arrow: the list exactly as it was left (venue, category chip, search, sort, Show
 * Inactive), else `fallback`. Starts as the fallback so the first render matches the server, then switches once mounted.
 */
export function useBackHref(path: string, fallback: string, rules: BackRules = {}): string {
  const [href, setHref] = useState(fallback);
  const { venue, require, forbid } = rules;
  useEffect(() => {
    setHref(backTarget(path, fallback, { venue, require, forbid }));
  }, [path, fallback, venue, require?.key, require?.value, forbid?.key, forbid?.value]); // eslint-disable-line react-hooks/exhaustive-deps
  return href;
}
