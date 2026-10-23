"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadDiscountGroups, type DiscountLoad } from "@/lib/invoice-discount-data";

/**
 * The supplier discounts found on invoices, grouped by supplier and item. Read only. `loading` is true until the first answer;
 * `available` is false when the invoice tables or the discount columns are not in the database yet (the screens then say so calmly).
 * Reloads when the venue or ingredient changes, or when `refreshKey` does.
 */
export function useDiscountGroups(opts: { venueId?: number | null; ingredientId?: string | null; refreshKey?: string }): DiscountLoad & { loading: boolean } {
  const { ingredients } = useStore();
  const names = useMemo(() => new Map(ingredients.map((i) => [i.id, i.name])), [ingredients]);
  // the names are read when the answer arrives; a rename does not need a second trip to the database
  const namesRef = useRef(names);
  namesRef.current = names;
  const namesReady = names.size > 0;
  const [state, setState] = useState<DiscountLoad & { loading: boolean }>({ groups: [], available: true, loading: true });
  const venueId = opts.venueId ?? null;
  const ingredientId = opts.ingredientId ?? null;

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    void loadDiscountGroups(getSupabaseBrowser(), { venueId, ingredientId, ingredientName: (id) => namesRef.current.get(id) }).then((r) => live && setState({ ...r, loading: false }));
    return () => {
      live = false;
    };
  }, [venueId, ingredientId, opts.refreshKey, namesReady]);

  return state;
}
